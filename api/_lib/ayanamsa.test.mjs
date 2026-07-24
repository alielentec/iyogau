import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAscMC } from './astronomy.js';
import { applyAyanamsa, lahiriAyanamsa, trueChitrapakshaAyanamsa } from './ayanamsa.js';

test('Lahiri ayanamsa matches Swiss apparent sidereal reference near Ali sheet instant', () => {
  const dateUTC = new Date(Date.UTC(1985, 5, 9, 12, 0, 0));
  // Swiss Ephemeris 2.10.03, SE_SIDM_LAHIRI, get_ayanamsa_ex_ut(jd, 0).
  const swissApparentLahiri = 23.650209831211082;
  assert.ok(Math.abs(lahiriAyanamsa(dateUTC) - swissApparentLahiri) < 0.0001);
});

test('True Chitrapaksha ayanamsa matches the JHora Ali screenshot', () => {
  const dateUTC = new Date(Date.UTC(1985, 5, 9, 12, 0, 0));
  const jhoraAyanamsa = 23 + 38 / 60 + 17.2 / 3600;
  assert.ok(Math.abs(trueChitrapakshaAyanamsa(dateUTC) - jhoraAyanamsa) < 0.00001);

  const lat = 35 + 11 / 60 + 49 / 3600;
  const lon = 48 + 41 / 60 + 52 / 3600;
  const { ascendant } = computeAscMC(dateUTC, lat, lon);
  const jhoraLagna = 180 + 6 + 39 / 60 + 16.3 / 3600;
  assert.ok(Math.abs(applyAyanamsa(ascendant, jhoraAyanamsa) - jhoraLagna) < 0.0001);
});

test('Lahiri ayanamsa remains close at J2000 and current-era dates', () => {
  const samples = [
    [new Date(Date.UTC(2000, 0, 1, 12, 0, 0)), 23.853222486029065],
    [new Date(Date.UTC(2026, 5, 9, 0, 0, 0)), 24.228304247319354],
  ];

  for (const [dateUTC, swissApparentLahiri] of samples) {
    assert.ok(Math.abs(lahiriAyanamsa(dateUTC) - swissApparentLahiri) < 0.0001);
  }
});
