import crypto from 'node:crypto';

import { HttpError } from './api-utils.js';
import { sortByStartAt } from './course-store.js';

const COURSE_TYPES = new Set(['free_workshop', 'regular_group_course']);
const DELIVERY_MODES = new Set(['online', 'offline']);
const COURSE_STATUSES = new Set(['draft', 'published', 'cancelled', 'archived']);
const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected', 'waitlisted', 'cancelled']);
const PRIVATE_REQUEST_STATUSES = new Set(['pending', 'proposed', 'confirmed', 'rejected', 'cancelled']);
const ACTION_STATUSES = new Set(['open', 'done', 'reviewed']);
const EVENT_TYPES = new Set(['free_workshop', 'group_course_session', 'private_class_request', 'confirmed_private_class', 'owner_blocked_time']);

function nowIso() {
  return new Date().toISOString();
}

function id(existing) {
  return existing?.id || crypto.randomUUID();
}

function cleanString(value, maxLen, fallback = '') {
  if (value == null) return fallback;
  const out = String(value).trim();
  if (out.length > maxLen) throw new HttpError(400, `Text field exceeds ${maxLen} characters.`);
  return out;
}

function cleanOptionalUrl(value, fallback = '') {
  const out = cleanString(value, 500, fallback);
  if (!out) return '';
  try {
    const parsed = new URL(out);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    return parsed.toString();
  } catch {
    throw new HttpError(400, '`onlineUrl` must be a valid http(s) URL.');
  }
}

function numberOrNull(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new HttpError(400, 'Numeric field is invalid.');
  return num;
}

function positiveIntegerOrNull(value, fallback = null) {
  const num = numberOrNull(value, fallback);
  if (num === null) return null;
  if (!Number.isInteger(num) || num < 1 || num > 10000) {
    throw new HttpError(400, 'Capacity must be a positive whole number.');
  }
  return num;
}

function priceCents(value, fallback = 0) {
  const num = numberOrNull(value, fallback);
  if (!Number.isInteger(num) || num < 0 || num > 100000000) {
    throw new HttpError(400, '`priceCents` must be a non-negative whole number.');
  }
  return num;
}

function timezone(value, fallback = 'America/Los_Angeles') {
  const out = cleanString(value, 64, fallback);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: out });
    return out;
  } catch {
    throw new HttpError(400, '`timezone` must be a valid IANA timezone.');
  }
}

function isoDateTime(value, fieldName) {
  const out = cleanString(value, 40);
  const ms = Date.parse(out);
  if (!out || Number.isNaN(ms)) throw new HttpError(400, `\`${fieldName}\` must be a valid ISO date-time.`);
  return new Date(ms).toISOString();
}

function enumValue(value, allowed, fieldName, fallback) {
  const out = cleanString(value, 80, fallback);
  if (!allowed.has(out)) throw new HttpError(400, `\`${fieldName}\` is invalid.`);
  return out;
}

function activeCoveredArea(state, coveredAreaId) {
  return state.coveredAreas.find((area) => area.id === coveredAreaId && area.active !== false) || null;
}

export function normalizeCoveredArea(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Covered area payload must be an object.');
  const now = nowIso();
  const area = {
    id: id(existing),
    name: cleanString(input.name, 120, existing?.name || ''),
    country: cleanString(input.country, 80, existing?.country || ''),
    region: cleanString(input.region, 80, existing?.region || ''),
    city: cleanString(input.city, 80, existing?.city || ''),
    radiusKm: numberOrNull(input.radiusKm, existing?.radiusKm ?? null),
    active: input.active === undefined ? (existing?.active ?? true) : input.active !== false,
    notes: cleanString(input.notes, 1000, existing?.notes || ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!area.name) throw new HttpError(400, '`name` is required.');
  if (!area.country) throw new HttpError(400, '`country` is required.');
  if (area.radiusKm !== null && (area.radiusKm <= 0 || area.radiusKm > 500)) {
    throw new HttpError(400, '`radiusKm` must be between 0 and 500.');
  }
  return area;
}

export function normalizeCourse(input, state, ownerUserId, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Course payload must be an object.');
  const now = nowIso();
  const courseType = enumValue(input.courseType || input.type, COURSE_TYPES, 'courseType', existing?.courseType || 'regular_group_course');
  const deliveryMode = enumValue(input.deliveryMode, DELIVERY_MODES, 'deliveryMode', existing?.deliveryMode || 'online');
  const status = enumValue(input.status, COURSE_STATUSES, 'status', existing?.status || 'draft');
  const coveredAreaId = deliveryMode === 'offline'
    ? cleanString(input.coveredAreaId, 120, existing?.coveredAreaId || '')
    : '';
  if (deliveryMode === 'offline' && !activeCoveredArea(state, coveredAreaId)) {
    throw new HttpError(400, 'Offline courses must use an active covered area.');
  }
  const course = {
    id: id(existing),
    courseType,
    deliveryMode,
    title: cleanString(input.title, 140, existing?.title || ''),
    description: cleanString(input.description, 2000, existing?.description || ''),
    priceCents: courseType === 'free_workshop' ? 0 : priceCents(input.priceCents, existing?.priceCents || 0),
    currency: cleanString(input.currency, 8, existing?.currency || 'USD').toUpperCase(),
    capacity: positiveIntegerOrNull(input.capacity, existing?.capacity ?? null),
    coveredAreaId,
    locationName: cleanString(input.locationName, 180, existing?.locationName || ''),
    onlineUrl: deliveryMode === 'online' ? cleanOptionalUrl(input.onlineUrl, existing?.onlineUrl || '') : '',
    status,
    createdBy: existing?.createdBy || ownerUserId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!course.title) throw new HttpError(400, '`title` is required.');
  if (!course.description) throw new HttpError(400, '`description` is required.');
  return course;
}

export function normalizeCourseSessions(courseId, sessions, existingSessions = []) {
  if (sessions === undefined) return existingSessions;
  if (!Array.isArray(sessions)) throw new HttpError(400, '`sessions` must be an array.');
  return sessions.map((session, index) => {
    if (!session || typeof session !== 'object' || Array.isArray(session)) throw new HttpError(400, 'Session payload must be an object.');
    const existing = existingSessions.find((item) => item.id === session.id) || null;
    const startAt = isoDateTime(session.startAt || existing?.startAt, 'startAt');
    const endAt = isoDateTime(session.endAt || existing?.endAt, 'endAt');
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new HttpError(400, 'Session `endAt` must be after `startAt`.');
    return {
      id: id(existing),
      courseId,
      title: cleanString(session.title, 140, existing?.title || ''),
      startAt,
      endAt,
      timezone: timezone(session.timezone, existing?.timezone || 'America/Los_Angeles'),
      sortOrder: index,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
  });
}

export function courseWithSessions(state, course) {
  return {
    ...course,
    sessions: sortByStartAt(state.courseSessions.filter((session) => session.courseId === course.id)),
    coveredArea: course.coveredAreaId ? state.coveredAreas.find((area) => area.id === course.coveredAreaId) || null : null,
  };
}

export function publicCourse(course) {
  const out = { ...course };
  delete out.createdBy;
  return out;
}

export function normalizeApplicationInput(input, state, user) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Application payload must be an object.');
  const courseId = cleanString(input.courseId, 120);
  const course = state.courses.find((item) => item.id === courseId && item.status === 'published');
  if (!course) throw new HttpError(404, 'Course not found.');
  const duplicate = state.applications.find((item) => item.courseId === courseId && item.userId === user.id && item.status !== 'cancelled');
  if (duplicate) throw new HttpError(409, 'You already applied for this course.');
  const approvedCount = state.applications.filter((item) => item.courseId === courseId && item.status === 'approved').length;
  const status = course.capacity && approvedCount >= course.capacity ? 'waitlisted' : 'pending';
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    courseId,
    userId: user.id,
    userEmail: user.email || '',
    userName: user.name || '',
    status,
    goals: cleanString(input.goals, 2000),
    notes: cleanString(input.notes, 2000),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateApplicationStatus(application, status, ownerNote = '') {
  const nextStatus = enumValue(status, APPLICATION_STATUSES, 'status', application.status);
  return {
    ...application,
    status: nextStatus,
    ownerNote: cleanString(ownerNote, 2000, application.ownerNote || ''),
    updatedAt: nowIso(),
  };
}

export function normalizePrivateRequestInput(input, state, user, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Private request payload must be an object.');
  const now = nowIso();
  const deliveryMode = enumValue(input.deliveryMode, DELIVERY_MODES, 'deliveryMode', existing?.deliveryMode || 'online');
  const groupSize = Number(input.groupSize ?? existing?.groupSize ?? 1);
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 3) throw new HttpError(400, '`groupSize` must be between 1 and 3.');
  const coveredAreaId = deliveryMode === 'offline'
    ? cleanString(input.coveredAreaId, 120, existing?.coveredAreaId || '')
    : '';
  if (deliveryMode === 'offline' && !activeCoveredArea(state, coveredAreaId)) {
    throw new HttpError(400, 'Offline private requests must use an active covered area.');
  }
  return {
    id: id(existing),
    userId: existing?.userId || user.id,
    userEmail: existing?.userEmail || user.email || '',
    userName: existing?.userName || user.name || '',
    deliveryMode,
    groupSize,
    coveredAreaId,
    locationName: cleanString(input.locationName, 180, existing?.locationName || ''),
    goals: cleanString(input.goals, 2000, existing?.goals || ''),
    preferredDates: cleanString(input.preferredDates, 2000, existing?.preferredDates || ''),
    notes: cleanString(input.notes, 2000, existing?.notes || ''),
    status: existing?.status || 'pending',
    ownerResponse: existing?.ownerResponse || '',
    confirmedStartAt: existing?.confirmedStartAt || '',
    confirmedEndAt: existing?.confirmedEndAt || '',
    timezone: existing?.timezone || 'America/Los_Angeles',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function updatePrivateRequest(input, request) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Private request update must be an object.');
  const status = enumValue(input.status, PRIVATE_REQUEST_STATUSES, 'status', request.status);
  const confirmedStartAt = input.confirmedStartAt ? isoDateTime(input.confirmedStartAt, 'confirmedStartAt') : (request.confirmedStartAt || '');
  const confirmedEndAt = input.confirmedEndAt ? isoDateTime(input.confirmedEndAt, 'confirmedEndAt') : (request.confirmedEndAt || '');
  if (status === 'confirmed') {
    if (!confirmedStartAt || !confirmedEndAt) throw new HttpError(400, 'Confirmed private classes require start and end times.');
    if (Date.parse(confirmedEndAt) <= Date.parse(confirmedStartAt)) throw new HttpError(400, 'Confirmed private class end must be after start.');
  }
  return {
    ...request,
    status,
    ownerResponse: cleanString(input.ownerResponse, 2000, request.ownerResponse || ''),
    confirmedStartAt,
    confirmedEndAt,
    timezone: timezone(input.timezone, request.timezone || 'America/Los_Angeles'),
    updatedAt: nowIso(),
  };
}

export function normalizeOwnerBlock(input, ownerUserId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Calendar block payload must be an object.');
  const startAt = isoDateTime(input.startAt, 'startAt');
  const endAt = isoDateTime(input.endAt, 'endAt');
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new HttpError(400, 'Blocked time end must be after start.');
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    eventType: 'owner_blocked_time',
    ownerUserId,
    title: cleanString(input.title, 140, 'Unavailable'),
    startAt,
    endAt,
    timezone: timezone(input.timezone, 'America/Los_Angeles'),
    notes: cleanString(input.notes, 1000),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeJournalEntry(input, user) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Journal payload must be an object.');
  const body = cleanString(input.body, 10000);
  if (!body) throw new HttpError(400, '`body` is required.');
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    userEmail: user.email || '',
    userName: user.name || '',
    body,
    mood: cleanString(input.mood, 80),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeJournalComment(input, state, ownerUserId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Journal comment payload must be an object.');
  const entryId = cleanString(input.entryId, 120);
  const entry = state.journalEntries.find((item) => item.id === entryId);
  if (!entry) throw new HttpError(404, 'Journal entry not found.');
  const selectedText = cleanString(input.selectedText, 1000);
  const comment = cleanString(input.comment, 3000);
  if (!comment) throw new HttpError(400, '`comment` is required.');
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    entryId,
    userId: entry.userId,
    ownerUserId,
    selectedText,
    selectionStart: Number.isInteger(input.selectionStart) ? input.selectionStart : null,
    selectionEnd: Number.isInteger(input.selectionEnd) ? input.selectionEnd : null,
    comment,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeActionItem(input, state, ownerUserId, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Action item payload must be an object.');
  const now = nowIso();
  const userId = cleanString(input.userId, 160, existing?.userId || '');
  if (!userId) throw new HttpError(400, '`userId` is required.');
  const dueAt = input.dueAt ? isoDateTime(input.dueAt, 'dueAt') : (existing?.dueAt || '');
  return {
    id: id(existing),
    userId,
    ownerUserId: existing?.ownerUserId || ownerUserId,
    source: cleanString(input.source, 40, existing?.source || 'manual'),
    sourceId: cleanString(input.sourceId, 120, existing?.sourceId || ''),
    title: cleanString(input.title, 160, existing?.title || ''),
    description: cleanString(input.description, 2000, existing?.description || ''),
    dueAt,
    status: enumValue(input.status, ACTION_STATUSES, 'status', existing?.status || 'open'),
    ownerComment: cleanString(input.ownerComment, 2000, existing?.ownerComment || ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function updateStudentActionItem(input, item, userId) {
  if (item.userId !== userId) throw new HttpError(404, 'Action item not found.');
  const status = enumValue(input.status, new Set(['open', 'done']), 'status', item.status);
  return { ...item, status, updatedAt: nowIso() };
}

export function calendarEvents(state) {
  const courseEvents = state.courseSessions.map((session) => {
    const course = state.courses.find((item) => item.id === session.courseId);
    if (!course || course.status === 'archived' || course.status === 'cancelled') return null;
    return {
      id: session.id,
      eventType: course.courseType === 'free_workshop' ? 'free_workshop' : 'group_course_session',
      sourceType: 'course_session',
      sourceId: session.id,
      title: session.title || course.title,
      startAt: session.startAt,
      endAt: session.endAt,
      timezone: session.timezone,
      deliveryMode: course.deliveryMode,
      status: course.status,
      courseId: course.id,
    };
  }).filter(Boolean);

  const privateEvents = state.privateRequests.flatMap((request) => {
    const base = {
      sourceType: 'private_request',
      sourceId: request.id,
      title: `Private class: ${request.userName || request.userEmail || 'Student'}`,
      deliveryMode: request.deliveryMode,
      requestId: request.id,
      status: request.status,
    };
    if (request.status === 'confirmed' && request.confirmedStartAt && request.confirmedEndAt) {
      return [{
        ...base,
        id: `${request.id}:confirmed`,
        eventType: 'confirmed_private_class',
        startAt: request.confirmedStartAt,
        endAt: request.confirmedEndAt,
        timezone: request.timezone,
      }];
    }
    return [{
      ...base,
      id: `${request.id}:request`,
      eventType: 'private_class_request',
      startAt: request.createdAt,
      endAt: request.createdAt,
      timezone: request.timezone || 'America/Los_Angeles',
    }];
  });

  const blocks = state.ownerBlockedTimes.map((block) => ({
    ...block,
    sourceType: 'owner_blocked_time',
    sourceId: block.id,
  }));

  return sortByStartAt(courseEvents.concat(privateEvents, blocks)).filter((event) => EVENT_TYPES.has(event.eventType));
}
