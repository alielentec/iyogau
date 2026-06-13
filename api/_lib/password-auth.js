import crypto from 'node:crypto';
import { promisify } from 'node:util';

import { HttpError } from './api-utils.js';
import { getPasswordAccount, savePasswordAccount } from './profile-store.js';
import { checkRateLimit, shouldBypassLocalRateLimit } from './ratelimit.js';

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_VERSION = 'scrypt-v1';
const PASSWORD_KEY_BYTES = 64;

export function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return value;
}

export function normalizePassword(password) {
  const value = String(password || '');
  if (value.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
  if (value.length > 256) throw new HttpError(400, 'Password is too long.');
  return value;
}

export async function createPasswordAccount(input) {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  const existing = await getPasswordAccount(email);
  if (existing) throw new HttpError(409, 'An account already exists for this email.');
  const now = new Date().toISOString();
  const account = {
    id: passwordUserId(email),
    email,
    name: normalizeDisplayName(input.name, email),
    passwordHash: await hashPassword(password),
    provider: 'password',
    createdAt: now,
    updatedAt: now,
  };
  return savePasswordAccount(email, account);
}

export async function authenticatePasswordAccount(input) {
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const account = await getPasswordAccount(email);
  if (!account || !account.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  return account;
}

export function toSessionUser(account) {
  return {
    sub: account.id,
    email: account.email,
    name: account.name || account.email,
    picture: '',
    provider: 'password',
  };
}

export function enforcePasswordAuthRateLimit(req) {
  const ip = clientIp(req);
  if (shouldBypassLocalRateLimit(ip, req.headers.origin || '', req.headers['sec-fetch-site'])) return;
  const result = checkRateLimit(`auth:${ip}`);
  if (!result.allowed) {
    const err = new HttpError(429, 'Too many sign-in attempts. Try again shortly.');
    err.retryAfter = result.retryAfter;
    throw err;
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = await scryptAsync(password, salt, PASSWORD_KEY_BYTES);
  return `${PASSWORD_VERSION}:${salt}:${Buffer.from(key).toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== PASSWORD_VERSION) return false;
  const [, salt, expected] = parts;
  const key = await scryptAsync(password, salt, PASSWORD_KEY_BYTES);
  const a = Buffer.from(expected, 'base64url');
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordUserId(email) {
  return 'password:' + crypto.createHash('sha256').update(email).digest('base64url');
}

function normalizeDisplayName(name, email) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value) return value.slice(0, 80);
  return email.split('@')[0];
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
