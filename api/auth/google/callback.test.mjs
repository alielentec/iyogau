import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import handler from './callback.js';
import { createOAuthState } from '../../_lib/auth-session.js';
import { clearGoogleJwksCacheForTests } from '../../_lib/google-oauth.js';

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
    url: `/api/auth/google/callback/?returnTo=${encodeURIComponent(returnTo)}`,
    headers: { host: 'localhost:4177' },
  };
}

function createCallbackRequest(state, cookie, code = 'test-code') {
  return {
    method: 'GET',
    url: `/api/auth/google/callback/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { host: 'localhost:4177', cookie },
  };
}

function createOAuthCookie(returnTo = '/natal-chart/#natal-calc') {
  const req = { headers: { host: 'localhost:4177' } };
  const res = createResponse();
  const state = createOAuthState(req, res, returnTo);
  const cookie = res.getHeader('Set-Cookie');
  return {
    state,
    cookie: Array.isArray(cookie) ? cookie[0].split(';')[0] : cookie.split(';')[0],
  };
}

function jsonResponse(payload, ok = true, headers = {}) {
  return {
    ok,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    async json() {
      return payload;
    },
  };
}

function base64urlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function createGoogleIdTokenFixture(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = overrides.kid || `test-key-${crypto.randomUUID()}`;
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'test-google-client-id',
    sub: 'google-user-123',
    email: 'ali@example.test',
    email_verified: true,
    name: 'Ali Karimi',
    picture: '',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides.claims,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    idToken: `${signingInput}.${signature}`,
    jwk: {
      ...jwk,
      kid,
      alg: 'RS256',
      use: 'sig',
    },
  };
}

function configureOAuthEnv() {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4177/api/auth/google/callback/';
  process.env.IYOGAU_ENABLE_DEV_AUTH = '0';
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-callback-route-12345';
}

function mockGoogleFetch(idToken, jwk) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href === 'https://oauth2.googleapis.com/token') {
      return jsonResponse({ id_token: idToken });
    }
    if (href === 'https://www.googleapis.com/oauth2/v3/certs') {
      return jsonResponse({ keys: [jwk] }, true, { 'cache-control': 'public, max-age=1' });
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('Google callback does not fall back to local dev sign-in when OAuth credentials are missing', async () => {
  const env = snapshotEnv();
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.IYOGAU_ENABLE_DEV_AUTH;
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-callback-route-12345';

    const res = createResponse();
    await handler(createRequest(), res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { error: 'Google Sign-In is not configured.' });
    assert.equal(res.getHeader('Set-Cookie'), undefined);
  } finally {
    restoreEnv(env);
  }
});

test('Google callback reports unavailable when OAuth and local dev sign-in are disabled', async () => {
  const env = snapshotEnv();
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    process.env.IYOGAU_ENABLE_DEV_AUTH = '0';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-google-callback-route-12345';

    const res = createResponse();
    await handler(createRequest(), res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { error: 'Google Sign-In is not configured.' });
  } finally {
    restoreEnv(env);
  }
});

test('Google callback verifies the ID token signature before creating a session', async () => {
  const env = snapshotEnv();
  const { idToken, jwk } = createGoogleIdTokenFixture();
  const restoreFetch = mockGoogleFetch(idToken, jwk);
  clearGoogleJwksCacheForTests();
  try {
    configureOAuthEnv();
    const oauth = createOAuthCookie('/natal-chart/#natal-calc');
    const res = createResponse();

    await handler(createCallbackRequest(oauth.state, oauth.cookie), res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.getHeader('Location'), '/natal-chart/#natal-calc');
    const cookies = res.getHeader('Set-Cookie');
    assert.ok(Array.isArray(cookies));
    assert.ok(cookies.some((cookie) => cookie.startsWith('iyogau_session=')));
  } finally {
    clearGoogleJwksCacheForTests();
    restoreFetch();
    restoreEnv(env);
  }
});

test('Google callback rejects a tampered ID token signature', async () => {
  const env = snapshotEnv();
  const { idToken, jwk } = createGoogleIdTokenFixture();
  const tamperedToken = idToken.replace(/\.[^.]+$/, '.tampered');
  const restoreFetch = mockGoogleFetch(tamperedToken, jwk);
  clearGoogleJwksCacheForTests();
  try {
    configureOAuthEnv();
    const oauth = createOAuthCookie('/natal-chart/#natal-calc');
    const res = createResponse();

    await handler(createCallbackRequest(oauth.state, oauth.cookie), res);

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.payload, { error: 'Google identity token signature mismatch.' });
    const cookies = res.getHeader('Set-Cookie');
    assert.ok(!cookies || !String(cookies).includes('iyogau_session='));
  } finally {
    clearGoogleJwksCacheForTests();
    restoreFetch();
    restoreEnv(env);
  }
});
