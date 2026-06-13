import crypto from 'node:crypto';

import { createOAuthState, setSessionCookie, verifyOAuthState } from './auth-session.js';
import { HttpError } from './api-utils.js';

const PROVIDER_ORDER = ['google', 'apple', 'kakao', 'naver'];
const DEFAULT_JWKS_CACHE_MS = 60 * 60 * 1000;

const providers = {
  google: {
    id: 'google',
    label: 'Google',
    envPrefix: 'GOOGLE',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: new Set(['https://accounts.google.com', 'accounts.google.com']),
    scope: 'openid email profile',
    requiresSecret: true,
    idPrefix: false,
  },
  apple: {
    id: 'apple',
    label: 'Apple',
    envPrefix: 'APPLE',
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: new Set(['https://appleid.apple.com']),
    scope: 'name email',
    responseMode: 'form_post',
    requiresAppleClientSecret: true,
    idPrefix: true,
    allowMissingEmailVerified: true,
  },
  kakao: {
    id: 'kakao',
    label: 'Kakao',
    envPrefix: 'KAKAO',
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userInfoUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: 'profile_nickname profile_image account_email',
    idPrefix: true,
  },
  naver: {
    id: 'naver',
    label: 'Naver',
    envPrefix: 'NAVER',
    authUrl: 'https://nid.naver.com/oauth2.0/authorize',
    tokenUrl: 'https://nid.naver.com/oauth2.0/token',
    userInfoUrl: 'https://openapi.naver.com/v1/nid/me',
    requiresSecret: true,
    idPrefix: true,
  },
};

let jwksCache = {};

export function authProviderIds() {
  return PROVIDER_ORDER.slice();
}

export function providerDefinition(providerId) {
  const provider = providers[providerId];
  if (!provider) throw new HttpError(404, 'Unknown sign-in provider.');
  return provider;
}

export function providerOAuthConfigured(providerId) {
  const provider = providerDefinition(providerId);
  const clientId = providerClientId(provider);
  if (!clientId) return false;
  if (provider.requiresAppleClientSecret) return Boolean(appleClientSecretAvailable());
  if (provider.requiresSecret) return Boolean(providerClientSecret(provider));
  return true;
}

export function authProvidersConfig(req) {
  return PROVIDER_ORDER.map((id) => {
    const provider = providerDefinition(id);
    return {
      id,
      label: provider.label,
      configured: providerOAuthConfigured(id),
      startUrl: `/api/auth/${id}/start/`,
      redirectUri: providerRedirectUri(req, id),
    };
  });
}

export function providerRedirectUri(req, providerId) {
  const provider = providerDefinition(providerId);
  return process.env[`${provider.envPrefix}_REDIRECT_URI`] ||
    absoluteUrl(req, `/api/auth/${provider.id}/callback/`);
}

export function buildProviderAuthRedirect(req, res, providerId, returnTo) {
  const provider = providerDefinition(providerId);
  if (!providerOAuthConfigured(providerId)) {
    throw new HttpError(503, `${provider.label} Sign-In is not configured.`);
  }
  const nonce = createOAuthState(req, res, returnTo);
  const params = new URLSearchParams({
    client_id: providerClientId(provider),
    redirect_uri: providerRedirectUri(req, providerId),
    response_type: 'code',
    state: nonce,
  });
  if (provider.scope) params.set('scope', provider.scope);
  if (provider.responseMode) params.set('response_mode', provider.responseMode);
  if (provider.id === 'google') {
    params.set('prompt', 'select_account');
    params.set('access_type', 'online');
  }
  return `${provider.authUrl}?${params.toString()}`;
}

export function callbackParams(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const params = new URLSearchParams(url.searchParams);
  if (req.method === 'POST' && typeof req.body === 'string' && req.body) {
    const bodyParams = new URLSearchParams(req.body);
    bodyParams.forEach((value, key) => params.set(key, value));
  } else if (req.method === 'POST' && req.body && typeof req.body === 'object') {
    Object.entries(req.body).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
  }
  return params;
}

export async function finishProviderCallback(req, res, providerId, query) {
  const provider = providerDefinition(providerId);
  if (!providerOAuthConfigured(providerId)) {
    throw new HttpError(503, `${provider.label} Sign-In is not configured.`);
  }

  const code = query.get('code');
  const state = query.get('state');
  const oauthState = verifyOAuthState(req, res, state);
  if (!oauthState) throw new HttpError(400, `Invalid or expired ${provider.label} sign-in state.`);
  if (!code) throw new HttpError(400, `Missing ${provider.label} authorization code.`);

  const tokenJson = await exchangeAuthorizationCode(req, provider, code, state);
  const user = provider.jwksUrl
    ? await oidcUserFromToken(provider, tokenJson, query)
    : await oauthUserFromAccessToken(provider, tokenJson);

  setSessionCookie(req, res, user);
  return oauthState.returnTo;
}

export async function verifyIdTokenForProvider(providerId, idToken, clientId) {
  const provider = providerDefinition(providerId);
  return verifyJwtIdToken(provider, idToken, clientId);
}

export function clearOAuthProviderCachesForTests() {
  jwksCache = {};
}

async function exchangeAuthorizationCode(req, provider, code, state) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: providerClientId(provider),
    redirect_uri: providerRedirectUri(req, provider.id),
  });
  const secret = provider.id === 'apple' ? appleClientSecret() : providerClientSecret(provider);
  if (secret) body.set('client_secret', secret);
  if (provider.id === 'naver') body.set('state', state || '');

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || tokenJson.error) {
    throw new HttpError(502, `${provider.label} token exchange failed.`);
  }
  return tokenJson;
}

async function oidcUserFromToken(provider, tokenJson, query) {
  const claims = await verifyJwtIdToken(provider, tokenJson.id_token, providerClientId(provider));
  const appleUser = provider.id === 'apple' ? parseAppleUser(query.get('user')) : null;
  const rawSub = String(claims.sub);
  return {
    sub: provider.idPrefix ? `${provider.id}:${rawSub}` : rawSub,
    email: claims.email || '',
    name: claims.name || appleUser?.name || '',
    picture: claims.picture || '',
    provider: provider.id,
  };
}

async function oauthUserFromAccessToken(provider, tokenJson) {
  if (!tokenJson.access_token) throw new HttpError(502, `${provider.label} did not return an access token.`);
  const response = await fetch(provider.userInfoUrl, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokenJson.access_token}`,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `${provider.label} profile lookup failed.`);
  return provider.id === 'kakao'
    ? mapKakaoUser(json)
    : mapNaverUser(json);
}

async function verifyJwtIdToken(provider, idToken, clientId) {
  if (!idToken || typeof idToken !== 'string') {
    throw new HttpError(502, `${provider.label} did not return an identity token.`);
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(502, `Malformed ${provider.label} identity token.`);

  const header = decodeJwtJson(parts[0], 'header', provider);
  if (header.alg !== 'RS256') throw new HttpError(502, `Unsupported ${provider.label} identity token algorithm.`);
  if (!header.kid || typeof header.kid !== 'string') {
    throw new HttpError(502, `${provider.label} identity token is missing a signing key id.`);
  }

  const signingKey = await providerSigningKey(provider, header.kid);
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = base64urlToBuffer(parts[2]);
  const verified = crypto.verify('RSA-SHA256', signingInput, signingKey, signature);
  if (!verified) throw new HttpError(502, `${provider.label} identity token signature mismatch.`);

  const claims = decodeJwtJson(parts[1], 'payload', provider);
  validateClaims(provider, claims, clientId);
  return claims;
}

async function providerSigningKey(provider, kid) {
  const keys = await providerJwks(provider);
  const jwk = keys.find((key) => key.kid === kid && key.kty === 'RSA');
  if (!jwk) throw new HttpError(502, `${provider.label} identity token signing key not found.`);
  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new HttpError(502, `${provider.label} identity token signing key is invalid.`);
  }
}

async function providerJwks(provider) {
  const cached = jwksCache[provider.id];
  if (cached?.keys && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(provider.jwksUrl, { headers: { accept: 'application/json' } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(json.keys)) {
    throw new HttpError(502, `Could not load ${provider.label} identity token signing keys.`);
  }
  jwksCache[provider.id] = {
    keys: json.keys,
    expiresAt: Date.now() + cacheMaxAgeMs(response.headers?.get?.('cache-control')),
  };
  return jwksCache[provider.id].keys;
}

function validateClaims(provider, claims, clientId) {
  if (!claims || typeof claims !== 'object') throw new HttpError(502, `${provider.label} identity token is empty.`);
  if (!provider.issuers.has(claims.iss)) throw new HttpError(502, `${provider.label} identity token issuer mismatch.`);
  if (claims.aud !== clientId) throw new HttpError(502, `${provider.label} identity token audience mismatch.`);
  if (!claims.sub) throw new HttpError(502, `${provider.label} identity token has no subject.`);
  if (Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(502, `${provider.label} identity token is expired.`);
  }
  if (!provider.allowMissingEmailVerified &&
      claims.email_verified !== true &&
      claims.email_verified !== 'true') {
    throw new HttpError(403, `${provider.label} account email must be verified.`);
  }
}

function mapKakaoUser(json) {
  if (!json || json.id === undefined || json.id === null) throw new HttpError(502, 'Kakao profile has no subject.');
  const account = json.kakao_account || {};
  const profile = account.profile || {};
  return {
    sub: `kakao:${String(json.id)}`,
    email: account.email || '',
    name: profile.nickname || '',
    picture: profile.profile_image_url || profile.thumbnail_image_url || '',
    provider: 'kakao',
  };
}

function mapNaverUser(json) {
  const profile = json?.response || {};
  if (!profile.id) throw new HttpError(502, 'Naver profile has no subject.');
  return {
    sub: `naver:${String(profile.id)}`,
    email: profile.email || '',
    name: profile.name || profile.nickname || '',
    picture: profile.profile_image || '',
    provider: 'naver',
  };
}

function parseAppleUser(value) {
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    const first = user?.name?.firstName || '';
    const last = user?.name?.lastName || '';
    return { name: [first, last].filter(Boolean).join(' ') };
  } catch {
    return null;
  }
}

function appleClientSecretAvailable() {
  return Boolean(process.env.APPLE_CLIENT_SECRET ||
    (process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && applePrivateKey()));
}

function appleClientSecret() {
  if (process.env.APPLE_CLIENT_SECRET) return process.env.APPLE_CLIENT_SECRET;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = applePrivateKey();
  if (!teamId || !keyId || !privateKey) return '';
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'ES256', kid: keyId });
  const payload = base64urlJson({
    iss: teamId,
    iat: now,
    exp: now + 60 * 60 * 24 * 180,
    aud: 'https://appleid.apple.com',
    sub: process.env.APPLE_CLIENT_ID,
  });
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

function applePrivateKey() {
  return (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
}

function providerClientId(provider) {
  return process.env[`${provider.envPrefix}_CLIENT_ID`] || '';
}

function providerClientSecret(provider) {
  return process.env[`${provider.envPrefix}_CLIENT_SECRET`] || '';
}

function absoluteUrl(req, path) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4177';
  return `${proto}://${host}${path}`;
}

function cacheMaxAgeMs(cacheControl) {
  if (typeof cacheControl !== 'string') return DEFAULT_JWKS_CACHE_MS;
  const match = cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i);
  if (!match) return DEFAULT_JWKS_CACHE_MS;
  return Math.max(1, Number(match[1])) * 1000;
}

function base64urlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function base64urlToBuffer(input) {
  if (typeof input !== 'string') throw new HttpError(502, 'Malformed identity token.');
  const payload = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - input.length % 4) % 4);
  return Buffer.from(payload, 'base64');
}

function decodeJwtJson(part, label, provider) {
  try {
    return JSON.parse(base64urlToBuffer(part).toString('utf8'));
  } catch {
    throw new HttpError(502, `Could not parse ${provider.label} identity token ${label}.`);
  }
}
