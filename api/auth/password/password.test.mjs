import assert from 'node:assert/strict';
import test from 'node:test';

import { getSession } from '../../_lib/auth-session.js';
import loginHandler from './login.js';
import signupHandler from './signup.js';

const ENV_KEYS = [
  'IYOGAU_SESSION_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NODE_ENV',
  'VERCEL_ENV',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  ENV_KEYS.forEach((key) => {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  });
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {},
  };
}

function createRequest(body) {
  return {
    method: 'POST',
    body,
    headers: {
      host: 'localhost:4177',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function mockUpstash() {
  const data = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://upstash.example.test');
    const command = JSON.parse(options.body);
    if (command[0] === 'GET') {
      return jsonResponse({ result: data.get(command[1]) || null });
    }
    if (command[0] === 'SET') {
      data.set(command[1], command[2]);
      return jsonResponse({ result: 'OK' });
    }
    throw new Error(`Unexpected command: ${command[0]}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
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

function sessionFromSetCookie(cookies) {
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const sessionCookie = list.find((cookie) => String(cookie).startsWith('iyogau_session='));
  assert.ok(sessionCookie);
  return getSession({ headers: { cookie: sessionCookie.split(';')[0] } });
}

test('password signup stores a hashed account and starts a password session', async () => {
  const env = snapshotEnv();
  const restoreFetch = mockUpstash();
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-password-auth-12345';
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';

    const res = createResponse();
    await signupHandler(createRequest({
      name: 'Direct User',
      email: 'Direct.User@example.test',
      password: 'correct horse password',
    }), res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.user.email, 'direct.user@example.test');
    assert.equal(res.payload.user.provider, 'password');
    const session = sessionFromSetCookie(res.getHeader('Set-Cookie'));
    assert.equal(session.user.provider, 'password');
    assert.match(session.user.id, /^password:/);
  } finally {
    restoreFetch();
    restoreEnv(env);
  }
});

test('password login rejects wrong passwords and accepts the stored hash', async () => {
  const env = snapshotEnv();
  const restoreFetch = mockUpstash();
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-password-auth-12345';
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';

    await signupHandler(createRequest({
      email: 'person@example.test',
      password: 'correct horse password',
    }), createResponse());

    const rejected = createResponse();
    await loginHandler(createRequest({
      email: 'person@example.test',
      password: 'wrong horse password',
    }), rejected);
    assert.equal(rejected.statusCode, 401);
    assert.deepEqual(rejected.payload, { error: 'Invalid email or password.' });

    const accepted = createResponse();
    await loginHandler(createRequest({
      email: 'person@example.test',
      password: 'correct horse password',
    }), accepted);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.payload.user.provider, 'password');
    const session = sessionFromSetCookie(accepted.getHeader('Set-Cookie'));
    assert.equal(session.user.email, 'person@example.test');
  } finally {
    restoreFetch();
    restoreEnv(env);
  }
});
