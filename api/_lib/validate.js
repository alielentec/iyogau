// Input validation for /api/calculate-chart.
// All validation errors throw a ValidationError, which the handler turns
// into a 400 response with a descriptive message.

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_DATE = '1900-01-01';

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

// Convert a local civil date/time in zone `tz` to a UTC Date by inverting
// the offset that JS reports for the candidate UTC instant. We iterate
// twice to converge across DST transitions (the candidate UTC may land in
// a different offset than the wall-clock instant).
export function localToUTC(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
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

  if (typeof tz !== 'string' || tz.length === 0 || !validIanaTz(tz)) {
    throw new ValidationError('`tz` must be a valid IANA timezone identifier (e.g. "Asia/Seoul").');
  }

  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('`lat` must be a finite number between -90 and 90.');
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('`lon` must be a finite number between -180 and 180.');
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
