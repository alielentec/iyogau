import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createOAuthState, getSession } from './auth-session.js';
import {
  authProvidersConfig,
  buildProviderAuthRedirect,
  clearOAuthProviderCachesForTests,
  finishProviderCallback,
} from './oauth-providers.js';

const ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_SECRET',
  'APPLE_REDIRECT_URI',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'KAKAO_CLIENT_ID',
  'KAKAO_CLIENT_SECRET',
  'KAKAO_REDIRECT_URI',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'NAVER_REDIRECT_URI',
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

function configureBaseEnv() {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  process.env.IYOGAU_SESSION_SECRET = 'test-session-secret-for-oauth-providers-12345';
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

function baseRequest(path = '/api/auth/provider/callback/') {
  return {
    method: 'GET',
    url: path,
    headers: { host: 'localhost:4177' },
  };
}

function createOAuthCookie(returnTo = '/natal-chart/#natal-calc') {
  const req = baseRequest();
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

function createIdTokenFixture(providerId, clientId, claims = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `test-${providerId}-${crypto.randomUUID()}`;
  const issuer = providerId === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com';
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    iss: issuer,
    aud: clientId,
    sub: `${providerId}-user-123`,
    email: `${providerId}@example.test`,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    idToken: `${signingInput}.${signature}`,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
  };
}

function sessionFromSetCookie(cookies) {
  const list = Array.isArray(cookies) ? cookies : [cookies];
  const sessionCookie = list.find((cookie) => String(cookie).startsWith('iyogau_session='));
  assert.ok(sessionCookie);
  return getSession({ headers: { cookie: sessionCookie.split(';')[0] } });
}

test('auth provider config exposes Google, Apple, Kakao, and Naver without secrets', () => {
  const env = snapshotEnv();
  try {
    configureBaseEnv();
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.APPLE_CLIENT_ID = 'com.iyogau.web';
    process.env.APPLE_CLIENT_SECRET = 'apple-client-secret-jwt';
    process.env.KAKAO_CLIENT_ID = 'kakao-rest-api-key';
    process.env.NAVER_CLIENT_ID = 'naver-client';
    process.env.NAVER_CLIENT_SECRET = 'naver-secret';

    const providers = authProvidersConfig(baseRequest('/api/auth/config/'));

    assert.deepEqual(providers.map((provider) => provider.id), ['google', 'apple', 'kakao', 'naver']);
    assert.equal(providers.every((provider) => provider.configured), true);
    assert.equal(providers.find((provider) => provider.id === 'apple').redirectUri, 'http://localhost:4177/api/auth/apple/callback/');
    assert.equal(providers.some((provider) => JSON.stringify(provider).includes('secret')), false);
  } finally {
    restoreEnv(env);
  }
});

test('Apple start route uses form_post and Apple authorize endpoint', () => {
  const env = snapshotEnv();
  try {
    configureBaseEnv();
    process.env.APPLE_CLIENT_ID = 'com.iyogau.web';
    process.env.APPLE_CLIENT_SECRET = 'apple-client-secret-jwt';
    const req = baseRequest('/api/auth/apple/start/?returnTo=%2Fnatal-chart%2F');
    const res = createResponse();

    const location = new URL(buildProviderAuthRedirect(req, res, 'apple', '/natal-chart/'));

    assert.equal(location.origin + location.pathname, 'https://appleid.apple.com/auth/authorize');
    assert.equal(location.searchParams.get('client_id'), process.env.APPLE_CLIENT_ID);
    assert.equal(location.searchParams.get('response_mode'), 'form_post');
    assert.equal(location.searchParams.get('scope'), 'name email');
    assert.match(String(res.getHeader('Set-Cookie')), /iyogau_oauth_state=/);
  } finally {
    restoreEnv(env);
  }
});

test('Apple callback accepts form_post and verifies the ID token before session creation', async () => {
  const env = snapshotEnv();
  const { idToken, jwk } = createIdTokenFixture('apple', 'com.iyogau.web', { email_verified: 'true' });
  const originalFetch = globalThis.fetch;
  clearOAuthProviderCachesForTests();
  try {
    configureBaseEnv();
    process.env.APPLE_CLIENT_ID = 'com.iyogau.web';
    process.env.APPLE_CLIENT_SECRET = 'apple-client-secret-jwt';
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href === 'https://appleid.apple.com/auth/token') return jsonResponse({ id_token: idToken });
      if (href === 'https://appleid.apple.com/auth/keys') return jsonResponse({ keys: [jwk] });
      throw new Error(`Unexpected fetch URL: ${href}`);
    };
    const oauth = createOAuthCookie('/natal-chart/#natal-calc');
    const req = {
      method: 'POST',
      url: '/api/auth/apple/callback/',
      body: new URLSearchParams({
        code: 'apple-code',
        state: oauth.state,
        user: JSON.stringify({ name: { firstName: 'Ali', lastName: 'Karimi' } }),
      }).toString(),
      headers: {
        host: 'localhost:4177',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: oauth.cookie,
      },
    };
    const res = createResponse();

    const returnTo = await finishProviderCallback(req, res, 'apple', new URLSearchParams(req.body));
    const session = sessionFromSetCookie(res.getHeader('Set-Cookie'));

    assert.equal(returnTo, '/natal-chart/#natal-calc');
    assert.equal(session.user.provider, 'apple');
    assert.equal(session.user.id, 'apple:apple-user-123');
    assert.equal(session.user.name, 'Ali Karimi');
  } finally {
    clearOAuthProviderCachesForTests();
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test('Kakao callback creates a provider-owned session from profile lookup', async () => {
  const env = snapshotEnv();
  const originalFetch = globalThis.fetch;
  try {
    configureBaseEnv();
    process.env.KAKAO_CLIENT_ID = 'kakao-rest-api-key';
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href === 'https://kauth.kakao.com/oauth/token') return jsonResponse({ access_token: 'kakao-token' });
      if (href === 'https://kapi.kakao.com/v2/user/me') {
        return jsonResponse({
          id: 12345,
          kakao_account: {
            email: 'kakao@example.test',
            profile: { nickname: 'Kakao User', profile_image_url: 'https://example.test/kakao.png' },
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${href}`);
    };
    const oauth = createOAuthCookie('/natal-chart/#natal-calc');
    const req = {
      method: 'GET',
      url: `/api/auth/kakao/callback/?code=kakao-code&state=${oauth.state}`,
      headers: { host: 'localhost:4177', cookie: oauth.cookie },
    };
    const res = createResponse();

    await finishProviderCallback(req, res, 'kakao', new URLSearchParams({ code: 'kakao-code', state: oauth.state }));
    const session = sessionFromSetCookie(res.getHeader('Set-Cookie'));

    assert.equal(session.user.provider, 'kakao');
    assert.equal(session.user.id, 'kakao:12345');
    assert.equal(session.user.email, 'kakao@example.test');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test('Naver callback creates a provider-owned session from profile lookup', async () => {
  const env = snapshotEnv();
  const originalFetch = globalThis.fetch;
  try {
    configureBaseEnv();
    process.env.NAVER_CLIENT_ID = 'naver-client';
    process.env.NAVER_CLIENT_SECRET = 'naver-secret';
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href === 'https://nid.naver.com/oauth2.0/token') return jsonResponse({ access_token: 'naver-token' });
      if (href === 'https://openapi.naver.com/v1/nid/me') {
        return jsonResponse({
          resultcode: '00',
          response: {
            id: 'naver-user-123',
            email: 'naver@example.test',
            nickname: 'Naver User',
            profile_image: 'https://example.test/naver.png',
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${href}`);
    };
    const oauth = createOAuthCookie('/natal-chart/#natal-calc');
    const req = {
      method: 'GET',
      url: `/api/auth/naver/callback/?code=naver-code&state=${oauth.state}`,
      headers: { host: 'localhost:4177', cookie: oauth.cookie },
    };
    const res = createResponse();

    await finishProviderCallback(req, res, 'naver', new URLSearchParams({ code: 'naver-code', state: oauth.state }));
    const session = sessionFromSetCookie(res.getHeader('Set-Cookie'));

    assert.equal(session.user.provider, 'naver');
    assert.equal(session.user.id, 'naver:naver-user-123');
    assert.equal(session.user.email, 'naver@example.test');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});
