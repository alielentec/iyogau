import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldBypassLocalRateLimit } from './ratelimit.js';

function withEnv(patch, fn) {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldVercelEnv = process.env.VERCEL_ENV;
  if ('NODE_ENV' in patch) {
    if (patch.NODE_ENV == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = patch.NODE_ENV;
  }
  if ('VERCEL_ENV' in patch) {
    if (patch.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = patch.VERCEL_ENV;
  }
  try {
    return fn();
  } finally {
    if (oldNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    if (oldVercelEnv == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  }
}

test('local development rate-limit bypass is restricted to loopback same-origin requests', () => {
  withEnv({ NODE_ENV: 'development', VERCEL_ENV: null }, () => {
    assert.equal(shouldBypassLocalRateLimit('127.0.0.1', 'http://localhost:4177', 'same-origin'), true);
    assert.equal(shouldBypassLocalRateLimit('::1', 'http://127.0.0.1:4177', 'same-origin'), true);
    assert.equal(shouldBypassLocalRateLimit('::ffff:127.0.0.1', '', 'same-origin'), true);
    assert.equal(shouldBypassLocalRateLimit('192.168.1.10', 'http://localhost:4177', 'same-origin'), false);
    assert.equal(shouldBypassLocalRateLimit('127.0.0.1', 'https://example.com', 'cross-site'), false);
  });
});

test('rate-limit bypass is disabled in production-like environments', () => {
  withEnv({ NODE_ENV: 'production', VERCEL_ENV: null }, () => {
    assert.equal(shouldBypassLocalRateLimit('127.0.0.1', 'http://localhost:4177', 'same-origin'), false);
  });
  withEnv({ NODE_ENV: 'development', VERCEL_ENV: 'preview' }, () => {
    assert.equal(shouldBypassLocalRateLimit('127.0.0.1', 'http://localhost:4177', 'same-origin'), false);
  });
  withEnv({ NODE_ENV: 'development', VERCEL_ENV: 'production' }, () => {
    assert.equal(shouldBypassLocalRateLimit('127.0.0.1', 'http://localhost:4177', 'same-origin'), false);
  });
});
