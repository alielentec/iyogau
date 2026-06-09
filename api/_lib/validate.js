// Input validation for /api/calculate-chart.
// All validation errors throw a ValidationError, which the handler turns
// into a 400 response with a descriptive message.

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Fixed UTC offset format: ±H:MM or ±HH:MM (e.g. "+05:30", "-08:00", "+9:00").
// When tz matches this, we use the offset directly and ignore any IANA DST
// rules — the user has told us exactly how many minutes ahead of (or behind)
// UTC their wall-clock was. Range ±14:00 covers all real-world offsets;
// historic anomalies (Liberia +44min, Kiribati +14:00) sit inside this.
const OFFSET_RE = /^([+-])(\d{1,2}):([0-5]\d)$/;
// Lowered from 1900-01-01 to 1800-01-01 so historical figures (Gandhi
// 1869, Einstein 1879, Yogananda 1893) can be sampled via the
// famous-people picker on the homepage. astronomy-engine remains
// accurate to better than 1 arcsec for centuries either side of J2000
// (Meeus 1998 verifies through 4000 BC – 8000 AD). The IANA timezone
// database has reasonable LMT data back to ~1800; pre-1800 stays
// rejected because Intl.DateTimeFormat's offset calculations get
// progressively less reliable.
const MIN_DATE = '1800-01-01';

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function maxDateString() {
  // today + 1 day, in UTC. We're permissive about future dates by one day
  // so timezones west of UTC can still submit "tomorrow" in their locale.
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function validIanaTz(tz) {
  try {
    // The constructor throws RangeError on unknown zones.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Parse a "±H:MM" / "±HH:MM" offset to total minutes east of UTC.
// Returns null if the string doesn't match, or if the value is outside
// the realistic ±14:00 range.
function parseOffsetMinutes(tz) {
  const m = tz.match(OFFSET_RE);
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  if (hours > 14 || (hours === 14 && mins > 0)) return null;
  return sign * (hours * 60 + mins);
}

// Convert a local civil date/time in zone `tz` to a UTC Date. `tz` may be:
//   - an IANA timezone identifier (e.g. "Asia/Seoul") — full DST support
//   - a fixed offset string in "±H:MM" / "±HH:MM" form — DST ignored, the
//     user has told us exactly how many minutes east/west of UTC their
//     wall-clock was at the birth instant
//
// IANA path: iterate twice to converge across DST transitions (the
// candidate UTC may land in a different offset than the wall-clock instant).
// Fixed-offset path: single subtraction, no iteration needed.
export function localToUTC(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const fixedOffset = parseOffsetMinutes(tz);
  if (fixedOffset !== null) {
    return new Date(Date.UTC(y, mo - 1, d, hh, mm, 0) - fixedOffset * 60_000);
  }
  // First guess: treat input as if it were UTC.
  let utcGuess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = offsetMinutesAt(utcGuess, tz);
    utcGuess = Date.UTC(y, mo - 1, d, hh, mm, 0) - offsetMin * 60_000;
  }
  return new Date(utcGuess);
}

// Returns the offset of zone `tz` from UTC, in minutes, at the given UTC
// instant. Positive for zones east of UTC.
function offsetMinutesAt(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60_000);
}

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const { date, time, tz, lat, lon, tradition, ayanamsa, unknownTime } = body;

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
  // Reject invalid calendar dates (e.g. Feb 30) by round-tripping.
  {
    const [y, mo, d] = date.split('-').map(Number);
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      throw new ValidationError('`date` is not a valid calendar date.');
    }
  }

  const isUnknownTime = unknownTime === true;
  let timeFinal = time;
  if (isUnknownTime) {
    timeFinal = '12:00';
  } else {
    if (typeof time !== 'string' || !TIME_RE.test(time)) {
      throw new ValidationError('`time` must be a string in HH:MM 24-hour format, or set `unknownTime: true`.');
    }
  }

  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) {
    throw new ValidationError('`tz` must be either an IANA timezone identifier (e.g. "Asia/Seoul") or a fixed offset in ±HH:MM form (e.g. "+05:30").');
  }
  // tz accepts EITHER an IANA timezone OR a fixed ±HH:MM offset.
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
  // Reject polar latitudes where the ecliptic-rising-point formula is
  // mathematically singular and the chart concept is poorly defined.
  // Standard astrology software (Swiss Ephemeris) warns at this boundary.
  if (lat > 66.5 || lat < -66.5) {
    throw new ValidationError('Births above the Arctic or below the Antarctic Circle (lat outside ±66.5°) are not currently supported — the ascendant is mathematically undefined in those regions.');
  }

  let traditionFinal = tradition === undefined ? 'sidereal' : tradition;
  if (traditionFinal !== 'sidereal' && traditionFinal !== 'tropical') {
    throw new ValidationError('`tradition` must be "sidereal" or "tropical".');
  }

  let ayanamsaFinal;
  if (traditionFinal === 'sidereal') {
    ayanamsaFinal = ayanamsa === undefined ? 'lahiri' : ayanamsa;
    if (ayanamsaFinal !== 'lahiri') {
      throw new ValidationError('`ayanamsa` must be "lahiri" (the only supported value in v1).');
    }
  } else {
    ayanamsaFinal = null;
  }

  return {
    date,
    time: timeFinal,
    tz,
    lat,
    lon,
    tradition: traditionFinal,
    ayanamsa: ayanamsaFinal,
    unknownTime: isUnknownTime,
  };
}
