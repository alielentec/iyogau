import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError, pickSameOrigin, readJson } from './api-utils.js';

function withEnv(env, fn) {
  const previous = {};
  Object.keys(env).forEach((key) => {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  });
  try {
    return fn();
  } finally {
    Object.keys(env).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('shared auth API CORS only allows localhost outside production-like environments', () => {
  const req = { headers: { origin: 'http://localhost:4177' } };

  withEnv({ VERCEL_ENV: undefined, NODE_ENV: undefined }, () => {
    assert.equal(pickSameOrigin(req), 'http://localhost:4177');
  });

  withEnv({ VERCEL_ENV: 'production', NODE_ENV: undefined }, () => {
    assert.equal(pickSameOrigin(req), '');
  });
});

test('readJson enforces content type and size for already-parsed bodies', async () => {
  await assert.rejects(
    () => readJson({ headers: {}, body: { ok: true } }),
    (err) => err instanceof HttpError && err.status === 415,
  );

  const large = { value: 'x'.repeat(33 * 1024) };
  await assert.rejects(
    () => readJson({ headers: { 'content-type': 'application/json' }, body: large }),
    (err) => err instanceof HttpError && err.status === 413,
  );
});
