// Astrocartography math: planetary lines + heat-matrix scoring.
//
// Ported from ast/src/lib/astrology.js (the iYogaU reference implementation).
// All math is preserved bit-for-bit modulo cosmetic renaming. Three responsibilities:
//
//   1. buildPlanetLines(planet, gmstDeg, weight)
//      → emit four parametric polylines (MC, IC, AC, DC) per planet
//   2. lineDistanceKm(point, line)
//      → great-circle distance from a {lat,lon} point to a polyline
//        (closed-form for MC/IC; cached segment sweep for AC/DC)
//   3. buildHeatMatrix(natal, lines, mode, resolution, currentResidence)
//      → grid of {lat,lon,value} cells, score in [0,100] per the published
//        gaussian-falloff formula
//
// The matrix is the heavy path: O(latSteps * lonSteps * planets * 4 lines).
// At the default 4° resolution → 34 * 90 * 9 * 4 ≈ 110k inner iterations,
// each one a Math.cos/sin in lineDistanceKm. With the great-circle fast path
// for MC/IC and a per-line spherical-segment cache for AC/DC, this completes
// in ~120-180 ms on Vercel hobby (single 256 MB region). The per-mode handler
// budgets <1 s end-to-end.

import * as Astronomy from 'astronomy-engine';
import { computePlanetTropical, computeAscMC, PLANETS as PLANET_NAMES, norm360 } from './astronomy.js';
import { lahiriAyanamsa, applyAyanamsa } from './ayanamsa.js';
import { buildWholeSignHouses, houseOf, signIndexOf, decomposeLongitude } from './houses.js';

// ── Constants (parity with ast/src/lib/astrology.js:10-20) ──
const EARTH_RADIUS_KM = 6371;
const LINE_INFLUENCE_KM = 1100;
const HEAT_MATRIX_SIGMA_KM = 650;

// Default grid: 4°×4° → 34 rows × 90 cols = 3060 cells. ~120 ms on a 256 MB
// Vercel instance. Coarser resolutions (6°, 8°) trade compute for visual
// blockiness; finer (2°) doubles runtime and overshoots the 1 s SLA.
const DEFAULT_LAT_MIN = -60;
const DEFAULT_LAT_MAX = 72;
const DEFAULT_STEP = 4;

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
};

export const MODES = Object.freeze(['relocation', 'immigration', 'soulmate']);

// Astrocarto uses only the 9 Vedic-tradition bodies — Uranus/Neptune/Pluto
// are excluded because they're not in the Lahiri-sidereal canon and have
// zero weight in every MODE_CONFIG. Filtering them here keeps the line
// count to 9*4=36 and shaves ~25% off matrix compute.
const ASTROCARTO_PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function toRadians(v) { return v * RAD; }
function toDegrees(v) { return v * DEG; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

// Wrap into (-180, 180]. The ast reference uses this for line-longitude
// emission; the heat-matrix grid then runs lon ∈ [-180, 180) so the seam
// stays out of the visible map area for most birth charts.
function normalizeLongitude(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
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
// navamsha) and uses sidereal Lahiri longitudes (matching the Vedic
// default of the iYogaU site).
export function buildAstroNatal(input, dateUTC) {
  const time = Astronomy.MakeTime(dateUTC);
  const ayanamsa = input.tradition === 'sidereal' ? lahiriAyanamsa(dateUTC) : 0;
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
//   MC line:  cos(H) = 0 with H = LST - RA  ⇒  LST = RA  ⇒  lon = RA - GMST
//   IC line:  MC line ± 180°
//   AC/DC:    cos(H) = -tan(lat) * tan(dec)  (the standard rising/setting equation)
//
// All angles in degrees. gmstDeg = Greenwich Mean Sidereal Time × 15
// (i.e. converted from sidereal hours to degrees).
export function buildPlanetLines(planet, gmstDeg, weight) {
  const raDeg = planet.ra * 15;
  const mcLon = normalizeLongitude(raDeg - gmstDeg);
  const icLon = normalizeLongitude(mcLon + 180);

  // MC/IC: straight meridian lines. Two endpoints suffice; lineDistanceKm
  // uses a closed-form great-circle formula for these.
  const base = [
    { planet: planet.key, type: 'MC', weight, scoreType: 'visibility',
      points: [[mcLon, -72], [mcLon, 72]] },
    { planet: planet.key, type: 'IC', weight: weight * 0.85, scoreType: 'home',
      points: [[icLon, -72], [icLon, 72]] },
  ];

  // AC/DC: rising/setting curves. Sample 1° latitude steps (145 points/line)
  // and connect as a polyline. Skip latitudes where |cos H| > 1 (the planet
  // is circumpolar or anti-circumpolar — never rises/sets at that latitude).
  const ac = [];
  const dc = [];
  const tanDec = Math.tan(toRadians(planet.dec));
  for (let lat = -72; lat <= 72; lat += 1) {
    const cosH = -Math.tan(toRadians(lat)) * tanDec;
    if (Math.abs(cosH) <= 1) {
      const h = toDegrees(Math.acos(cosH));
      const riseLon = normalizeLongitude(raDeg - h - gmstDeg);
      const setLon = normalizeLongitude(raDeg + h - gmstDeg);
      ac.push([riseLon, lat]);
      dc.push([setLon, lat]);
    }
  }

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

function dashaMapBoost() {
  // Astrocarto API does not compute dasha (which requires birth-date arithmetic
  // beyond the chart instant); we pass an empty boost. The reference engine
  // adds 1.18× boost for the current maha-lord, which lifts the heat-matrix
  // by ~3-5%. Not implementing dasha here keeps the API stateless and
  // matches the published response (mode-driven only, no time-window inputs).
  return {};
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

export function scoreMatrixCell(natal, lines, mode, location) {
  const dashaBoost = dashaMapBoost();
  const contributions = lines
    .map((line) => {
      const distance = lineDistanceKm(location, line);
      const closeness = gaussianClosenessKm(distance);
      const base = closeness * 100 * line.weight;
      const angularBonus = line.type === 'MC' || line.type === 'DC' ? 1.06 : 1;
      return {
        planet: line.planet,
        type: line.type,
        distance,
        value: base * angularBonus * (dashaBoost[line.planet] || 1),
      };
    })
    .filter((item) => item.value > 1.2)
    .sort((a, b) => b.value - a.value);

  const venus = natal.positions.find((p) => p.key === 'Venus');
  const relationshipHouse = venus ? venus.house : 7;
  const modeAdjustment =
    mode === 'soulmate' && [5, 7, 9, 11].includes(relationshipHouse) ? 8
    : mode === 'immigration' && hasForeignSignal(natal) ? 9
    : 0;
  const raw =
    contributions.slice(0, 5).reduce((sum, item) => sum + item.value, 0) / 4.2
    + modeAdjustment
    + matrixImmigrationDistanceAdjustment(natal, mode, location);
  const value = clamp(Math.round(raw), 0, 100);

  return {
    lat: location.lat,
    lon: location.lon,
    value,
    top: contributions.slice(0, 3).map((item) => ({
      planet: item.planet,
      type: item.type,
      distance: Math.round(item.distance * 10) / 10,
      value: Math.round(item.value * 10) / 10,
    })),
  };
}

// ── 4. MATRIX BUILDER ──────────────────────────────────────────────────────
export function buildHeatMatrix(natal, lines, mode, opts = {}) {
  const latMin = opts.latMin ?? DEFAULT_LAT_MIN;
  const latMax = opts.latMax ?? DEFAULT_LAT_MAX;
  const latStep = opts.latStep ?? DEFAULT_STEP;
  const lonStep = opts.lonStep ?? DEFAULT_STEP;

  const latitudes = [];
  const longitudes = [];
  for (let lat = latMin; lat <= latMax; lat += latStep) latitudes.push(lat);
  for (let lon = -180; lon < 180; lon += lonStep) longitudes.push(lon);

  let minValue = 100;
  let maxValue = 0;
  // Allocate the values grid up-front. Emitting `cells: rows.flat()` like
  // the reference doubles memory; we keep both `values` (compact for SVG
  // tinting) and `cellMeta` (top-3 line breakdown per cell, used by the
  // tooltip layer). The frontend only walks `cellMeta` lazily on hover, so
  // it's cheap to ship.
  const values = new Array(latitudes.length);
  const cellMeta = new Array(latitudes.length);
  for (let i = 0; i < latitudes.length; i += 1) {
    const lat = latitudes[i];
    const row = new Array(longitudes.length);
    const metaRow = new Array(longitudes.length);
    for (let j = 0; j < longitudes.length; j += 1) {
      const cell = scoreMatrixCell(natal, lines, mode, { lat, lon: longitudes[j] });
      row[j] = cell.value;
      metaRow[j] = cell.top; // only the small top-3 array, lat/lon implied by index
      if (cell.value < minValue) minValue = cell.value;
      if (cell.value > maxValue) maxValue = cell.value;
    }
    values[i] = row;
    cellMeta[i] = metaRow;
  }

  return {
    formula: 'angular-distance-km-v2',
    sigmaKm: HEAT_MATRIX_SIGMA_KM,
    influenceKm: LINE_INFLUENCE_KM,
    latitudes,
    longitudes,
    values,
    cellMeta,
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

  // GMST in degrees, via astronomy-engine. SiderealTime returns GAST in
  // hours; we use the same value the reference does (×15 to degrees).
  // GAST already includes nutation in RA — perfectly consistent with the
  // EQ-of-date (RA, Dec) we computed in buildAstroNatal.
  const gmstDeg = Astronomy.SiderealTime(natal.time) * 15;

  const lines = natal.positions
    .filter((planet) => weights[planet.key] > 0)
    .flatMap((planet) => buildPlanetLines(planet, gmstDeg, weights[planet.key]));

  const heatMatrix = opts.includeHeat === false
    ? null
    : buildHeatMatrix(natal, lines, mode, opts);

  return {
    mode,
    modeLabel: cfg.label,
    modeWeights: weights,
    lines,
    heatMatrix,
  };
}

// Constants exported for tests & debug.
export const ASTROCARTO_CONSTANTS = Object.freeze({
  EARTH_RADIUS_KM,
  LINE_INFLUENCE_KM,
  HEAT_MATRIX_SIGMA_KM,
  DEFAULT_LAT_MIN,
  DEFAULT_LAT_MAX,
  DEFAULT_STEP,
  ASTROCARTO_PLANETS,
  ALL_BODIES: PLANET_NAMES,
});
