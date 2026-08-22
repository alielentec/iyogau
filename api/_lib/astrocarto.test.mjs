import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';

import {
  ASTROCARTO_CONSTANTS,
  astroCartography,
  buildAstroNatal,
} from './astrocarto.js';
import { buildAstrocartoPayload } from '../astrocarto.js';
import { localToUTC } from './validate.js';
import { validateAstrocartoInput } from './validate-astrocarto.js';

const RAD = Math.PI / 180;

const baseInput = {
  date: '1985-06-09',
  time: '14:30',
  tz: '+03:30',
  lat: 35.1968903,
  lon: 48.6953518,
  tradition: 'sidereal',
  ayanamsa: 'true_chitrapaksha',
  mode: 'soulmate',
  resolution: 'medium',
  latStep: 4,
  lonStep: 4,
  currentResidence: null,
};

function normalizeLongitude(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function toRadians(value) {
  return value * RAD;
}

function altitudeSinAt(latitude, longitude, siderealDeg, raHours, decDeg) {
  const localSiderealDeg = normalizeLongitude(siderealDeg + longitude);
  const hourAngle = normalizeLongitude(localSiderealDeg - raHours * 15);
  return (
    Math.sin(toRadians(latitude)) * Math.sin(toRadians(decDeg)) +
    Math.cos(toRadians(latitude)) * Math.cos(toRadians(decDeg)) * Math.cos(toRadians(hourAngle))
  );
}

function unwrapLongitudeNear(value, reference) {
  let x = value;
  while (x - reference > 180) x -= 360;
  while (x - reference < -180) x += 360;
  return x;
}

function horizonLongitudeAt(latitude, siderealDeg, raHours, decDeg, type) {
  const cosH = -Math.tan(toRadians(latitude)) * Math.tan(toRadians(decDeg));
  if (Math.abs(cosH) > 1 + 1e-12) return null;
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
  return normalizeLongitude(raHours * 15 + (type === 'DC' ? hourAngle : -hourAngle) - siderealDeg);
}

function sampleNatal() {
  const dateUTC = localToUTC(baseInput.date, baseInput.time, baseInput.tz);
  return buildAstroNatal(baseInput, dateUTC);
}

test('angular lines satisfy standard meridian and horizon equations', () => {
  const natal = sampleNatal();
  const siderealDeg = Astronomy.SiderealTime(natal.time) * 15;
  const result = astroCartography(natal, 'soulmate', { includeHeat: false });
  const venus = natal.positions.find((planet) => planet.key === 'Venus');
  const mc = result.lines.find((line) => line.planet === 'Venus' && line.type === 'MC');
  const ic = result.lines.find((line) => line.planet === 'Venus' && line.type === 'IC');
  const ac = result.lines.find((line) => line.planet === 'Venus' && line.type === 'AC');
  const dc = result.lines.find((line) => line.planet === 'Venus' && line.type === 'DC');

  assert.ok(venus);
  assert.ok(mc);
  assert.ok(ic);
  assert.ok(ac);
  assert.ok(dc);

  assert.equal(mc.points[0][1], ASTROCARTO_CONSTANTS.WORLD_LAT_MIN);
  assert.equal(mc.points[1][1], ASTROCARTO_CONSTANTS.WORLD_LAT_MAX);
  assert.ok(Math.abs(normalizeLongitude(mc.points[0][0] - normalizeLongitude(venus.ra * 15 - siderealDeg))) < 1e-9);
  assert.ok(Math.abs(normalizeLongitude(ic.points[0][0] - normalizeLongitude(venus.ra * 15 - siderealDeg + 180))) < 1e-9);

  for (const line of [ac, dc]) {
    const samples = [
      line.points[0],
      line.points[Math.floor(line.points.length / 2)],
      line.points[line.points.length - 1],
    ];
    for (const [lon, lat] of samples) {
      assert.ok(
        Math.abs(altitudeSinAt(lat, lon, siderealDeg, venus.ra, venus.dec)) < 1e-9,
        `${line.type} sample at ${lat},${lon} must be on true horizon`,
      );
    }
  }
});

test('every emitted angular line point satisfies its planet equation', () => {
  const natal = sampleNatal();
  const siderealDeg = Astronomy.SiderealTime(natal.time) * 15;
  const result = astroCartography(natal, 'relocation', { includeHeat: false });
  let checkedHorizonPoints = 0;

  for (const line of result.lines) {
    const planet = natal.positions.find((item) => item.key === line.planet);
    assert.ok(planet, `missing natal planet ${line.planet}`);
    if (line.type === 'MC' || line.type === 'IC') {
      const expected = normalizeLongitude(planet.ra * 15 - siderealDeg + (line.type === 'IC' ? 180 : 0));
      assert.equal(line.points.length, 2);
      assert.equal(line.points[0][1], ASTROCARTO_CONSTANTS.WORLD_LAT_MIN);
      assert.equal(line.points[1][1], ASTROCARTO_CONSTANTS.WORLD_LAT_MAX);
      for (const [lon] of line.points) {
        assert.ok(
          Math.abs(normalizeLongitude(lon - expected)) < 1e-9,
          `${line.planet}-${line.type} longitude ${lon} must equal ${expected}`,
        );
      }
    } else {
      for (const [lon, lat] of line.points) {
        assert.ok(
          Math.abs(altitudeSinAt(lat, lon, siderealDeg, planet.ra, planet.dec)) < 1e-9,
          `${line.planet}-${line.type} point at ${lat},${lon} must be on true horizon`,
        );
        checkedHorizonPoints += 1;
      }
    }
  }

  assert.ok(checkedHorizonPoints > 1000, 'expected to check all AC/DC horizon points');
});

test('HTTP payload line points retain sub-arcsecond horizon accuracy', () => {
  const dateUTC = localToUTC(baseInput.date, baseInput.time, baseInput.tz);
  const natal = buildAstroNatal(baseInput, dateUTC);
  const siderealDeg = Astronomy.SiderealTime(natal.time) * 15;
  const payload = buildAstrocartoPayload(baseInput, dateUTC);
  let decimalRichPoints = 0;
  let checked = 0;

  for (const line of payload.lines.filter((item) => item.type === 'AC' || item.type === 'DC')) {
    const planet = natal.positions.find((item) => item.key === line.planet);
    assert.ok(planet, `missing natal planet ${line.planet}`);
    for (const [lon, lat] of line.points) {
      if ((String(lon).split('.')[1] || '').length > 2 || (String(lat).split('.')[1] || '').length > 2) {
        decimalRichPoints += 1;
      }
      const error = Math.abs(altitudeSinAt(lat, lon, siderealDeg, planet.ra, planet.dec));
      assert.ok(
        error < 1e-7,
        `${line.planet}-${line.type} payload point ${lat},${lon} is too far from the horizon equation: ${error}`,
      );
      checked += 1;
    }
  }

  assert.ok(checked > 1000, 'expected to check all payload AC/DC points');
  assert.ok(decimalRichPoints > checked / 2, 'payload line points must not be rounded to two decimals');
  assert.equal(payload.provenance.astrocartoVersion, '1.3.0');
});

test('immigration payload discloses when current residence adjustment is omitted', () => {
  const input = {
    ...baseInput,
    mode: 'immigration',
    currentResidence: null,
  };
  const dateUTC = localToUTC(input.date, input.time, input.tz);
  const payload = buildAstrocartoPayload(input, dateUTC);

  assert.equal(payload.provenance.immigrationDistanceBasis, 'omitted');
  assert.ok(
    payload.provenance.warnings.includes('immigration currentResidence not supplied; residence-distance adjustment omitted'),
    'expected explicit currentResidence omission warning',
  );
});

test('validator scopes targetDate and targetLocation to soulmate timing life window', () => {
  const targetDate = '2026-06-09';
  const requestInput = {
    date: baseInput.date,
    time: baseInput.time,
    tz: baseInput.tz,
    lat: baseInput.lat,
    lon: baseInput.lon,
    tradition: baseInput.tradition,
    ayanamsa: baseInput.ayanamsa,
    resolution: 'low',
  };
  const timed = validateAstrocartoInput({
    ...requestInput,
    mode: 'soulmate_timing',
    targetDate,
    targetLocation: { city: 'Seoul', country: 'South Korea', lat: 37.566, lon: 126.9784 },
    includeHeat: false,
  });
  assert.equal(timed.mode, 'soulmate_timing');
  assert.equal(timed.targetDate, targetDate);
  assert.deepEqual(timed.targetLocation, { city: 'Seoul', country: 'South Korea', lat: 37.566, lon: 126.9784 });
  assert.equal(timed.includeHeat, false);

  assert.throws(
    () => validateAstrocartoInput({ ...requestInput, mode: 'soulmate', targetDate }),
    /targetDate.*soulmate_timing/,
  );
  assert.throws(
    () => validateAstrocartoInput({ ...requestInput, mode: 'soulmate', targetLocation: { lat: 1, lon: 2 } }),
    /targetLocation.*soulmate_timing/,
  );
  assert.throws(
    () => validateAstrocartoInput({ ...requestInput, mode: 'soulmate_timing', targetDate: '2036-06-10' }),
    /targetDate.*1985-06-09.*2035-06-09/,
  );
});

test('soulmate timing payload changes the heat field by target date and exposes transit lines', () => {
  const first = {
    ...baseInput,
    mode: 'soulmate_timing',
    resolution: 'low',
    latStep: 6,
    lonStep: 6,
    targetDate: '2026-06-09',
  };
  const second = {
    ...first,
    targetDate: '2026-12-09',
  };
  const dateUTC = localToUTC(baseInput.date, baseInput.time, baseInput.tz);
  const a = buildAstrocartoPayload(first, dateUTC);
  const b = buildAstrocartoPayload(second, dateUTC);

  assert.equal(a.mode, 'soulmate_timing');
  assert.equal(a.timing.targetDate, '2026-06-09');
  assert.ok(a.timing.lines.length >= 30, 'timing payload should expose transit angular lines');
  assert.equal(a.heatMatrix.cells.length, 1800);
  assert.equal(b.heatMatrix.cells.length, 1800);

  let changed = 0;
  for (let r = 0; r < a.heatMatrix.values.length; r += 1) {
    for (let c = 0; c < a.heatMatrix.values[r].length; c += 1) {
      if (a.heatMatrix.values[r][c] !== b.heatMatrix.values[r][c]) changed += 1;
    }
  }
  assert.ok(changed > 500, `expected timing date to alter many cells, changed ${changed}`);
});

test('soulmate timing city scan returns activation windows without heat matrix', () => {
  const input = validateAstrocartoInput({
    date: baseInput.date,
    time: baseInput.time,
    tz: baseInput.tz,
    lat: baseInput.lat,
    lon: baseInput.lon,
    tradition: baseInput.tradition,
    ayanamsa: baseInput.ayanamsa,
    mode: 'soulmate_timing',
    resolution: 'low',
    includeHeat: false,
    targetDate: '2026-06-09',
    targetLocation: { city: 'Seoul', country: 'South Korea', lat: 37.566, lon: 126.9784 },
  });
  const dateUTC = localToUTC(input.date, input.time, input.tz);
  const payload = buildAstrocartoPayload(input, dateUTC);

  assert.equal(payload.heatMatrix, null);
  assert.equal(payload.cityTiming.location.city, 'Seoul');
  assert.equal(payload.cityTiming.startDate, '1985-06-09');
  assert.equal(payload.cityTiming.endDate, '2035-06-09');
  assert.ok(payload.cityTiming.scan.totalUniqueSamples > 900);
  assert.ok(payload.cityTiming.windows.length > 0);
  assert.ok(payload.cityTiming.windows[0].peakScore >= payload.cityTiming.windows.at(-1).peakScore);
  assert.ok(payload.cityTiming.windows[0].peakAgeYears >= 0);
  assert.ok(payload.cityTiming.windows[0].peakAgeYears <= 50);
});

test('AC/DC rendered segments stay aligned to the exact horizon equation', () => {
  const natal = sampleNatal();
  const siderealDeg = Astronomy.SiderealTime(natal.time) * 15;
  const result = astroCartography(natal, 'relocation', { includeHeat: false });
  let checked = 0;

  for (const line of result.lines.filter((item) => item.type === 'AC' || item.type === 'DC')) {
    const planet = natal.positions.find((item) => item.key === line.planet);
    assert.ok(planet, `missing natal planet ${line.planet}`);
    for (let i = 0; i < line.points.length - 1; i += 1) {
      const a = line.points[i];
      const b = line.points[i + 1];
      const midLat = (a[1] + b[1]) / 2;
      const expected = horizonLongitudeAt(midLat, siderealDeg, planet.ra, planet.dec, line.type);
      if (expected == null) continue;
      const bLon = unwrapLongitudeNear(b[0], a[0]);
      const expectedLon = unwrapLongitudeNear(expected, a[0]);
      const renderedMidLon = a[0] + (bLon - a[0]) / 2;
      const error = Math.abs(expectedLon - renderedMidLon);
      assert.ok(
        error <= ASTROCARTO_CONSTANTS.HORIZON_MAX_INTERPOLATION_DEG + 1e-9,
        `${line.planet}-${line.type} segment ${i} deviates ${error}° at lat ${midLat}`,
      );
      checked += 1;
    }
  }

  assert.ok(checked > 100, 'expected to check many horizon-line segments');
});

test('heat matrix is a full-world center-sampled xy vector grid', () => {
  const natal = sampleNatal();
  const result = astroCartography(natal, 'relocation', {
    includeHeat: true,
    latStep: 4,
    lonStep: 4,
  });
  const matrix = result.heatMatrix;

  assert.equal(matrix.formula, 'angular-distance-km-v3-world-center-grid');
  assert.equal(matrix.coordinateRole, 'cell-center');
  assert.deepEqual(matrix.latRange, [-90, 90]);
  assert.deepEqual(matrix.lonRange, [-180, 180]);
  assert.equal(matrix.latitudes.length, 45);
  assert.equal(matrix.longitudes.length, 90);
  assert.equal(matrix.latitudes[0], -88);
  assert.equal(matrix.latitudes.at(-1), 88);
  assert.equal(matrix.longitudes[0], -178);
  assert.equal(matrix.longitudes.at(-1), 178);
  assert.equal(matrix.values.length, matrix.latitudes.length);
  assert.ok(matrix.values.every((row) => row.length === matrix.longitudes.length));
  assert.equal(matrix.cells.length, matrix.latitudes.length * matrix.longitudes.length);

  const first = matrix.cells[0];
  const last = matrix.cells.at(-1);
  assert.deepEqual(
    { x: first.x, y: first.y, lat: first.lat, lon: first.lon },
    { x: 4.444444, y: 395.555556, lat: -88, lon: -178 },
  );
  assert.deepEqual(
    { x: last.x, y: last.y, lat: last.lat, lon: last.lon },
    { x: 795.555556, y: 4.444444, lat: 88, lon: 178 },
  );
});

test('the three requested heat maps produce distinct fields', () => {
  const natal = sampleNatal();
  const matrices = ['soulmate', 'relocation', 'immigration'].map((mode) => {
    natal.currentResidence = { lat: 35.6892, lon: 51.389, city: 'Tehran', country: 'Iran' };
    return astroCartography(natal, mode, {
      includeHeat: true,
      latStep: 6,
      lonStep: 6,
    }).heatMatrix;
  });
  const signatures = matrices.map((matrix) =>
    matrix.cells
      .filter((cell) => Math.abs(cell.lat) <= 66)
      .toSorted((a, b) => b.value - a.value)
      .slice(0, 12)
      .map((cell) => `${cell.lat},${cell.lon},${cell.value}`)
      .join('|'),
  );

  assert.notEqual(signatures[0], signatures[1]);
  assert.notEqual(signatures[1], signatures[2]);
  assert.notEqual(signatures[0], signatures[2]);
});
