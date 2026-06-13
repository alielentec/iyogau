import crypto from 'node:crypto';

import { isProdLikeEnv } from './runtime-env.js';

const SESSION_COOKIE = 'iyogau_session';
const OAUTH_STATE_COOKIE = 'iyogau_oauth_state';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const STATE_MAX_AGE_SECONDS = 60 * 10;
const SESSION_PROVIDERS = new Set(['google', 'apple', 'kakao', 'naver', 'password']);

function secret() {
  const value = process.env.IYOGAU_SESSION_SECRET || process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (isProdLikeEnv()) {
    throw new Error('IYOGAU_SESSION_SECRET must be set to at least 32 characters.');
  }
  return 'local-development-only-iyogau-session-secret-change-in-production';
}

export function parseCookies(req) {
  const raw = req?.headers?.cookie || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - input.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function hmac(payload) {
  return base64url(crypto.createHmac('sha256', secret()).update(payload).digest());
}

export function signToken(payload, maxAgeSeconds) {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const encoded = base64url(JSON.stringify({ ...payload, exp }));
  return `${encoded}.${hmac(encoded)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = hmac(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromBase64url(encoded));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function secureCookie(req) {
  if (isProdLikeEnv()) return true;
  const proto = req?.headers?.['x-forwarded-proto'];
  return proto === 'https';
}

function cookieAttrs(req, maxAgeSeconds) {
  const attrs = [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secureCookie(req)) attrs.push('Secure');
  return attrs.join('; ');
}

function setCookie(res, name, value, req, maxAgeSeconds) {
  const cookie = `${name}=${encodeURIComponent(value)}; ${cookieAttrs(req, maxAgeSeconds)}`;
  const existing = res.getHeader && res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', existing.concat(cookie));
  else res.setHeader('Set-Cookie', [existing, cookie]);
}

function clearCookie(res, name, req) {
  const attrs = cookieAttrs(req, 0);
  const cookie = `${name}=; ${attrs}`;
  const existing = res.getHeader && res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', existing.concat(cookie));
  else res.setHeader('Set-Cookie', [existing, cookie]);
}

export function setSessionCookie(req, res, user) {
  const provider = user.provider || 'google';
  const token = signToken({
    sub: user.sub,
    email: user.email,
    name: user.name || '',
    picture: user.picture || '',
    provider,
  }, SESSION_MAX_AGE_SECONDS);
  setCookie(res, SESSION_COOKIE, token, req, SESSION_MAX_AGE_SECONDS);
}

export function clearSessionCookie(req, res) {
  clearCookie(res, SESSION_COOKIE, req);
}

export function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const payload = verifyToken(token);
  if (!payload || !payload.sub || !SESSION_PROVIDERS.has(payload.provider)) return null;
  return {
    user: {
      id: String(payload.sub),
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || '',
      provider: payload.provider,
    },
  };
}

export function createOAuthState(req, res, returnTo) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const token = signToken({ nonce, returnTo: safeReturnTo }, STATE_MAX_AGE_SECONDS);
  setCookie(res, OAUTH_STATE_COOKIE, token, req, STATE_MAX_AGE_SECONDS);
  return nonce;
}

export function verifyOAuthState(req, res, nonce) {
  const token = parseCookies(req)[OAUTH_STATE_COOKIE];
  clearCookie(res, OAUTH_STATE_COOKIE, req);
  const payload = verifyToken(token);
  if (!payload || payload.nonce !== nonce) return null;
  return {
    returnTo: sanitizeReturnTo(payload.returnTo),
  };
}

export function sanitizeReturnTo(value) {
  if (!value || typeof value !== 'string') return '/#natal-calc';
  if (!value.startsWith('/')) return '/#natal-calc';
  if (value.startsWith('//')) return '/#natal-calc';
  return value.slice(0, 512);
}
