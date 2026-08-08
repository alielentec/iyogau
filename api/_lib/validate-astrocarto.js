// Validator for /api/astrocarto. Extends validate.js#validateInput by adding:
//   - mode: 'relocation' | 'immigration' | 'soulmate'  (required)
//   - resolution: 'low' | 'medium' | 'high'             (optional, default 'medium')
//   - currentResidence: { lat, lon }                    (optional; read only for immigration)
//   - targetDate: YYYY-MM-DD                            (only for soulmate_timing)
//   - targetLocation: { lat, lon }                      (only for soulmate_timing)
//   - includeHeat: boolean                              (optional, default true)
//
// Reuses every base-chart guard (date range, IANA tz, ±66.563° lat cap,
// sidereal-only ayanamsa rule). The only differences from the natal API are
// the three astrocarto-specific fields above and a relaxed unknownTime path
// — astrocarto is meaningless without a real birth time (lines hinge on
// apparent sidereal time at birth), so we DO require time and reject unknownTime.

import { DEFAULT_AYANAMSA, SUPPORTED_AYANAMSAS, isSupportedAyanamsa } from './ayanamsa.js';
import { ValidationError } from './validate.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const OFFSET_RE = /^([+-])(\d{1,2}):([0-5]\d)$/;
const MIN_DATE = '1800-01-01';

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function maxDateString() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function validIanaTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

function parseOffsetMinutes(tz) {
  const m = tz.match(OFFSET_RE);
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  if (hours > 14 || (hours === 14 && mins > 0)) return null;
  return sign * (hours * 60 + mins);
}

const ALLOWED_TOP_FIELDS = new Set([
  // base chart fields
  'date', 'time', 'tz', 'lat', 'lon', 'tradition', 'ayanamsa',
  // astrocarto-specific
  'mode', 'resolution', 'currentResidence', 'targetDate', 'targetLocation', 'includeHeat',
]);

const MODES = new Set(['relocation', 'immigration', 'soulmate', 'soulmate_timing']);

// Resolution tiers — controls full-world center-grid density. 'medium'
// (4°/4°) is the default. 'high' (3°/3°) increases cell count; 'low'
// (6°/6°) reduces it.
const RESOLUTION_PRESETS = {
  low: { latStep: 6, lonStep: 6 },
  medium: { latStep: 4, lonStep: 4 },
  high: { latStep: 3, lonStep: 3 },
};

function validCalendarDateString(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const [y, mo, d] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function parseDateStringUTC(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

function dateStringUTC(date) {
  return date.toISOString().slice(0, 10);
}

function daysInUTCMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addYearsClampedString(date, years) {
  const start = parseDateStringUTC(date);
  const year = start.getUTCFullYear() + years;
  const month = start.getUTCMonth();
  const day = Math.min(start.getUTCDate(), daysInUTCMonth(year, month));
  return dateStringUTC(new Date(Date.UTC(year, month, day, 12, 0, 0)));
}

function todayClampedToRange(minDate, maxDate) {
  const today = dateStringUTC(new Date());
  if (today < minDate) return minDate;
  if (today > maxDate) return maxDate;
  return today;
}

export function validateAstrocartoInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  for (const k of Object.keys(body)) {
    if (!ALLOWED_TOP_FIELDS.has(k)) {
      throw new ValidationError(`Unknown field: \`${k}\`. Allowed: ${Array.from(ALLOWED_TOP_FIELDS).join(', ')}.`);
    }
  }

  const { date, time, tz, lat, lon, tradition, ayanamsa, mode, resolution, currentResidence, targetDate, targetLocation, includeHeat } = body;

  // ── Base chart fields (parity with validate.js) ──
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new ValidationError('`date` must be a string in YYYY-MM-DD format.');
  }
  if (date < MIN_DATE) {
    throw new ValidationError(`\`date\` must be on or after ${MIN_DATE}.`);
  }
  const maxDate = maxDateString();
  if (date > maxDate) {
    throw new ValidationError(`\`date\` must be on or before ${maxDate}.`);
  }
  {
    const [y, mo, d] = date.split('-').map(Number);
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      throw new ValidationError('`date` is not a valid calendar date.');
    }
  }

  // Astrocartography is meaningless without an accurate birth TIME — the
  // four angular lines pivot on apparent sidereal time at the birth instant,
  // and a 4-minute time uncertainty shifts MC/IC lines by ~1° of longitude
  // (~111 km at the equator). We do NOT accept `unknownTime: true`. The frontend
  // should gate the astrocarto feature behind a known-time prompt.
  if (typeof time !== 'string' || !TIME_RE.test(time)) {
    throw new ValidationError('`time` must be a string in HH:MM or HH:MM:SS 24-hour format. Astrocartography requires a known birth time.');
  }

  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) {
    throw new ValidationError('`tz` must be either an IANA timezone identifier (e.g. "Asia/Seoul") or a fixed offset in ±HH:MM form (e.g. "+05:30").');
  }
  const isOffsetForm = parseOffsetMinutes(tz) !== null;
  if (!isOffsetForm && !validIanaTz(tz)) {
    throw new ValidationError('`tz` must be either an IANA timezone identifier (e.g. "Asia/Seoul") or a fixed offset in ±HH:MM form (e.g. "+05:30").');
  }

  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('`lat` must be a finite number between -90 and 90.');
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('`lon` must be a finite number between -180 and 180.');
  }
  if (lat > 66.563 || lat < -66.563) {
    throw new ValidationError('Births above the Arctic or below the Antarctic Circle (lat outside ±66.563°) are not currently supported — the ascendant is mathematically undefined in those regions.');
  }

  let traditionFinal = tradition === undefined ? 'sidereal' : tradition;
  if (traditionFinal !== 'sidereal' && traditionFinal !== 'tropical') {
    throw new ValidationError('`tradition` must be "sidereal" or "tropical".');
  }
  let ayanamsaFinal;
  if (traditionFinal === 'sidereal') {
    ayanamsaFinal = ayanamsa === undefined ? DEFAULT_AYANAMSA : ayanamsa;
    if (!isSupportedAyanamsa(ayanamsaFinal)) {
      throw new ValidationError(`\`ayanamsa\` must be one of: ${SUPPORTED_AYANAMSAS.map((a) => `"${a}"`).join(', ')}.`);
    }
  } else {
    if (ayanamsa !== undefined) {
      throw new ValidationError('`ayanamsa` is not valid for tropical tradition. Omit `ayanamsa` for tropical, or set `tradition: "sidereal"` to use a supported sidereal ayanamsa.');
    }
    ayanamsaFinal = null;
  }

  // ── Astrocarto-specific fields ──
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    throw new ValidationError('`mode` must be one of: "relocation", "immigration", "soulmate", "soulmate_timing".');
  }

  let targetDateFinal = null;
  const minTarget = date;
  const maxTarget = addYearsClampedString(date, 50);
  if (targetDate !== undefined && targetDate !== null && targetDate !== '') {
    if (!validCalendarDateString(targetDate)) {
      throw new ValidationError('`targetDate` must be a valid date string in YYYY-MM-DD format.');
    }
    if (targetDate < minTarget || targetDate > maxTarget) {
      throw new ValidationError(`\`targetDate\` must be between ${minTarget} and ${maxTarget}.`);
    }
    targetDateFinal = targetDate;
  }
  if (mode === 'soulmate_timing' && !targetDateFinal) {
    targetDateFinal = todayClampedToRange(minTarget, maxTarget);
  }
  if (mode !== 'soulmate_timing' && targetDateFinal) {
    throw new ValidationError('`targetDate` is only valid when `mode` is "soulmate_timing".');
  }

  let targetLocationFinal = null;
  if (targetLocation !== undefined && targetLocation !== null) {
    if (typeof targetLocation !== 'object' || Array.isArray(targetLocation)) {
      throw new ValidationError('`targetLocation` must be an object with `lat` and `lon`.');
    }
    for (const k of Object.keys(targetLocation)) {
      if (!['lat', 'lon', 'country', 'city'].includes(k)) {
        throw new ValidationError(`Unknown field in \`targetLocation\`: \`${k}\`. Allowed: lat, lon, country, city.`);
      }
    }
    const { lat: tLat, lon: tLon } = targetLocation;
    if (!isFiniteNumber(tLat) || tLat < -90 || tLat > 90) {
      throw new ValidationError('`targetLocation.lat` must be a finite number between -90 and 90.');
    }
    if (!isFiniteNumber(tLon) || tLon < -180 || tLon > 180) {
      throw new ValidationError('`targetLocation.lon` must be a finite number between -180 and 180.');
    }
    targetLocationFinal = { lat: tLat, lon: tLon };
    if (typeof targetLocation.country === 'string' && targetLocation.country.length <= 64) {
      targetLocationFinal.country = targetLocation.country;
    }
    if (typeof targetLocation.city === 'string' && targetLocation.city.length <= 96) {
      targetLocationFinal.city = targetLocation.city;
    }
  }
  if (mode !== 'soulmate_timing' && targetLocationFinal) {
    throw new ValidationError('`targetLocation` is only valid when `mode` is "soulmate_timing".');
  }

  const includeHeatFinal = includeHeat === undefined ? true : includeHeat;
  if (typeof includeHeatFinal !== 'boolean') {
    throw new ValidationError('`includeHeat` must be a boolean when supplied.');
  }

  const resolutionFinal = resolution === undefined ? 'medium' : resolution;
  if (!RESOLUTION_PRESETS[resolutionFinal]) {
    throw new ValidationError('`resolution` must be one of: "low", "medium", "high".');
  }
  const { latStep, lonStep } = RESOLUTION_PRESETS[resolutionFinal];

  // currentResidence — only meaningful for immigration mode. Reject if
  // supplied for other modes (catches the same silent-drop class of bug
  // the natal validator's unknown-field gate catches for typos).
  let currentResidenceFinal = null;
  if (currentResidence !== undefined && currentResidence !== null) {
    if (typeof currentResidence !== 'object' || Array.isArray(currentResidence)) {
      throw new ValidationError('`currentResidence` must be an object with `lat` and `lon`.');
    }
    for (const k of Object.keys(currentResidence)) {
      if (!['lat', 'lon', 'country', 'city'].includes(k)) {
        throw new ValidationError(`Unknown field in \`currentResidence\`: \`${k}\`. Allowed: lat, lon, country, city.`);
      }
    }
    const { lat: rLat, lon: rLon } = currentResidence;
    if (!isFiniteNumber(rLat) || rLat < -90 || rLat > 90) {
      throw new ValidationError('`currentResidence.lat` must be a finite number between -90 and 90.');
    }
    if (!isFiniteNumber(rLon) || rLon < -180 || rLon > 180) {
      throw new ValidationError('`currentResidence.lon` must be a finite number between -180 and 180.');
    }
    currentResidenceFinal = { lat: rLat, lon: rLon };
    if (typeof currentResidence.country === 'string' && currentResidence.country.length <= 64) {
      currentResidenceFinal.country = currentResidence.country;
    }
    if (typeof currentResidence.city === 'string' && currentResidence.city.length <= 64) {
      currentResidenceFinal.city = currentResidence.city;
    }
  }
  if (mode !== 'immigration' && currentResidenceFinal) {
    throw new ValidationError('`currentResidence` is only valid when `mode` is "immigration". Omit it for other modes.');
  }

  return {
    date,
    time,
    tz,
    lat,
    lon,
    tradition: traditionFinal,
    ayanamsa: ayanamsaFinal,
    mode,
    resolution: resolutionFinal,
    latStep,
    lonStep,
    currentResidence: currentResidenceFinal,
    targetDate: targetDateFinal,
    targetLocation: targetLocationFinal,
    includeHeat: includeHeatFinal,
    unknownTime: false,
  };
}

export { RESOLUTION_PRESETS };
