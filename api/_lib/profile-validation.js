import crypto from 'node:crypto';

import { HttpError } from './api-utils.js';

const PROFILE_TYPES = new Set(['self', 'friend', 'other']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const OFFSET_RE = /^([+-])(\d{1,2}):([0-5]\d)$/;
const MIN_DATE = '1800-01-01';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanString(value, maxLen, fallback = '') {
  if (value == null) return fallback;
  const out = String(value).trim();
  if (out.length > maxLen) throw new HttpError(400, `Text field exceeds ${maxLen} characters.`);
  return out;
}

function validateDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new HttpError(400, '`birthDate` must be YYYY-MM-DD.');
  }
  if (value < MIN_DATE) throw new HttpError(400, `\`birthDate\` must be on or after ${MIN_DATE}.`);
  const today = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value > today) throw new HttpError(400, '`birthDate` cannot be in the future.');
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new HttpError(400, '`birthDate` is not a valid calendar date.');
  }
  return value;
}

function validateTime(value, unknownTime) {
  if (unknownTime) return TIME_RE.test(String(value || '')) ? String(value) : '12:00';
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw new HttpError(400, '`birthTime` must be HH:MM or HH:MM:SS, or set `unknownTime: true`.');
  }
  return value;
}

function validateTz(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new HttpError(400, '`timezone` is required.');
  }
  if (OFFSET_RE.test(value)) return value;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    throw new HttpError(400, '`timezone` must be an IANA timezone or fixed UTC offset like +03:30.');
  }
}

export function normalizeProfileInput(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Profile payload must be a JSON object.');
  }
  if ('ownerUserId' in input || 'userId' in input) {
    throw new HttpError(400, 'Profile ownership is derived from the signed-in account and cannot be supplied.');
  }

  const now = new Date().toISOString();
  const unknownTime = input.unknownTime === true;
  const profileType = input.profileType || input.type || existing?.profileType || 'other';
  if (!PROFILE_TYPES.has(profileType)) {
    throw new HttpError(400, '`profileType` must be "self", "friend", or "other".');
  }

  const displayName = cleanString(input.displayName, 80, existing?.displayName || '');
  if (!displayName) throw new HttpError(400, '`displayName` is required.');

  const profile = {
    id: existing?.id || crypto.randomUUID(),
    ownerUserId: existing?.ownerUserId || null,
    profileType,
    displayName,
    birthDate: validateDate(input.birthDate || existing?.birthDate),
    birthTime: validateTime(input.birthTime || existing?.birthTime, unknownTime),
    unknownTime,
    birthplaceName: cleanString(input.birthplaceName, 120, existing?.birthplaceName || ''),
    lat: Number(input.lat ?? existing?.lat),
    lon: Number(input.lon ?? existing?.lon),
    timezone: validateTz(input.timezone || input.tz || existing?.timezone),
    notes: cleanString(input.notes, 1000, existing?.notes || ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (!profile.birthplaceName) throw new HttpError(400, '`birthplaceName` is required.');
  if (!isFiniteNumber(profile.lat) || profile.lat < -66.563 || profile.lat > 66.563) {
    throw new HttpError(400, '`lat` must be a number between -66.563 and 66.563.');
  }
  if (!isFiniteNumber(profile.lon) || profile.lon < -180 || profile.lon > 180) {
    throw new HttpError(400, '`lon` must be a number between -180 and 180.');
  }

  return profile;
}

export function toClientProfile(profile) {
  return {
    id: profile.id,
    profileType: profile.profileType,
    displayName: profile.displayName,
    birthDate: profile.birthDate,
    birthTime: profile.birthTime,
    unknownTime: profile.unknownTime,
    birthplaceName: profile.birthplaceName,
    lat: profile.lat,
    lon: profile.lon,
    timezone: profile.timezone,
    notes: profile.notes || '',
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function assertSingleSelfProfile(profiles, candidate) {
  if (candidate.profileType !== 'self') return;
  const conflict = profiles.find((p) => p.profileType === 'self' && p.id !== candidate.id);
  if (conflict) throw new HttpError(409, 'Only one My Profile record is allowed. Update the existing self profile instead.');
}
