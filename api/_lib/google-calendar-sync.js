import crypto from 'node:crypto';

import { HttpError } from './api-utils.js';
import { createOAuthState, sanitizeReturnTo, verifyOAuthState } from './auth-session.js';
import { verifyGoogleIdToken } from './google-oauth.js';
import { isOwnerUser, ownerEmails } from './owner-auth.js';
import { isProdLikeEnv } from './runtime-env.js';
import { loadCourseState, mutateCourseState } from './course-store.js';
import {
  calendarEvents,
  normalizeCalendarIntegration,
  normalizeCourse,
  normalizeCourseSessions,
  normalizeOwnerCalendarTime,
} from './course-validation.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const OPENID_SCOPES = 'openid email profile';
const DEFAULT_TIME_WINDOW_DAYS = 370;
const IYOGAU_PRIVATE_MARKER = 'iyogau';
const IMPORTABLE_TYPES = new Set(['owner_availability', 'owner_blocked_time', 'free_workshop', 'group_course_session']);
const PUSHABLE_TYPES = new Set(['owner_availability', 'owner_blocked_time', 'free_workshop', 'group_course_session', 'confirmed_private_class']);

export function googleCalendarConfigured() {
  return Boolean(calendarClientId() && calendarClientSecret());
}

export function googleCalendarRedirectUri(req) {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || absoluteUrl(req, '/api/owner/google-calendar/callback/');
}

export function googleCalendarStatusFromState(state, user) {
  const integration = ownerIntegration(state, user);
  return {
    configured: googleCalendarConfigured(),
    connected: Boolean(integration?.syncEnabled && integration.encryptedRefreshToken),
    provider: 'google',
    ownerEmail: integration?.ownerEmail || ownerEmails()[0] || 'ali.elentec@gmail.com',
    calendarId: integration?.calendarId || calendarId(),
    calendarName: integration?.calendarName || 'iYogaU Calendar',
    syncEnabled: Boolean(integration?.syncEnabled),
    lastSyncedAt: integration?.lastSyncedAt || '',
    lastError: integration?.lastError || '',
    scopes: integration?.scopes || [CALENDAR_SCOPE],
  };
}

export async function ownerGoogleCalendarStatus(req, session) {
  const state = await loadCourseState();
  return {
    ...googleCalendarStatusFromState(state, session.user),
    redirectUri: googleCalendarRedirectUri(req),
  };
}

export function buildGoogleCalendarConnectUrl(req, res, session, returnTo = '/owner/#calendar') {
  if (!isOwnerUser(session.user)) throw new HttpError(403, 'Owner access required.');
  if (!googleCalendarConfigured()) throw new HttpError(503, 'Google Calendar sync is not configured.');
  const nonce = createOAuthState(req, res, sanitizeReturnTo(returnTo));
  const params = new URLSearchParams({
    client_id: calendarClientId(),
    redirect_uri: googleCalendarRedirectUri(req),
    response_type: 'code',
    scope: `${OPENID_SCOPES} ${CALENDAR_SCOPE}`,
    state: nonce,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function finishGoogleCalendarCallback(req, res, query, session) {
  if (!isOwnerUser(session.user)) throw new HttpError(403, 'Owner access required.');
  if (!googleCalendarConfigured()) throw new HttpError(503, 'Google Calendar sync is not configured.');
  const state = query.get('state');
  const oauthState = verifyOAuthState(req, res, state);
  if (!oauthState) throw new HttpError(400, 'Invalid or expired Google Calendar connection state.');
  const code = query.get('code');
  if (!code) throw new HttpError(400, 'Missing Google Calendar authorization code.');

  const tokenJson = await exchangeCode(req, code);
  const claims = tokenJson.id_token
    ? await verifyGoogleIdToken(tokenJson.id_token, calendarClientId())
    : null;
  const email = String(claims?.email || session.user.email || '').toLowerCase();
  if (email && !ownerEmails().includes(email)) {
    throw new HttpError(403, 'Connect the configured owner Google account.');
  }
  if (!tokenJson.refresh_token) {
    throw new HttpError(400, 'Google did not return offline access. Reconnect and approve Calendar access.');
  }

  await mutateCourseState(async (courseState) => {
    const existing = ownerIntegration(courseState, session.user);
    const integration = normalizeCalendarIntegration({
      ownerEmail: email || session.user.email || '',
      googleSubject: claims?.sub || '',
      calendarId: calendarId(),
      calendarName: calendarName(),
      scopes: parseScopes(tokenJson.scope),
      syncEnabled: true,
      encryptedRefreshToken: encryptText(tokenJson.refresh_token),
      lastError: '',
    }, session.user.id, existing);
    if (existing) {
      const index = courseState.calendarIntegrations.findIndex((item) => item.id === existing.id);
      courseState.calendarIntegrations[index] = integration;
    } else {
      courseState.calendarIntegrations.push(integration);
    }
    return integration;
  });

  return oauthState.returnTo || '/owner/#calendar';
}

export async function syncGoogleCalendarForOwner(session) {
  if (!isOwnerUser(session.user)) throw new HttpError(403, 'Owner access required.');
  if (!googleCalendarConfigured()) throw new HttpError(503, 'Google Calendar sync is not configured.');
  const state = await loadCourseState();
  const integration = ownerIntegration(state, session.user);
  if (!integration?.syncEnabled || !integration.encryptedRefreshToken) {
    throw new HttpError(409, 'Google Calendar is not connected.');
  }

  const accessToken = await refreshAccessToken(decryptText(integration.encryptedRefreshToken));
  const localEvents = calendarEvents(state).filter((event) => PUSHABLE_TYPES.has(event.eventType));
  const pushed = [];
  for (const event of localEvents) {
    const googleEvent = await upsertGoogleEvent(integration, event, accessToken);
    pushed.push({
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      googleEventId: googleEvent.id,
      googleEtag: googleEvent.etag || '',
      googleUpdatedAt: googleEvent.updated || '',
    });
  }

  const imported = await listImportableGoogleEvents(integration, accessToken);
  const now = new Date().toISOString();
  const result = await mutateCourseState(async (nextState) => {
    pushed.forEach((item) => applyPushedSync(nextState, item, integration, now));
    imported.forEach((event) => importGoogleEvent(nextState, event, session.user, integration, now));
    const current = ownerIntegration(nextState, session.user);
    if (current) {
      const index = nextState.calendarIntegrations.findIndex((item) => item.id === current.id);
      nextState.calendarIntegrations[index] = normalizeCalendarIntegration({
        ...current,
        lastSyncedAt: now,
        lastError: '',
        syncEnabled: true,
      }, session.user.id, current);
    }
    return {
      pushed: pushed.length,
      imported: imported.length,
      lastSyncedAt: now,
    };
  });
  return result;
}

export function googleCalendarEventFromLocalEvent(event) {
  const title = event.title || event.eventType || 'iYogaU event';
  const eventType = event.eventType || 'owner_blocked_time';
  const summary = title.startsWith('[iYogaU]') ? title : `[iYogaU] ${title}`;
  return {
    summary,
    description: `Managed by iYogaU. Type: ${eventType}.`,
    location: event.locationName || '',
    start: {
      dateTime: event.startAt,
      timeZone: event.timezone || 'America/Los_Angeles',
    },
    end: {
      dateTime: event.endAt || event.startAt,
      timeZone: event.timezone || 'America/Los_Angeles',
    },
    transparency: eventType === 'owner_availability' ? 'transparent' : 'opaque',
    extendedProperties: {
      private: {
        [IYOGAU_PRIVATE_MARKER]: '1',
        iyogauType: eventType,
        sourceType: event.sourceType || '',
        sourceId: event.sourceId || event.id || '',
      },
    },
  };
}

export function isIYogaUGoogleEvent(event) {
  const props = event?.extendedProperties?.private || {};
  return props[IYOGAU_PRIVATE_MARKER] === '1' || String(event?.summary || '').startsWith('[iYogaU]');
}

export function shouldImportGoogleEvent(state, event) {
  return Boolean(isIYogaUGoogleEvent(event) && event?.id && !hasGoogleEvent(state, event.id));
}

export function googlePushResultFields(item, integration, now) {
  return {
    googleCalendarId: integration.calendarId || calendarId(),
    googleEventId: item.googleEventId,
    googleEtag: item.googleEtag || '',
    syncStatus: item.deleted ? 'disconnected' : 'synced',
    syncSource: 'website',
    lastSyncedAt: now,
    googleUpdatedAt: item.googleUpdatedAt || '',
    syncError: item.deleted ? 'Google Calendar event was deleted; reconnect or sync again to recreate it.' : '',
  };
}

function ownerIntegration(state, user) {
  return (state.calendarIntegrations || []).find((item) => (
    item.provider === 'google' &&
    (item.ownerUserId === user.id || String(item.ownerEmail || '').toLowerCase() === String(user.email || '').toLowerCase())
  )) || null;
}

function calendarClientId() {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
}

function calendarClientSecret() {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
}

function calendarId() {
  return process.env.IYOGAU_GOOGLE_CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'primary';
}

function calendarName() {
  return process.env.IYOGAU_GOOGLE_CALENDAR_NAME || 'iYogaU Calendar';
}

function absoluteUrl(req, pathname) {
  const proto = req.headers['x-forwarded-proto'] || (isProdLikeEnv() ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4177';
  return `${proto}://${host}${pathname}`;
}

async function exchangeCode(req, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: calendarClientId(),
    client_secret: calendarClientSecret(),
    redirect_uri: googleCalendarRedirectUri(req),
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) throw new HttpError(502, 'Google Calendar token exchange failed.');
  return json;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: calendarClientId(),
    client_secret: calendarClientSecret(),
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error || !json.access_token) throw new HttpError(502, 'Google Calendar access refresh failed.');
  return json.access_token;
}

async function upsertGoogleEvent(integration, event, accessToken) {
  const calendar = encodeURIComponent(integration.calendarId || calendarId());
  const googleId = event.googleEventId || event.calendarSync?.googleEventId || '';
  const url = googleId
    ? `${GOOGLE_CALENDAR_BASE}/calendars/${calendar}/events/${encodeURIComponent(googleId)}`
    : `${GOOGLE_CALENDAR_BASE}/calendars/${calendar}/events`;
  const response = await fetch(url, {
    method: googleId ? 'PATCH' : 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(googleCalendarEventFromLocalEvent(event)),
  });
  const json = await response.json().catch(() => ({}));
  if (googleId && response.status === 404) {
    return { id: googleId, deleted: true };
  }
  if (!response.ok || json.error) throw new HttpError(502, 'Google Calendar event sync failed.');
  return json;
}

async function listImportableGoogleEvents(integration, accessToken) {
  const calendar = encodeURIComponent(integration.calendarId || calendarId());
  const now = Date.now();
  const timeMin = new Date(now - DEFAULT_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + DEFAULT_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    privateExtendedProperty: `${IYOGAU_PRIVATE_MARKER}=1`,
  });
  const response = await fetch(`${GOOGLE_CALENDAR_BASE}/calendars/${calendar}/events?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) throw new HttpError(502, 'Google Calendar event import failed.');
  return Array.isArray(json.items) ? json.items.filter(isIYogaUGoogleEvent) : [];
}

function applyPushedSync(state, item, integration, now) {
  const fields = googlePushResultFields(item, integration, now);
  const update = (record) => Object.assign(record, {
    calendarSync: fields,
    googleCalendarId: fields.googleCalendarId,
    googleEventId: fields.googleEventId,
    syncStatus: fields.syncStatus,
    lastSyncedAt: fields.lastSyncedAt,
    googleUpdatedAt: fields.googleUpdatedAt,
  });
  if (item.sourceType === 'course_session') {
    const record = state.courseSessions.find((session) => session.id === item.sourceId);
    if (record) update(record);
  } else if (item.sourceType === 'private_request') {
    const id = String(item.sourceId || '').replace(/:confirmed$/, '');
    const record = state.privateRequests.find((request) => request.id === id);
    if (record) update(record);
  } else if (item.sourceType === 'owner_availability') {
    const record = (state.ownerAvailabilityTimes || []).find((block) => block.id === item.sourceId);
    if (record) update(record);
  } else if (item.sourceType === 'owner_blocked_time') {
    const record = state.ownerBlockedTimes.find((block) => block.id === item.sourceId);
    if (record) update(record);
  }
}

function importGoogleEvent(state, event, user, integration, now) {
  if (!shouldImportGoogleEvent(state, event)) return;
  const props = event.extendedProperties?.private || {};
  const eventType = props.iyogauType || typeFromGoogleSummary(event.summary);
  if (!IMPORTABLE_TYPES.has(eventType)) return;
  const googleEventId = event.id || '';
  const startAt = event.start?.dateTime || event.start?.date || '';
  const endAt = event.end?.dateTime || event.end?.date || startAt;
  if (!startAt || !endAt) return;
  const title = cleanGoogleTitle(event.summary || 'iYogaU event');
  const common = {
    eventType,
    title,
    startAt,
    endAt,
    timezone: event.start?.timeZone || event.end?.timeZone || 'America/Los_Angeles',
    notes: 'Imported from Google Calendar.',
    googleCalendarId: integration.calendarId || calendarId(),
    googleEventId,
    googleEtag: event.etag || '',
    syncStatus: 'synced',
    syncSource: 'google',
    lastSyncedAt: now,
    googleUpdatedAt: event.updated || '',
  };
  if (eventType === 'owner_availability' || eventType === 'owner_blocked_time') {
    const record = normalizeOwnerCalendarTime(common, user.id);
    if (eventType === 'owner_availability') state.ownerAvailabilityTimes.push(record);
    else state.ownerBlockedTimes.push(record);
    return;
  }
  const course = normalizeCourse({
    courseType: eventType === 'free_workshop' ? 'free_workshop' : 'regular_group_course',
    deliveryMode: event.hangoutLink ? 'online' : 'online',
    title,
    description: 'Imported from Google Calendar. Review and publish from iYogaU.',
    status: 'draft',
    onlineUrl: event.hangoutLink || '',
  }, state, user.id);
  const sessions = normalizeCourseSessions(course.id, [common]);
  state.courses.push(course);
  state.courseSessions.push(...sessions);
}

function hasGoogleEvent(state, googleEventId) {
  const matches = (item) => item.googleEventId === googleEventId || item.calendarSync?.googleEventId === googleEventId;
  return state.courseSessions.some(matches) ||
    state.privateRequests.some(matches) ||
    state.ownerBlockedTimes.some(matches) ||
    (state.ownerAvailabilityTimes || []).some(matches);
}

function typeFromGoogleSummary(summary = '') {
  const lower = String(summary).toLowerCase();
  if (lower.includes('available')) return 'owner_availability';
  if (lower.includes('unavailable') || lower.includes('blocked')) return 'owner_blocked_time';
  if (lower.includes('workshop')) return 'free_workshop';
  return 'group_course_session';
}

function cleanGoogleTitle(summary) {
  return String(summary || 'iYogaU event').replace(/^\[iYogaU\]\s*/i, '').trim() || 'iYogaU event';
}

function parseScopes(scopeText) {
  const scopes = String(scopeText || CALENDAR_SCOPE).split(/\s+/).filter(Boolean);
  return scopes.includes(CALENDAR_SCOPE) ? scopes : scopes.concat(CALENDAR_SCOPE);
}

function encryptionKey() {
  const secret = process.env.IYOGAU_GOOGLE_CALENDAR_TOKEN_SECRET ||
    process.env.IYOGAU_SESSION_SECRET ||
    process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return crypto.createHash('sha256').update(secret).digest();
  if (isProdLikeEnv()) throw new HttpError(503, 'Google Calendar token encryption is not configured.');
  return crypto.createHash('sha256').update('local-development-only-google-calendar-token-secret').digest();
}

function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptText(payload) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 3) throw new HttpError(500, 'Stored Google Calendar token is invalid.');
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
