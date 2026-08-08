import assert from 'node:assert/strict';
import test from 'node:test';

import { localToUTC, validateInput } from './validate.js';
import { validateAstrocartoInput } from './validate-astrocarto.js';

const aliBase = {
  date: '1985-06-09',
  time: '15:30:30',
  tz: '+03:30',
  lat: 35.196944,
  lon: 48.697778,
  tradition: 'sidereal',
  ayanamsa: 'true_chitrapaksha',
};

test('natal and astrocartography validators accept second-level birth times', () => {
  assert.equal(validateInput(aliBase).time, '15:30:30');
  assert.equal(validateAstrocartoInput({
    ...aliBase,
    mode: 'soulmate_timing',
    resolution: 'high',
    targetDate: '2030-06-09',
  }).time, '15:30:30');
});

test('localToUTC preserves seconds when converting fixed-offset birth times', () => {
  const dateUTC = localToUTC('1985-06-09', '15:30:30', '+03:30');
  assert.equal(dateUTC.toISOString(), '1985-06-09T12:00:30.000Z');
});

test('malformed second-level birth times still fail validation', () => {
  assert.throws(
    () => validateAstrocartoInput({ ...aliBase, time: '15:30:60', mode: 'soulmate', resolution: 'high' }),
    /HH:MM or HH:MM:SS/,
  );
});
