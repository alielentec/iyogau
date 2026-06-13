import assert from 'node:assert/strict';
import test from 'node:test';

import handler from './start.js';

const ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'IYOGAU_ENABLE_DEV_AUTH',
  'IYOGAU_SESSION_SECRET',
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
    ended: false,
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
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
}

function createRequest(returnTo = '/natal-chart/#natal-calc') {
  return {
    method: 'GET',
    url: `/api/auth/google/start/?returnTo=${encodeURIComponent(returnTo)}`,
    headers: { host: 'localhost:4177' },
  };
}

test('Google start does not fall back to local dev sign-in when OAuth credentials are missing', async () => {
  const env = snapshotEnv();
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.IYOGAU_ENABLE_DEV_AUTH;
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-start-route-12345';

    const res = createResponse();
    await handler(createRequest(), res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { error: 'Google Sign-In is not configured.' });
    assert.equal(res.getHeader('Set-Cookie'), undefined);
  } finally {
    restoreEnv(env);
  }
});

test('Google start reports unavailable when OAuth and local dev sign-in are disabled', async () => {
  const env = snapshotEnv();
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    process.env.IYOGAU_ENABLE_DEV_AUTH = '0';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-start-route-12345';

    const res = createResponse();
    await handler(createRequest(), res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { error: 'Google Sign-In is not configured.' });
  } finally {
    restoreEnv(env);
  }
});

test('Google start redirects to Google when OAuth credentials are configured', async () => {
  const env = snapshotEnv();
  try {
    process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4177/api/auth/google/callback/';
    process.env.IYOGAU_ENABLE_DEV_AUTH = '1';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-start-route-12345';

    const res = createResponse();
    await handler(createRequest('/natal-chart/?qa=oauth#natal-calc'), res);

    assert.equal(res.statusCode, 302);
    const location = new URL(res.getHeader('Location'));
    assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(location.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
    assert.equal(location.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
    assert.equal(location.searchParams.get('scope'), 'openid email profile');
    assert.match(String(res.getHeader('Set-Cookie')), /iyogau_oauth_state=/);
  } finally {
    restoreEnv(env);
  }
});
