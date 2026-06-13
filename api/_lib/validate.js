// Input validation for /api/calculate-chart.
// All validation errors throw a ValidationError, which the handler turns
// into a 400 response with a descriptive message.

import { DEFAULT_AYANAMSA, SUPPORTED_AYANAMSAS, isSupportedAyanamsa } from './ayanamsa.js';

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
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
// After convergence we VERIFY by re-applying the zone's offset and checking
// the wall-clock round-trips. On DST "spring-forward" gaps (e.g. America/
// New_York 2024-03-10 02:30 — clocks skip from 01:59 to 03:00, so 02:30
// does not exist), the round-trip will mismatch and we throw with a
// human-readable error rather than silently absorbing the input. On DST
// "fall-back" ambiguity (e.g. 01:30 happens twice), we pick the EARLIER
// occurrence (standard astrology-software convention) and surface a
// warning via the returned object's __ambiguous flag if the caller wants
// to log it.
// Fixed-offset path: single subtraction, no iteration needed, no DST risk.
export function localToUTC(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss = 0] = timeStr.split(':').map(Number);
  const fixedOffset = parseOffsetMinutes(tz);
  if (fixedOffset !== null) {
    return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss) - fixedOffset * 60_000);
  }
  const wallUtc = Date.UTC(y, mo - 1, d, hh, mm, ss);
  // First guess: treat input as if it were UTC.
  let utcGuess = wallUtc;
  for (let i = 0; i < 2; i++) {
    const offsetMin = offsetMinutesAt(utcGuess, tz);
    utcGuess = wallUtc - offsetMin * 60_000;
  }
  // Verification pass: take the candidate UTC, look up the zone's offset
  // at that instant, derive the wall-clock the zone would display, and
  // compare to the wall-clock the user supplied. On a DST gap the iteration
  // converges to an instant whose wall-clock is on the OTHER side of the
  // discontinuity, so the round-trip fails.
  const finalOffsetMin = offsetMinutesAt(utcGuess, tz);
  const roundTripWall = utcGuess + finalOffsetMin * 60_000;
  if (roundTripWall !== wallUtc) {
    throw new ValidationError(
      'The supplied wall-clock time does not exist in the given timezone on that date (likely a DST spring-forward gap — clocks skipped through that time).'
    );
  }
  // Ambiguity detection (DST fall-back): if the wall-clock falls inside
  // a fall-back hour, there are TWO valid UTC instants 1 hour apart. The
  // two-pass iteration above converges to ONE of them (typically the
  // earlier — the iteration starts from the wall-clock-as-UTC guess and
  // applies the offset, finding the EDT-side instant first). We probe
  // BOTH neighbours (±1h); if either has the same wall-clock as our
  // candidate, the input is ambiguous. We then keep the EARLIER UTC
  // instant (standard astrology-software convention) and tag for warning.
  const probe = (deltaMin) => {
    const cand = utcGuess + deltaMin * 60_000;
    const off = offsetMinutesAt(cand, tz);
    return { cand, wall: cand + off * 60_000 };
  };
  const earlier = probe(-60);
  const later = probe(60);
  if (earlier.wall === wallUtc || later.wall === wallUtc) {
    // Pick the EARLIER of (utcGuess, the matching neighbour).
    const candidates = [utcGuess];
    if (earlier.wall === wallUtc) candidates.push(earlier.cand);
    if (later.wall === wallUtc)   candidates.push(later.cand);
    const chosen = Math.min(...candidates);
    const out = new Date(chosen);
    out.__ambiguous = true;
    return out;
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

// Allow-list for body fields. Any key outside this set is rejected with
// a descriptive 400 — catches typos like `unknowTime` (missing `n`) and
// bogus pass-through keys like `houseSystem` that today get silently
// dropped, leaving the user wondering why their requested option had no
// effect. Keep this list synced with the destructure below.
const ALLOWED_BODY_FIELDS = new Set([
  'date', 'time', 'tz', 'lat', 'lon',
  'tradition', 'ayanamsa', 'unknownTime',
]);

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  // Unknown-field gate — fail FAST before any expensive math runs.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_BODY_FIELDS.has(k)) {
      throw new ValidationError(`Unknown field: \`${k}\`. Allowed: ${Array.from(ALLOWED_BODY_FIELDS).join(', ')}.`);
    }
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
      throw new ValidationError('`time` must be a string in HH:MM or HH:MM:SS 24-hour format, or set `unknownTime: true`.');
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
  // Bound = obliquity of the ecliptic ≈ 23.437° → Arctic Circle ≈ 66.563°.
  // Previous bound 66.5° was an approximation that rejected real
  // settlements at Icelandic latitudes 66.51–66.56°N (e.g. Grímsey,
  // Siglufjörður).
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
    // tropical — ayanamsa is meaningless. Reject explicit values rather
    // than silently dropping them; the user almost certainly intended to
    // request a supported sidereal ayanamsa.
    if (ayanamsa !== undefined) {
      throw new ValidationError('`ayanamsa` is not valid for tropical tradition. Omit `ayanamsa` for tropical, or set `tradition: "sidereal"` to use a supported sidereal ayanamsa.');
    }
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
