// Astrocartography math: planetary lines + heat-matrix scoring.
//
// Started from ast/src/lib/astrology.js and tightened for full-world vector
// heat maps. The angular-line equations are intentionally kept standard and
// independently testable. Three responsibilities:
//
//   1. buildPlanetLines(planet, siderealDeg, weight)
//      → emit four parametric polylines (MC, IC, AC, DC) per planet
//   2. lineDistanceKm(point, line)
//      → great-circle distance from a {lat,lon} point to a polyline
//        (closed-form for MC/IC; cached segment sweep for AC/DC)
//   3. buildHeatMatrix(natal, lines, mode, resolution, currentResidence)
//      → grid of {lat,lon,value} cells, score in [0,100] per the published
//        gaussian-falloff formula
//
// The matrix is the heavy path: O(latSteps * lonSteps * planets * 4 lines).
// At the default 4° resolution → 45 * 90 * 9 * 4 ≈ 146k inner iterations,
// each one a Math.cos/sin in lineDistanceKm. With the great-circle fast path
// for MC/IC and a per-line spherical-segment cache for AC/DC, this remains
// small enough for the per-mode serverless handler budget.

import * as Astronomy from 'astronomy-engine';
import { computePlanetTropical, computeAscMC, PLANETS as PLANET_NAMES, norm360 } from './astronomy.js';
import { resolveAyanamsaValue, applyAyanamsa } from './ayanamsa.js';
import { buildWholeSignHouses, houseOf, signIndexOf } from './houses.js';

// ── Constants (parity with ast/src/lib/astrology.js:10-20) ──
const EARTH_RADIUS_KM = 6371;
const LINE_INFLUENCE_KM = 1100;
const HEAT_MATRIX_SIGMA_KM = 650;

// The heat matrix is a full-world, center-sampled vector grid. Each heat
// sample is a real map point: (x, y) in the 800x400 equirectangular SVG
// viewBox maps exactly to the same (lon, lat) used as the equation input.
// At 4° resolution the centers are lat=-88..88 and lon=-178..178, so the
// rendered cells cover the whole [-90, 90] x [-180, 180] world without
// scoring at the singular geographic poles.
const WORLD_LAT_MIN = -90;
const WORLD_LAT_MAX = 90;
const WORLD_LON_MIN = -180;
const WORLD_LON_MAX = 180;
const MAP_VIEWBOX_WIDTH = 800;
const MAP_VIEWBOX_HEIGHT = 400;
const DEFAULT_STEP = 4;
const LINE_SAMPLE_LAT_LIMIT = 89;
const HORIZON_SEED_LAT_STEP = 1;
const HORIZON_MAX_INTERPOLATION_DEG = 0.05;
const HORIZON_MAX_SUBDIVISION_DEPTH = 14;

// Mode weights (parity with ast/src/lib/data.js:MODE_CONFIG).
export const MODE_CONFIG = {
  relocation: {
    label: 'Relocation',
    description: 'Places that amplify life stability, visibility, and growth.',
    weights: { Jupiter: 1.35, Venus: 1.15, Sun: 1.05, Moon: 0.7, Mercury: 0.65, Saturn: 0.55, Rahu: 0.45, Mars: 0.2, Ketu: 0.15 },
  },
  immigration: {
    label: 'Immigration',
    description: 'Foreign movement, paperwork endurance, and settlement potential.',
    weights: { Rahu: 1.35, Jupiter: 1.05, Saturn: 1.0, Mercury: 0.85, Moon: 0.5, Venus: 0.45, Sun: 0.35, Mars: 0.25, Ketu: 0.2 },
  },
  soulmate: {
    label: 'Soulmate',
    description: 'Relationship ease, attraction, meeting probability, and harmony.',
    weights: { Venus: 1.45, Jupiter: 1.0, Moon: 0.95, Mars: 0.55, Mercury: 0.45, Sun: 0.35, Rahu: 0.3, Saturn: 0.25, Ketu: 0.2 },
  },
  soulmate_timing: {
    label: 'Soulmate Timing',
    description: 'Date-specific relationship activation layered over natal soulmate potential.',
    weights: { Venus: 1.45, Jupiter: 1.0, Moon: 0.95, Mars: 0.55, Mercury: 0.45, Sun: 0.35, Rahu: 0.3, Saturn: 0.25, Ketu: 0.2 },
  },
};

export const MODES = Object.freeze(['relocation', 'immigration', 'soulmate', 'soulmate_timing']);

const SOULMATE_TIMING_MODE = 'soulmate_timing';
const SOULMATE_TIMING_TRANSIT_WEIGHTS = Object.freeze({
  Venus: 1.35,
  Jupiter: 1.05,
  Moon: 0.95,
  Mars: 0.45,
  Mercury: 0.35,
  Rahu: 0.3,
  Sun: 0.25,
  Saturn: 0.25,
  Ketu: 0.15,
});
const SOULMATE_TIMING_BLEND = Object.freeze({
  natal: 0.62,
  transitLines: 0.28,
  transitAspects: 0.10,
});

// Astrocarto uses only the 9 Vedic-tradition bodies — Uranus/Neptune/Pluto
// are excluded because they're not in the traditional sidereal canon and have
// zero weight in every MODE_CONFIG. Filtering them here keeps the line
// count to 9*4=36 and shaves ~25% off matrix compute.
const ASTROCARTO_PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function toRadians(v) { return v * RAD; }
function toDegrees(v) { return v * DEG; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round2(v) { return Math.round(v * 100) / 100; }
function round6(v) { return Math.round(v * 1000000) / 1000000; }

// Wrap into (-180, 180]. The ast reference uses this for line-longitude
// emission; the heat-matrix grid then runs lon ∈ [-180, 180) so the seam
// stays out of the visible map area for most birth charts.
function normalizeLongitude(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function unwrapLongitudeNear(value, reference) {
  let x = value;
  while (x - reference > 180) x -= 360;
  while (x - reference < -180) x += 360;
  return x;
}

function xOfLongitude(lon) {
  return (lon - WORLD_LON_MIN) / (WORLD_LON_MAX - WORLD_LON_MIN) * MAP_VIEWBOX_WIDTH;
}

function yOfLatitude(lat) {
  return (WORLD_LAT_MAX - lat) / (WORLD_LAT_MAX - WORLD_LAT_MIN) * MAP_VIEWBOX_HEIGHT;
}

function coordinateCenters(min, max, step) {
  const centers = [];
  for (let edge = min; edge < max - 1e-9; edge += step) {
    centers.push(round6(edge + step / 2));
  }
  return centers;
}

function baseScoringMode(mode) {
  return mode === SOULMATE_TIMING_MODE ? 'soulmate' : mode;
}

// ── Equatorial coords (RA, Dec) for ecliptic longitude — used for AC/DC ──
// The Lewis formulas need (RA, Dec) of the planet at the moment of birth,
// in the TRUE equator of date (not J2000). astronomy-engine gives us the
// machinery via Rotation_ECT_EQD for ecliptic-longitude inputs (Rahu/Ketu)
// and Rotation_EQJ_EQD for geocentric-vector inputs (real planets).
function equatorialOfDateFromGeocentricVector(vector, time) {
  const equatorOfDate = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), vector);
  return Astronomy.EquatorFromVector(equatorOfDate);
}

function equatorialOfDateFromEclipticLongitude(longitude, time) {
  const eclipticOfDate = Astronomy.VectorFromSphere({ lat: 0, lon: longitude, dist: 1 }, time);
  const equatorOfDate = Astronomy.RotateVector(Astronomy.Rotation_ECT_EQD(time), eclipticOfDate);
  return Astronomy.EquatorFromVector(equatorOfDate);
}

// Bodies astronomy-engine knows directly.
const BODY_MAP = {
  Sun: Astronomy.Body.Sun,
  Moon: Astronomy.Body.Moon,
  Mercury: Astronomy.Body.Mercury,
  Venus: Astronomy.Body.Venus,
  Mars: Astronomy.Body.Mars,
  Jupiter: Astronomy.Body.Jupiter,
  Saturn: Astronomy.Body.Saturn,
};

// ── Build the per-planet natal payload used by astrocarto scoring. ──
// Returns positions[] with {key, longitude(sidereal), tropical, sign, house,
// ra, dec} for each of the 9 bodies, plus ascendant/midheaven/ascSign and
// the astronomy-engine MakeTime() instance (re-used by buildPlanetLines).
//
// This is a stripped-down sibling of calculate-chart.js#buildChart — it
// computes only what astrocarto needs (no aspects, no nakshatra, no
// navamsha) and uses the requested sidereal ayanamsa (JHora-compatible
// true Chitrapaksha by default).
export function buildAstroNatal(input, dateUTC) {
  const time = Astronomy.MakeTime(dateUTC);
  const ayanamsa = input.tradition === 'sidereal' ? resolveAyanamsaValue(input.ayanamsa, dateUTC) : 0;
  const adjust = (lonTrop) => input.tradition === 'sidereal'
    ? applyAyanamsa(lonTrop, ayanamsa)
    : norm360(lonTrop);

  const { ascendant: ascTrop, midheaven: mcTrop } = computeAscMC(dateUTC, input.lat, input.lon);
  const ascLon = adjust(ascTrop);
  const mcLon = adjust(mcTrop);
  const ascSign = signIndexOf(ascLon);
  const houses = buildWholeSignHouses(ascLon);

  const positions = ASTROCARTO_PLANETS.map((name) => {
    let tropical;
    let equatorial;
    if (name === 'Rahu' || name === 'Ketu') {
      const p = computePlanetTropical(name, dateUTC);
      tropical = p.longitude;
      equatorial = equatorialOfDateFromEclipticLongitude(tropical, time);
    } else {
      // Re-fetch the geocentric vector. computePlanetTropical does an
      // ecliptic conversion under the hood; we need the raw J2000 vector
      // to rotate into EQ-of-date for (RA, Dec). The extra GeoVector call
      // is the only redundancy with calculate-chart and costs ~0.1 ms.
      const vector = Astronomy.GeoVector(BODY_MAP[name], time, true);
      tropical = Astronomy.Ecliptic(vector).elon;
      equatorial = equatorialOfDateFromGeocentricVector(vector, time);
    }
    const sidereal = adjust(tropical);
    return {
      key: name,
      longitude: sidereal,
      tropical,
      sign: signIndexOf(sidereal),
      house: houseOf(sidereal, ascLon),
      ra: equatorial.ra,     // hours (0..24)
      dec: equatorial.dec,   // degrees
    };
  });

  return {
    ayanamsa,
    ascendant: ascLon,
    midheaven: mcLon,
    ascSign,
    houses,
    positions,
    time,
    tradition: input.tradition,
    input,
  };
}

// ── 1. PLANETARY LINES ─────────────────────────────────────────────────────
//
// JimLewis astrocartography defines four "angular lines" per planet —
// the set of geographic locations where, at the birth instant, the planet
// crosses one of the four mundane angles: Midheaven (MC, planet on the
// upper meridian), Imum Coeli (IC, lower meridian), Ascendant (AC, rising
// at the eastern horizon), Descendant (DC, setting at the western horizon).
//
//   MC line:  H = 0 with H = LST - RA  ⇒  LST = RA  ⇒  lon = RA - GAST
//   IC line:  MC line ± 180°
//   AC/DC:    cos(H) = -tan(lat) * tan(dec)  (the standard rising/setting equation)
//
// All angles in degrees. siderealDeg = Greenwich apparent sidereal time × 15
// (i.e. converted from sidereal hours to degrees).
function horizonPoint(planet, siderealDeg, latitude, type) {
  const tanDec = Math.tan(toRadians(planet.dec));
  const cosHRaw = -Math.tan(toRadians(latitude)) * tanDec;
  if (Math.abs(cosHRaw) > 1 + 1e-12) return null;
  const cosH = clamp(cosHRaw, -1, 1);
  const hourAngle = toDegrees(Math.acos(cosH));
  const sign = type === 'DC' ? 1 : -1;
  const longitude = normalizeLongitude(planet.ra * 15 + sign * hourAngle - siderealDeg);
  return [longitude, latitude];
}

function isHorizonLatitudeValid(planet, latitude) {
  const cosH = -Math.tan(toRadians(latitude)) * Math.tan(toRadians(planet.dec));
  return Math.abs(cosH) <= 1;
}

function refineHorizonBoundary(planet, invalidLatitude, validLatitude, type, siderealDeg) {
  let invalid = invalidLatitude;
  let valid = validLatitude;
  for (let i = 0; i < 44; i += 1) {
    const mid = (invalid + valid) / 2;
    if (isHorizonLatitudeValid(planet, mid)) valid = mid;
    else invalid = mid;
  }
  return horizonPoint(planet, siderealDeg, valid, type);
}

function midpointProjectionErrorDeg(a, b, mid) {
  const bLon = unwrapLongitudeNear(b[0], a[0]);
  const midLon = unwrapLongitudeNear(mid[0], a[0]);
  const linearLon = a[0] + (bLon - a[0]) / 2;
  return Math.abs(midLon - linearLon);
}

function appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, a, b, depth = 0) {
  const midLat = (a[1] + b[1]) / 2;
  const mid = horizonPoint(planet, siderealDeg, midLat, type);
  if (!mid || depth >= HORIZON_MAX_SUBDIVISION_DEPTH || midpointProjectionErrorDeg(a, b, mid) <= HORIZON_MAX_INTERPOLATION_DEG) {
    points.push(b);
    return;
  }
  appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, a, mid, depth + 1);
  appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, mid, b, depth + 1);
}

function buildHorizonCurve(planet, siderealDeg, type) {
  const points = [];
  let prevLat = -LINE_SAMPLE_LAT_LIMIT;
  let prev = horizonPoint(planet, siderealDeg, prevLat, type);
  if (prev) points.push(prev);

  for (let lat = -LINE_SAMPLE_LAT_LIMIT + HORIZON_SEED_LAT_STEP; lat <= LINE_SAMPLE_LAT_LIMIT + 1e-9; lat += HORIZON_SEED_LAT_STEP) {
    const currLat = Math.min(LINE_SAMPLE_LAT_LIMIT, round6(lat));
    const curr = horizonPoint(planet, siderealDeg, currLat, type);

    if (prev && curr) {
      appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, prev, curr);
    } else if (!prev && curr) {
      const boundary = refineHorizonBoundary(planet, prevLat, currLat, type, siderealDeg);
      if (boundary) {
        points.push(boundary);
        appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, boundary, curr);
      } else {
        points.push(curr);
      }
    } else if (prev && !curr) {
      const boundary = refineHorizonBoundary(planet, currLat, prevLat, type, siderealDeg);
      if (boundary) appendAdaptiveHorizonSegment(points, planet, siderealDeg, type, prev, boundary);
    }

    prevLat = currLat;
    prev = curr;
  }

  return points;
}

export function buildPlanetLines(planet, siderealDeg, weight) {
  const raDeg = planet.ra * 15;
  const mcLon = normalizeLongitude(raDeg - siderealDeg);
  const icLon = normalizeLongitude(mcLon + 180);

  // MC/IC: straight meridian lines. Two endpoints suffice; lineDistanceKm
  // uses a closed-form great-circle formula for these.
  const base = [
    { planet: planet.key, type: 'MC', weight, scoreType: 'visibility',
      points: [[mcLon, WORLD_LAT_MIN], [mcLon, WORLD_LAT_MAX]] },
    { planet: planet.key, type: 'IC', weight: weight * 0.85, scoreType: 'home',
      points: [[icLon, WORLD_LAT_MIN], [icLon, WORLD_LAT_MAX]] },
  ];

  // AC/DC: rising/setting curves. We seed at 1° latitude, refine the
  // circumpolar/anti-circumpolar boundaries, then recursively subdivide
  // segments until the SVG straight-line interpolation stays within
  // HORIZON_MAX_INTERPOLATION_DEG of the exact horizon equation.
  const ac = buildHorizonCurve(planet, siderealDeg, 'AC');
  const dc = buildHorizonCurve(planet, siderealDeg, 'DC');

  return [
    ...base,
    { planet: planet.key, type: 'AC', weight: weight * 0.95, scoreType: 'self', points: ac },
    { planet: planet.key, type: 'DC', weight: weight * 0.95, scoreType: 'partners', points: dc },
  ].filter((line) => line.points.length > 1);
}

// ── 2. DISTANCE FROM POINT TO LINE ─────────────────────────────────────────
//
// For MC/IC (meridians), use the closed-form great-circle distance to a
// meridian: arcsin(|cos(lat) * sin(Δlon)|) * R. O(1).
//
// For AC/DC (rising/setting curves), the polyline is many short great-circle
// segments. Compute distance to each segment via the standard 3-vector
// spherical-geometry algorithm:
//   1. Take the great-circle plane defined by the two endpoints (normal = cross product).
//   2. Project the query point onto that plane (subtract the normal component).
//   3. If the projection lies on the arc (sum of arc-distances to endpoints
//      ≈ segment arc), return the angular distance from the point to the
//      projection. Otherwise return the smaller of the two endpoint distances.
// Segments are cached per-line in a WeakMap; subsequent calls for the same
// line avoid recomputing the vectors/normals (~30% speedup on the matrix).
const LINE_SEGMENT_CACHE = new WeakMap();

function geographicVector(lat, lon) {
  const phi = toRadians(lat);
  const lambda = toRadians(lon);
  return {
    x: Math.cos(phi) * Math.cos(lambda),
    y: Math.cos(phi) * Math.sin(lambda),
    z: Math.sin(phi),
  };
}

function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function vcross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vnorm(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!length) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function angularDistanceRad(a, b) {
  return Math.acos(clamp(vdot(a, b), -1, 1));
}

function sphericalSegmentsForLine(line) {
  const cached = LINE_SEGMENT_CACHE.get(line);
  if (cached) return cached;
  const segments = [];
  for (let i = 0; i < line.points.length - 1; i += 1) {
    const startPoint = line.points[i];
    const endPoint = line.points[i + 1];
    const start = geographicVector(startPoint[1], startPoint[0]);
    const end = geographicVector(endPoint[1], endPoint[0]);
    const arc = angularDistanceRad(start, end);
    const normal = vnorm(vcross(start, end));
    segments.push({ start, end, arc, normal });
  }
  LINE_SEGMENT_CACHE.set(line, segments);
  return segments;
}

function sphericalSegmentDistanceKm(point, segment) {
  if (segment.arc < 1e-12) return angularDistanceRad(point, segment.start) * EARTH_RADIUS_KM;
  if (!segment.normal) return Math.min(angularDistanceRad(point, segment.start), angularDistanceRad(point, segment.end)) * EARTH_RADIUS_KM;
  const projected = vnorm({
    x: point.x - vdot(point, segment.normal) * segment.normal.x,
    y: point.y - vdot(point, segment.normal) * segment.normal.y,
    z: point.z - vdot(point, segment.normal) * segment.normal.z,
  });
  if (!projected) return Math.min(angularDistanceRad(point, segment.start), angularDistanceRad(point, segment.end)) * EARTH_RADIUS_KM;
  const onSegment = angularDistanceRad(segment.start, projected) + angularDistanceRad(projected, segment.end) <= segment.arc + 1e-8;
  if (onSegment) return angularDistanceRad(point, projected) * EARTH_RADIUS_KM;
  return Math.min(angularDistanceRad(point, segment.start), angularDistanceRad(point, segment.end)) * EARTH_RADIUS_KM;
}

export function lineDistanceKm(loc, line) {
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !line?.points?.length) return Infinity;
  if (line.type === 'MC' || line.type === 'IC') {
    const longitudeDelta = Math.abs(normalizeLongitude(lon - line.points[0][0]));
    return Math.asin(Math.min(1, Math.abs(Math.cos(toRadians(lat)) * Math.sin(toRadians(longitudeDelta))))) * EARTH_RADIUS_KM;
  }
  const point = geographicVector(lat, lon);
  let closest = Infinity;
  const segments = sphericalSegmentsForLine(line);
  for (let i = 0; i < segments.length; i += 1) {
    closest = Math.min(closest, sphericalSegmentDistanceKm(point, segments[i]));
  }
  return closest;
}

// ── 3. CELL SCORING ─────────────────────────────────────────────────────────
//
// Per ast/src/lib/astrology.js#scoreMatrixCell. Gaussian falloff in km
// (σ = 650 km), top-5 line contributions weighted-summed and divided by 4.2,
// plus a mode adjustment (+8 for soulmate when Venus is in a relational
// house; +9 for immigration when natal shows foreign signal), plus the
// immigration distance/timing adjustment when applicable. Result clamped to
// [0, 100] integers.
function gaussianClosenessKm(distanceKm) {
  return Math.exp(-Math.pow(distanceKm / HEAT_MATRIX_SIGMA_KM, 2));
}

function hasForeignSignal(natal) {
  return natal.positions.some((p) => ['Rahu', 'Jupiter', 'Saturn'].includes(p.key) && [9, 10, 11, 12].includes(p.house));
}

function geoDistanceKm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every((v) => Number.isFinite(Number(v)))) return 0;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const dLat = toRadians(Number(b.lat) - Number(a.lat));
  const dLon = toRadians(normalizeLongitude(Number(b.lon) - Number(a.lon)));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function immigrationDistanceAdjustment(distanceKm) {
  if (distanceKm < 250) return -8;
  if (distanceKm < 1000) return -2;
  if (distanceKm < 4500) return 4;
  return 7;
}

function matrixImmigrationDistanceAdjustment(natal, mode, location) {
  if (mode !== 'immigration' || !natal.currentResidence) return 0;
  const distanceKm = geoDistanceKm(natal.currentResidence, location);
  // No dasha → timing component is zero. Keep the formula structure for parity.
  return clamp(Math.round(immigrationDistanceAdjustment(distanceKm) * 0.7), -8, 10);
}

function lineContributions(lines, location, source = 'natal') {
  return lines
    .map((line) => {
      const distance = lineDistanceKm(location, line);
      const closeness = gaussianClosenessKm(distance);
      const base = closeness * 100 * line.weight;
      const angularBonus = line.type === 'MC' || line.type === 'DC' ? 1.06 : 1;
      return {
        planet: line.planet,
        type: line.type,
        distance,
        value: base * angularBonus,
        source,
      };
    })
    .filter((item) => item.value > 1.2)
    .sort((a, b) => b.value - a.value);
}

function staticModeRawScore(natal, contributions, mode, location) {
  const venus = natal.positions.find((p) => p.key === 'Venus');
  const relationshipHouse = venus ? venus.house : 7;
  const modeAdjustment =
    mode === 'soulmate' && [5, 7, 9, 11].includes(relationshipHouse) ? 8
    : mode === 'immigration' && hasForeignSignal(natal) ? 9
    : 0;
  return (
    contributions.slice(0, 5).reduce((sum, item) => sum + item.value, 0) / 4.2
    + modeAdjustment
    + matrixImmigrationDistanceAdjustment(natal, mode, location)
  );
}

function angularSeparationDeg(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

function aspectClosenessDeg(separation, exact, orb) {
  const delta = Math.abs(separation - exact);
  if (delta > orb) return 0;
  return 1 - delta / orb;
}

function relationshipTransitActivationScore(natal, transitPositions) {
  const natalWeights = { Venus: 1.4, Moon: 1.0, Jupiter: 0.9, Mars: 0.45, Rahu: 0.35 };
  const transitWeights = { Venus: 1.35, Jupiter: 1.05, Moon: 0.85, Mars: 0.4, Rahu: 0.3 };
  const aspects = [
    { angle: 0, weight: 1.0 },
    { angle: 60, weight: 0.45 },
    { angle: 120, weight: 0.8 },
    { angle: 180, weight: 0.55 },
  ];

  let raw = 0;
  for (const transit of transitPositions) {
    const tw = transitWeights[transit.key] || 0;
    if (!tw) continue;
    for (const natalPlanet of natal.positions) {
      const nw = natalWeights[natalPlanet.key] || 0;
      if (!nw) continue;
      const sep = angularSeparationDeg(transit.longitude, natalPlanet.longitude);
      for (const aspect of aspects) {
        const closeness = aspectClosenessDeg(sep, aspect.angle, transit.key === 'Moon' ? 4.5 : 6);
        if (closeness > 0) raw += closeness * aspect.weight * tw * nw;
      }
    }
  }

  return clamp(Math.round(raw * 9), 0, 100);
}

function dateStringUTC(dateUTC) {
  return dateUTC.toISOString().slice(0, 10);
}

function parseDateStringUTC(dateString) {
  const [year, month, day] = String(dateString || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function daysInUTCMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addYearsClampedUTC(dateUTC, years) {
  const year = dateUTC.getUTCFullYear() + years;
  const month = dateUTC.getUTCMonth();
  const day = Math.min(dateUTC.getUTCDate(), daysInUTCMonth(year, month));
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

function addDaysUTC(dateUTC, days) {
  return new Date(Date.UTC(
    dateUTC.getUTCFullYear(),
    dateUTC.getUTCMonth(),
    dateUTC.getUTCDate() + days,
    12,
    0,
    0,
  ));
}

function daysBetweenUTC(startUTC, endUTC) {
  const start = Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), startUTC.getUTCDate());
  const end = Date.UTC(endUTC.getUTCFullYear(), endUTC.getUTCMonth(), endUTC.getUTCDate());
  return Math.round((end - start) / 86400000);
}

function ageYearsAtDate(startUTC, dateUTC) {
  return Math.round(daysBetweenUTC(startUTC, dateUTC) / 365.2425 * 100) / 100;
}

export function buildSoulmateTimingBounds(birthDateString) {
  const start = parseDateStringUTC(birthDateString);
  if (!start) throw new Error(`Invalid birth date for soulmate timing bounds: ${birthDateString}`);
  const end = addYearsClampedUTC(start, 50);
  return {
    startDate: dateStringUTC(start),
    endDate: dateStringUTC(end),
    totalDays: daysBetweenUTC(start, end),
  };
}

export function buildSoulmateTimingContext(natal, targetDateUTC) {
  const target = targetDateUTC instanceof Date && Number.isFinite(targetDateUTC.getTime())
    ? targetDateUTC
    : new Date();
  const targetNoonUTC = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 12, 0, 0));
  const targetDate = dateStringUTC(targetNoonUTC);
  const transitNatal = buildAstroNatal({
    ...natal.input,
    date: targetDate,
    time: '12:00',
    tz: '+00:00',
    unknownTime: false,
  }, targetNoonUTC);
  const transitGastDeg = Astronomy.SiderealTime(transitNatal.time) * 15;
  const transitLines = transitNatal.positions
    .filter((planet) => SOULMATE_TIMING_TRANSIT_WEIGHTS[planet.key] > 0)
    .flatMap((planet) => buildPlanetLines(planet, transitGastDeg, SOULMATE_TIMING_TRANSIT_WEIGHTS[planet.key]));

  return {
    targetDate,
    targetTimeUTC: '12:00',
    blend: SOULMATE_TIMING_BLEND,
    transitWeights: SOULMATE_TIMING_TRANSIT_WEIGHTS,
    globalActivationScore: relationshipTransitActivationScore(natal, transitNatal.positions),
    lines: transitLines,
  };
}

function timingLocationSample(natal, lines, location, targetDateUTC, startDateUTC) {
  const timingContext = buildSoulmateTimingContext(natal, targetDateUTC);
  const scored = scoreMatrixCell(natal, lines, SOULMATE_TIMING_MODE, location, { timingContext });
  return {
    date: timingContext.targetDate,
    ageYears: ageYearsAtDate(startDateUTC, targetDateUTC),
    score: scored.value,
    globalActivationScore: timingContext.globalActivationScore,
    topContributors: scored.top,
  };
}

function uniqueDateStrings(dates) {
  const out = [];
  const seen = new Set();
  for (const date of dates) {
    const key = dateStringUTC(date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(date);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

function selectSeparatedCandidates(samples, count, minSeparationDays) {
  const selected = [];
  const ordered = samples.slice().sort((a, b) => b.score - a.score);
  for (const sample of ordered) {
    if (selected.every((picked) => Math.abs(daysBetweenUTC(parseDateStringUTC(picked.date), parseDateStringUTC(sample.date))) >= minSeparationDays)) {
      selected.push(sample);
      if (selected.length >= count) break;
    }
  }
  return selected;
}

function buildActivationWindows(samples, peakScore, fineStepDays, startDateUTC, endDateUTC) {
  if (!samples.length) return [];
  const threshold = Math.max(0, Math.round(peakScore - 4));
  const sorted = samples
    .filter((sample) => sample.score >= threshold)
    .sort((a, b) => a.date.localeCompare(b.date));
  const windows = [];
  let group = [];

  function flush() {
    if (!group.length) return;
    const peak = group.slice().sort((a, b) => b.score - a.score)[0];
    const first = parseDateStringUTC(group[0].date);
    const last = parseDateStringUTC(group[group.length - 1].date);
    const start = addDaysUTC(first, -Math.ceil(fineStepDays / 2));
    const end = addDaysUTC(last, Math.ceil(fineStepDays / 2));
    const boundedStart = start < startDateUTC ? startDateUTC : start;
    const boundedEnd = end > endDateUTC ? endDateUTC : end;
    windows.push({
      startDate: dateStringUTC(boundedStart),
      endDate: dateStringUTC(boundedEnd),
      peakDate: peak.date,
      peakAgeYears: peak.ageYears,
      peakScore: peak.score,
      averageScore: Math.round(group.reduce((sum, item) => sum + item.score, 0) / group.length),
      durationDays: Math.max(1, daysBetweenUTC(boundedStart, boundedEnd)),
      topContributors: peak.topContributors,
    });
    group = [];
  }

  for (const sample of sorted) {
    if (!group.length) {
      group.push(sample);
      continue;
    }
    const prev = parseDateStringUTC(group[group.length - 1].date);
    const current = parseDateStringUTC(sample.date);
    if (daysBetweenUTC(prev, current) <= fineStepDays + 1) {
      group.push(sample);
    } else {
      flush();
      group.push(sample);
    }
  }
  flush();

  return windows
    .sort((a, b) => b.peakScore - a.peakScore || b.averageScore - a.averageScore)
    .slice(0, 5);
}

export function buildSoulmateTimingTimeline(natal, lines, location, opts = {}) {
  const startDateUTC = parseDateStringUTC(opts.startDate || natal.input?.date);
  const endDateUTC = opts.endDate
    ? parseDateStringUTC(opts.endDate)
    : addYearsClampedUTC(startDateUTC, 50);
  if (!startDateUTC || !endDateUTC || endDateUTC < startDateUTC) {
    throw new Error('Invalid soulmate timing timeline bounds.');
  }

  const coarseStepDays = clamp(Math.round(opts.coarseStepDays ?? 21), 7, 60);
  const fineStepDays = clamp(Math.round(opts.fineStepDays ?? 7), 1, 21);
  const refineWindowDays = clamp(Math.round(opts.refineWindowDays ?? 45), 14, 120);
  const candidateCount = clamp(Math.round(opts.candidateCount ?? 8), 1, 16);
  const totalDays = daysBetweenUTC(startDateUTC, endDateUTC);
  const cache = new Map();

  function sampleAt(dateUTC) {
    const bounded = dateUTC < startDateUTC ? startDateUTC : (dateUTC > endDateUTC ? endDateUTC : dateUTC);
    const key = dateStringUTC(bounded);
    if (!cache.has(key)) {
      cache.set(key, timingLocationSample(natal, lines, location, bounded, startDateUTC));
    }
    return cache.get(key);
  }

  const coarseDates = [];
  for (let offset = 0; offset <= totalDays; offset += coarseStepDays) {
    coarseDates.push(addDaysUTC(startDateUTC, offset));
  }
  coarseDates.push(endDateUTC);
  const coarseSamples = uniqueDateStrings(coarseDates).map(sampleAt);
  const candidates = selectSeparatedCandidates(coarseSamples, candidateCount, refineWindowDays);
  const fineDates = [];
  for (const candidate of candidates) {
    const center = parseDateStringUTC(candidate.date);
    for (let offset = -refineWindowDays; offset <= refineWindowDays; offset += fineStepDays) {
      fineDates.push(addDaysUTC(center, offset));
    }
  }
  fineDates.push(...candidates.map((candidate) => parseDateStringUTC(candidate.date)));
  const refinedSamples = uniqueDateStrings(fineDates).map(sampleAt);
  const allSamples = Array.from(cache.values());
  const peakSample = allSamples.slice().sort((a, b) => b.score - a.score)[0] || null;
  const topSamples = selectSeparatedCandidates(allSamples, 12, fineStepDays * 2)
    .map((sample) => ({
      date: sample.date,
      ageYears: sample.ageYears,
      score: sample.score,
      globalActivationScore: sample.globalActivationScore,
      topContributors: sample.topContributors,
    }));

  return {
    location: {
      lat: round6(Number(location.lat)),
      lon: round6(Number(location.lon)),
      city: typeof location.city === 'string' ? location.city : null,
      country: typeof location.country === 'string' ? location.country : null,
    },
    startDate: dateStringUTC(startDateUTC),
    endDate: dateStringUTC(endDateUTC),
    totalDays,
    scan: {
      coarseStepDays,
      fineStepDays,
      refineWindowDays,
      coarseSamples: coarseSamples.length,
      refinedSamples: refinedSamples.length,
      totalUniqueSamples: allSamples.length,
    },
    peakScore: peakSample ? peakSample.score : 0,
    peakDate: peakSample ? peakSample.date : null,
    peakAgeYears: peakSample ? peakSample.ageYears : null,
    windows: buildActivationWindows(refinedSamples, peakSample ? peakSample.score : 0, fineStepDays, startDateUTC, endDateUTC),
    topSamples,
  };
}

export function scoreMatrixCell(natal, lines, mode, location, opts = {}) {
  const scoringMode = baseScoringMode(mode);
  const contributions = lineContributions(lines, location, 'natal');
  let raw = staticModeRawScore(natal, contributions, scoringMode, location);
  let topContributions = contributions;

  if (mode === SOULMATE_TIMING_MODE && opts.timingContext) {
    const transitContributions = lineContributions(opts.timingContext.lines || [], location, 'transit');
    const transitLineRaw = transitContributions.slice(0, 5).reduce((sum, item) => sum + item.value, 0) / 4.8;
    raw =
      raw * SOULMATE_TIMING_BLEND.natal
      + transitLineRaw * SOULMATE_TIMING_BLEND.transitLines
      + opts.timingContext.globalActivationScore * SOULMATE_TIMING_BLEND.transitAspects;
    topContributions = contributions
      .slice(0, 3)
      .concat(transitContributions.slice(0, 3))
      .sort((a, b) => b.value - a.value);
  }

  const value = clamp(Math.round(raw), 0, 100);

  return {
    lat: location.lat,
    lon: location.lon,
    value,
    top: topContributions.slice(0, 3).map((item) => ({
      planet: item.planet,
      type: item.type,
      source: item.source,
      distance: Math.round(item.distance * 10) / 10,
      value: Math.round(item.value * 10) / 10,
    })),
  };
}

// ── 4. MATRIX BUILDER ──────────────────────────────────────────────────────
export function buildHeatMatrix(natal, lines, mode, opts = {}) {
  const latMin = opts.latMin ?? WORLD_LAT_MIN;
  const latMax = opts.latMax ?? WORLD_LAT_MAX;
  const lonMin = opts.lonMin ?? WORLD_LON_MIN;
  const lonMax = opts.lonMax ?? WORLD_LON_MAX;
  const latStep = opts.latStep ?? DEFAULT_STEP;
  const lonStep = opts.lonStep ?? DEFAULT_STEP;

  const latitudes = coordinateCenters(latMin, latMax, latStep);
  const longitudes = coordinateCenters(lonMin, lonMax, lonStep);
  const xCoordinates = longitudes.map((lon) => round6(xOfLongitude(lon)));
  const yCoordinates = latitudes.map((lat) => round6(yOfLatitude(lat)));

  let minValue = 100;
  let maxValue = 0;
  // Allocate the values grid up-front. Emitting `cells: rows.flat()` like
  // the reference doubles memory; we keep both `values` (compact for SVG
  // tinting) and `cellMeta` (top-3 line breakdown per cell, used by the
  // tooltip layer). The frontend only walks `cellMeta` lazily on hover, so
  // it's cheap to ship.
  const values = new Array(latitudes.length);
  const cellMeta = new Array(latitudes.length);
  const cells = [];
  for (let i = 0; i < latitudes.length; i += 1) {
    const lat = latitudes[i];
    const row = new Array(longitudes.length);
    const metaRow = new Array(longitudes.length);
    for (let j = 0; j < longitudes.length; j += 1) {
      const cell = scoreMatrixCell(natal, lines, mode, { lat, lon: longitudes[j] }, opts);
      row[j] = cell.value;
      metaRow[j] = cell.top; // only the small top-3 array, lat/lon implied by index
      if (cell.value < minValue) minValue = cell.value;
      if (cell.value > maxValue) maxValue = cell.value;
      cells.push({
        row: i,
        col: j,
        x: xCoordinates[j],
        y: yCoordinates[i],
        lat,
        lon: longitudes[j],
        value: cell.value,
      });
    }
    values[i] = row;
    cellMeta[i] = metaRow;
  }

  return {
    formula: 'angular-distance-km-v3-world-center-grid',
    sigmaKm: HEAT_MATRIX_SIGMA_KM,
    influenceKm: LINE_INFLUENCE_KM,
    projection: {
      type: 'equirectangular',
      viewBox: [0, 0, MAP_VIEWBOX_WIDTH, MAP_VIEWBOX_HEIGHT],
      lonRange: [WORLD_LON_MIN, WORLD_LON_MAX],
      latRange: [WORLD_LAT_MIN, WORLD_LAT_MAX],
      xFormula: '(lon + 180) / 360 * width',
      yFormula: '(90 - lat) / 180 * height',
    },
    coordinateRole: 'cell-center',
    latRange: [latMin, latMax],
    lonRange: [lonMin, lonMax],
    latStep,
    lonStep,
    latitudes,
    longitudes,
    xCoordinates,
    yCoordinates,
    values,
    cellMeta,
    cells,
    minValue,
    maxValue,
  };
}

// ── 5. ORCHESTRATOR ─────────────────────────────────────────────────────────
//
// Top-level entry point used by the handler. Returns the full astrocarto
// payload (lines + matrix + provenance).
export function astroCartography(natal, mode, opts = {}) {
  const cfg = MODE_CONFIG[mode];
  if (!cfg) throw new Error(`Unknown mode: ${mode}`);
  const weights = cfg.weights;

  // GAST in degrees, via astronomy-engine. Apparent sidereal time pairs
  // with true-equator-of-date RA/Dec, which buildAstroNatal computes above.
  const gastDeg = Astronomy.SiderealTime(natal.time) * 15;

  const lines = natal.positions
    .filter((planet) => weights[planet.key] > 0)
    .flatMap((planet) => buildPlanetLines(planet, gastDeg, weights[planet.key]));

  const timingContext = mode === SOULMATE_TIMING_MODE
    ? buildSoulmateTimingContext(natal, opts.targetDateUTC)
    : null;

  const heatMatrix = opts.includeHeat === false
    ? null
    : buildHeatMatrix(natal, lines, mode, { ...opts, timingContext });

  return {
    mode,
    modeLabel: cfg.label,
    modeWeights: weights,
    lines,
    heatMatrix,
    timing: timingContext,
  };
}

// Constants exported for tests & debug.
export const ASTROCARTO_CONSTANTS = Object.freeze({
  EARTH_RADIUS_KM,
  LINE_INFLUENCE_KM,
  HEAT_MATRIX_SIGMA_KM,
  WORLD_LAT_MIN,
  WORLD_LAT_MAX,
  WORLD_LON_MIN,
  WORLD_LON_MAX,
  MAP_VIEWBOX_WIDTH,
  MAP_VIEWBOX_HEIGHT,
  DEFAULT_STEP,
  LINE_SAMPLE_LAT_LIMIT,
  HORIZON_SEED_LAT_STEP,
  HORIZON_MAX_INTERPOLATION_DEG,
  ASTROCARTO_PLANETS,
  ALL_BODIES: PLANET_NAMES,
});
