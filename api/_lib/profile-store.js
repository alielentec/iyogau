import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpError } from './api-utils.js';
import { isProdLikeEnv } from './runtime-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOCAL_STORE_PATH = path.join(ROOT, '.data', 'profile-store.json');
const KEY_PREFIX = 'iyogau:profiles:';
const ACCOUNT_KEY_PREFIX = 'iyogau:accounts:';

function userKey(userId) {
  return KEY_PREFIX + encodeURIComponent(userId);
}

function accountKey(email) {
  return ACCOUNT_KEY_PREFIX + encodeURIComponent(email);
}

function upstashConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function upstashCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, '');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(command),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    throw new HttpError(502, 'Profile storage is temporarily unavailable.');
  }
  return json.result;
}

async function localReadAll() {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { users: {} };
  } catch (err) {
    if (err.code === 'ENOENT') return { users: {} };
    throw err;
  }
}

async function localWriteAll(data) {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(data, null, 2));
}

function assertStorageAvailable() {
  if (upstashConfigured()) return;
  if (isProdLikeEnv()) {
    throw new HttpError(503, 'Profile storage is not configured.');
  }
}

export function profileStorageAvailable() {
  return upstashConfigured() || !isProdLikeEnv();
}

export async function listProfiles(userId) {
  assertStorageAvailable();
  if (upstashConfigured()) {
    const raw = await upstashCommand(['GET', userKey(userId)]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const data = await localReadAll();
  return Array.isArray(data.users?.[userId]?.profiles) ? data.users[userId].profiles : [];
}

export async function saveProfiles(userId, profiles) {
  assertStorageAvailable();
  const safeProfiles = profiles.map((profile) => ({ ...profile, ownerUserId: userId }));
  if (upstashConfigured()) {
    await upstashCommand(['SET', userKey(userId), JSON.stringify(safeProfiles)]);
    return safeProfiles;
  }
  const data = await localReadAll();
  data.users = data.users || {};
  data.users[userId] = { profiles: safeProfiles };
  await localWriteAll(data);
  return safeProfiles;
}

export async function getPasswordAccount(email) {
  assertStorageAvailable();
  if (upstashConfigured()) {
    const raw = await upstashCommand(['GET', accountKey(email)]);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  const data = await localReadAll();
  return data.accounts?.[email] || null;
}

export async function savePasswordAccount(email, account) {
  assertStorageAvailable();
  const safeAccount = { ...account, email };
  if (upstashConfigured()) {
    await upstashCommand(['SET', accountKey(email), JSON.stringify(safeAccount)]);
    return safeAccount;
  }
  const data = await localReadAll();
  data.accounts = data.accounts || {};
  data.accounts[email] = safeAccount;
  await localWriteAll(data);
  return safeAccount;
}

export function sortProfiles(profiles) {
  return profiles.slice().sort((a, b) => {
    if (a.profileType === 'self' && b.profileType !== 'self') return -1;
    if (a.profileType !== 'self' && b.profileType === 'self') return 1;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}
