// Wraps astronomy-engine. Returns tropical (true-ecliptic-of-date) longitudes.
// All longitudes in degrees, normalized to [0, 360). Latitudes in degrees.
//
// We compute the ascendant/MC ourselves from Greenwich Mean Sidereal Time +
// geographic longitude + mean obliquity. astronomy-engine does not expose
// asc/MC directly; the formulas below are standard spherical-astronomy.

import * as Astronomy from 'astronomy-engine';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const SPEED_DT_DAYS = 0.01; // ~14 minutes — finite-difference step for speed

export function norm360(deg) {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

// Bodies we compute. Earth is excluded (we are geocentric).
export const PLANETS = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
];

function geocentricEcliptic(name, dateUTC) {
  // Moon has a dedicated optimized path.
  if (name === 'Moon') {
    const m = Astronomy.EclipticGeoMoon(dateUTC);
    return { lon: norm360(m.lon), lat: m.lat };
  }
  const body = Astronomy.Body[name];
  // GeoVector: geocentric J2000 equatorial Cartesian, aberration-corrected.
  const vec = Astronomy.GeoVector(body, dateUTC, true);
  // Ecliptic: rotate to true ecliptic-of-date.
  const ec = Astronomy.Ecliptic(vec);
  return { lon: norm360(ec.elon), lat: ec.elat };
}

export function computePlanetTropical(name, dateUTC) {
  const here = geocentricEcliptic(name, dateUTC);
  // Speed via finite difference. We unwrap across the 0/360 seam.
  const later = geocentricEcliptic(name, new Date(dateUTC.getTime() + SPEED_DT_DAYS * 86400000));
  let dlon = later.lon - here.lon;
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  const speed = dlon / SPEED_DT_DAYS; // degrees per day
  return {
    longitude: here.lon,
    latitude: here.lat,
    speed,
    retrograde: speed < 0,
  };
}

// Mean obliquity of the ecliptic, IAU 1980 polynomial. Arc-second accurate
// over 1900–2100, vastly tighter than astrology's 1° interpretation grain.
function meanObliquityDeg(dateUTC) {
  // Julian centuries since J2000.0 (TT — we use UT, the offset is irrelevant here).
  const jd = dateUTC.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  // 23°26'21.448" - 46.8150"*T - 0.00059"*T^2 + 0.001813"*T^3
  const epsArcsec = (23 * 3600 + 26 * 60 + 21.448)
    - 46.8150 * T
    - 0.00059 * T * T
    + 0.001813 * T * T * T;
  return epsArcsec / 3600;
}

// Compute ascendant + MC in tropical (true-of-date) ecliptic longitude.
// Standard formulas:
//   LST = GMST_deg + observer_lon_east
//   tan(MC)  = sin(LST) / (cos(LST) * cos(eps))
//   tan(Asc) = -cos(LST) / (sin(LST)*cos(eps) + tan(lat)*sin(eps))
// with quadrant correction so Asc lies in the eastern half of the ecliptic.
export function computeAscMC(dateUTC, latDeg, lonDeg) {
  const gmstHours = Astronomy.SiderealTime(dateUTC); // 0..24
  const lstDeg = norm360(gmstHours * 15 + lonDeg);
  const eps = meanObliquityDeg(dateUTC) * RAD;
  const lst = lstDeg * RAD;
  const lat = latDeg * RAD;

  // Midheaven
  let mc = Math.atan2(Math.sin(lst), Math.cos(lst) * Math.cos(eps)) * DEG;
  mc = norm360(mc);

  // Ascendant
  const y = -Math.cos(lst);
  const x = Math.sin(lst) * Math.cos(eps) + Math.tan(lat) * Math.sin(eps);
  let asc = Math.atan2(y, x) * DEG;
  asc = norm360(asc);

  // Quadrant correction: ascendant must be within 180° east of the MC
  // (i.e. the rising point is "ahead" of the culminating point on the ecliptic).
  const diff = norm360(asc - mc);
  if (diff < 180) {
    asc = norm360(asc + 180);
  }

  return { ascendant: asc, midheaven: mc };
}
