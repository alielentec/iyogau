import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { HttpError } from './api-utils.js';
import { isProdLikeEnv } from './runtime-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOCAL_STORE_PATH = path.join(ROOT, '.data', 'course-store.json');
const STORE_KEY = 'iyogau:courses:v1';
const LOCK_KEY = `${STORE_KEY}:lock`;
const LOCK_TTL_MS = 8000;
const LOCK_ATTEMPTS = 8;

const COLLECTIONS = [
  'coveredAreas',
  'courses',
  'courseSessions',
  'applications',
  'privateRequests',
  'ownerBlockedTimes',
  'journalEntries',
  'journalComments',
  'actionItems',
];

let localMutationQueue = Promise.resolve();

export function emptyCourseState() {
  return COLLECTIONS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function normalizeState(value) {
  const state = emptyCourseState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  COLLECTIONS.forEach((key) => {
    state[key] = Array.isArray(value[key]) ? value[key] : [];
  });
  return state;
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
    throw new HttpError(502, 'Course storage is temporarily unavailable.');
  }
  return json.result;
}

function assertStorageAvailable() {
  if (upstashConfigured()) return;
  if (isProdLikeEnv()) throw new HttpError(503, 'Course storage is not configured.');
}

export function courseStorageAvailable() {
  return upstashConfigured() || !isProdLikeEnv();
}

export async function loadCourseState() {
  assertStorageAvailable();
  if (upstashConfigured()) {
    const raw = await upstashCommand(['GET', STORE_KEY]);
    if (!raw) return emptyCourseState();
    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      throw new HttpError(500, 'Course storage data is invalid; refusing to overwrite it.');
    }
  }
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return emptyCourseState();
    throw err;
  }
}

export async function saveCourseState(state) {
  assertStorageAvailable();
  const safeState = normalizeState(state);
  if (upstashConfigured()) {
    await upstashCommand(['SET', STORE_KEY, JSON.stringify(safeState)]);
    return safeState;
  }
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(safeState, null, 2));
  return safeState;
}

export async function mutateCourseState(mutator) {
  if (typeof mutator !== 'function') throw new TypeError('mutator must be a function');
  if (upstashConfigured()) return mutateCourseStateWithLock(mutator);

  const run = localMutationQueue.then(async () => {
    const state = await loadCourseState();
    const result = await mutator(state);
    await saveCourseState(state);
    return result;
  });
  localMutationQueue = run.catch(() => {});
  return run;
}

async function mutateCourseStateWithLock(mutator) {
  const token = await acquireCourseLock();
  try {
    const state = await loadCourseState();
    const result = await mutator(state);
    await saveCourseState(state);
    return result;
  } finally {
    await releaseCourseLock(token);
  }
}

async function acquireCourseLock() {
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const result = await upstashCommand(['SET', LOCK_KEY, token, 'NX', 'PX', LOCK_TTL_MS]);
    if (result === 'OK') return token;
    await delay(50 * (attempt + 1));
  }
  throw new HttpError(409, 'Course data is busy. Try again shortly.');
}

async function releaseCourseLock(token) {
  try {
    const current = await upstashCommand(['GET', LOCK_KEY]);
    if (current === token) await upstashCommand(['DEL', LOCK_KEY]);
  } catch {
    // Lock expiry prevents permanent deadlock if release fails.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sortByUpdatedAt(items) {
  return items.slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export function sortByStartAt(items) {
  return items.slice().sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || '')));
}
