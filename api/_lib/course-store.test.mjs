import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCourseState, mutateCourseState } from './course-store.js';

const ENV_KEYS = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NODE_ENV',
  'VERCEL_ENV',
];

const STORE_KEY = 'iyogau:courses:v1';

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  ENV_KEYS.forEach((key) => {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  });
}

function withMockUpstash(seed = {}) {
  const data = new Map(Object.entries(seed));
  const commands = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://upstash.example.test');
    const command = JSON.parse(options.body);
    commands.push(command);
    if (command[0] === 'GET') {
      return jsonResponse({ result: data.get(command[1]) || null });
    }
    if (command[0] === 'SET') {
      if (command[3] === 'NX') {
        if (data.has(command[1])) return jsonResponse({ result: null });
        data.set(command[1], command[2]);
        return jsonResponse({ result: 'OK' });
      }
      data.set(command[1], command[2]);
      return jsonResponse({ result: 'OK' });
    }
    if (command[0] === 'DEL') {
      data.delete(command[1]);
      return jsonResponse({ result: 1 });
    }
    throw new Error(`Unexpected command: ${command[0]}`);
  };
  return {
    data,
    commands,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

function configureUpstash() {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
}

test('course storage rejects malformed Upstash JSON instead of overwriting it', async () => {
  const env = snapshotEnv();
  const mock = withMockUpstash({ [STORE_KEY]: '{not-json' });
  try {
    configureUpstash();
    await assert.rejects(
      () => loadCourseState(),
      /Course storage data is invalid/,
    );
  } finally {
    mock.restore();
    restoreEnv(env);
  }
});

test('course state mutation acquires a lock before writing Upstash data', async () => {
  const env = snapshotEnv();
  const mock = withMockUpstash();
  try {
    configureUpstash();
    const result = await mutateCourseState(async (state) => {
      state.coveredAreas.push({ id: 'area-1', name: 'Bay Area', active: true });
      return 'mutated';
    });

    assert.equal(result, 'mutated');
    assert.ok(mock.commands.some((command) => command[0] === 'SET' && command[1] === `${STORE_KEY}:lock` && command[3] === 'NX'));
    assert.ok(mock.commands.some((command) => command[0] === 'SET' && command[1] === STORE_KEY));
    assert.ok(mock.commands.some((command) => command[0] === 'DEL' && command[1] === `${STORE_KEY}:lock`));
    const saved = JSON.parse(mock.data.get(STORE_KEY));
    assert.equal(saved.coveredAreas[0].id, 'area-1');
  } finally {
    mock.restore();
    restoreEnv(env);
  }
});
