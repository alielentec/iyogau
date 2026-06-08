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
// Rahu/Ketu are the Moon's mean ascending and descending lunar nodes —
// not physical bodies, but core Vedic chart points (chhaya grahas).
export const PLANETS = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
  'Rahu', 'Ketu',
];

// Mean motion of the lunar node: −0.0529539°/day, retrograde. Using a fixed
// constant (rather than finite-differencing lunarNodeTropical) keeps the speed
// numerically stable and matches the Brown's-formula mean rate. The TRUE node
// oscillates ±~1.5° around the mean and would need a different formula; we use
// the MEAN node — see lunarNodeTropical below.
const MEAN_NODE_SPEED_DEG_PER_DAY = -0.0529539;

// Mean ascending node of the Moon, tropical ecliptic-of-date, in degrees.
// Meeus (1998) "Astronomical Algorithms" 2nd ed., equation 22.4:
//   Ω = 125.04452 − 1934.136261·T + 0.0020708·T² + T³/450000     (degrees)
// where T is Julian centuries from J2000.0.
//
// NOTE: this is the MEAN lunar node, not the true node. Swiss Ephemeris
// exposes both via SE_MEAN_NODE and SE_TRUE_NODE; the mean node is the
// standard choice for Lahiri-sidereal Vedic charts and is what most Vedic
// engines (Jagannatha Hora, Parashara's Light, etc.) use by default.
// Ported verbatim from ast/src/lib/astrology.js#lunarNodeTropical.
export function lunarNodeTropical(dateUTC) {
  const jd = dateUTC.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  return norm360(125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000);
}

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
  // Lunar nodes: not in astronomy-engine's body list. Compute from the
  // Meeus mean-node series and use the fixed mean-motion constant for speed.
  // Ecliptic latitude of a node is 0° by definition (the node IS the
  // intersection of the lunar orbit with the ecliptic plane).
  if (name === 'Rahu' || name === 'Ketu') {
    const rahuLon = lunarNodeTropical(dateUTC);
    const lon = name === 'Ketu' ? norm360(rahuLon + 180) : rahuLon;
    return {
      longitude: lon,
      latitude: 0,
      speed: MEAN_NODE_SPEED_DEG_PER_DAY,
      retrograde: true,
    };
  }

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

// Compute ascendant + MC in tropical (true-of-date) ecliptic longitude.
//
// astronomy-engine's `SiderealTime` returns Greenwich APPARENT Sidereal
// Time (GAST), which already includes nutation in right ascension via
// the equation of the equinoxes. For internal consistency we therefore
// use the TRUE obliquity (mean + nutation in obliquity Δε), available
// from `e_tilt(time).tobl`. Mixing GAST with mean-obliquity (as the
// original implementation did) is the standard IAU-2006/2000A mistake;
// it produces angle errors of up to ±9.2″ depending on nutation phase.
// Standard formulas:
//   LST = GAST_deg + observer_lon_east
//   tan(MC)  = sin(LST) / (cos(LST) * cos(eps))
//   tan(Asc) = -cos(LST) / (sin(LST)*cos(eps) + tan(lat)*sin(eps))
// with quadrant correction so Asc lies in the eastern half of the ecliptic.
export function computeAscMC(dateUTC, latDeg, lonDeg) {
  const time = Astronomy.MakeTime(dateUTC);
  const gastHours = Astronomy.SiderealTime(time); // GAST in sidereal hours [0,24)
  const lstDeg = norm360(gastHours * 15 + lonDeg);
  // True obliquity of date — pairs with GAST (both nutation-corrected).
  const eps = Astronomy.e_tilt(time).tobl * RAD;
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

  // Quadrant correction: ascendant must be within 180° east of the MC, i.e.
  // (asc - mc) mod 360 must lie in (0, 180). If atan2 returned the opposite
  // half (the descendant), flip it by 180°. Verified against Meeus 1998 Ch.13
  // and ast/src/lib/astrology.js numerical-rootfinding ascendant on three
  // independent test cases (Hamadan 1985, Seoul 1985, Einstein 1879).
  const diff = norm360(asc - mc);
  if (diff > 180) {
    asc = norm360(asc + 180);
  }

  return { ascendant: asc, midheaven: mc };
}
