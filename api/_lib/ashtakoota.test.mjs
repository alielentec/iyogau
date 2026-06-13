import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChart } from '../calculate-chart.js';
import { computeAshtakoota } from './ashtakoota.js';
import { localToUTC } from './validate.js';

const aliInput = {
  date: '1985-06-09',
  time: '15:30:30',
  tz: '+03:30',
  lat: 35.19694444444445,
  lon: 48.69777777777777,
  tradition: 'sidereal',
  ayanamsa: 'true_chitrapaksha',
  unknownTime: false,
};

const steveJobsInput = {
  date: '1955-02-24',
  time: '19:15',
  tz: 'America/Los_Angeles',
  lat: 37.7749,
  lon: -122.4194,
  tradition: 'sidereal',
  ayanamsa: 'true_chitrapaksha',
  unknownTime: false,
};

function chart(input) {
  return buildChart(input, localToUTC(input.date, input.time, input.tz));
}

test('ashtakoota returns the eight standard factors summing to 36 max', () => {
  const score = computeAshtakoota(chart(aliInput), chart(steveJobsInput));
  assert.equal(score.system, 'ashtakoota');
  assert.equal(score.maxScore, 36);
  assert.deepEqual(score.factors.map((factor) => factor.name), [
    'Varna',
    'Vashya',
    'Tara',
    'Yoni',
    'Graha Maitri',
    'Gana',
    'Bhakoot',
    'Nadi',
  ]);
  assert.equal(score.factors.reduce((sum, factor) => sum + factor.maxScore, 0), 36);
  assert.equal(score.totalScore, score.factors.reduce((sum, factor) => sum + factor.score, 0));
  assert.ok(score.totalScore >= 0 && score.totalScore <= 36);
});

test('ashtakoota scoring is stable at factor level for a fixed chart pair', () => {
  const first = computeAshtakoota(chart(aliInput), chart(steveJobsInput));
  const second = computeAshtakoota(chart(aliInput), chart(steveJobsInput));
  assert.deepEqual(
    first.factors.map(({ name, score, maxScore, detail }) => ({ name, score, maxScore, detail })),
    second.factors.map(({ name, score, maxScore, detail }) => ({ name, score, maxScore, detail })),
  );
  assert.deepEqual(first.moons, second.moons);
  assert.equal(first.totalScore, second.totalScore);
});
