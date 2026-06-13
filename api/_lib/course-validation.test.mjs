import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from './api-utils.js';
import {
  assertCourseCapacityCanChange,
  assertCoveredAreaCanChange,
  calendarEvents,
  normalizeActionItem,
  normalizeApplicationInput,
  normalizeCourse,
  normalizeCoveredArea,
  normalizeJournalComment,
  normalizeJournalEntry,
  normalizePrivateRequestInput,
  publicCoveredArea,
  publicCourse,
  updateApplicationStatus,
  updatePrivateRequest,
  updateStudentActionItem,
} from './course-validation.js';
import { emptyCourseState } from './course-store.js';

const owner = { id: 'owner-1', email: 'ali.elentec@gmail.com', name: 'Ali' };
const user = { id: 'user-1', email: 'student@example.com', name: 'Student' };

function stateWithArea() {
  const state = emptyCourseState();
  state.coveredAreas.push(normalizeCoveredArea({
    name: 'California Bay Area',
    country: 'United States',
    city: 'San Francisco',
    radiusKm: 80,
  }));
  return state;
}

test('offline courses require an active covered area', () => {
  const state = emptyCourseState();
  assert.throws(
    () => normalizeCourse({
      courseType: 'regular_group_course',
      deliveryMode: 'offline',
      title: 'Offline course',
      description: 'A course',
      coveredAreaId: 'missing',
    }, state, owner.id),
    (err) => err instanceof HttpError && err.status === 400,
  );

  const withArea = stateWithArea();
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'offline',
    title: 'Offline course',
    description: 'A course',
    coveredAreaId: withArea.coveredAreas[0].id,
  }, withArea, owner.id);
  assert.equal(course.coveredAreaId, withArea.coveredAreas[0].id);
});

test('private requests reject group sizes outside 1 to 3 and validate offline areas', () => {
  const state = stateWithArea();
  assert.throws(
    () => normalizePrivateRequestInput({ deliveryMode: 'online', groupSize: 4, goals: 'Practice' }, state, user),
    /groupSize/,
  );
  assert.throws(
    () => normalizePrivateRequestInput({ deliveryMode: 'offline', groupSize: 2, goals: 'Practice' }, state, user),
    /active covered area/,
  );
  const request = normalizePrivateRequestInput({
    deliveryMode: 'offline',
    coveredAreaId: state.coveredAreas[0].id,
    groupSize: 3,
    goals: 'Practice',
  }, state, user);
  assert.equal(request.userId, user.id);
  assert.equal(request.groupSize, 3);
});

test('course applications waitlist when approved capacity is already full', () => {
  const state = stateWithArea();
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'online',
    title: 'Online course',
    description: 'A course',
    capacity: 1,
    status: 'published',
  }, state, owner.id);
  state.courses.push(course);
  state.applications.push({
    id: 'app-approved',
    courseId: course.id,
    userId: 'other-user',
    status: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const application = normalizeApplicationInput({ courseId: course.id }, state, user);
  assert.equal(application.status, 'waitlisted');
  assert.equal(application.userId, user.id);
});

test('public course payload redacts owner-only meeting data', () => {
  const state = stateWithArea();
  state.coveredAreas[0].notes = 'Owner-only meeting instructions';
  state.coveredAreas[0].createdAt = '2026-01-01T00:00:00.000Z';
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'offline',
    coveredAreaId: state.coveredAreas[0].id,
    title: 'Offline course',
    description: 'A course',
    status: 'published',
  }, state, owner.id);
  const withArea = { ...course, onlineUrl: 'https://example.com/private-meeting', coveredArea: state.coveredAreas[0] };
  const exposed = publicCourse(withArea);
  assert.equal(exposed.onlineUrl, undefined);
  assert.equal(exposed.createdBy, undefined);
  assert.equal(exposed.coveredArea.notes, undefined);
  assert.equal(exposed.coveredArea.createdAt, undefined);
  assert.equal(exposed.coveredArea.name, 'California Bay Area');
  assert.deepEqual(publicCoveredArea(state.coveredAreas[0]), exposed.coveredArea);
});

test('course capacity cannot be reduced below existing approved applications', () => {
  const state = stateWithArea();
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'online',
    title: 'Online course',
    description: 'A course',
    capacity: 1,
    status: 'published',
  }, state, owner.id);
  state.courses.push(course);
  state.applications.push(
    { id: 'app-1', courseId: course.id, userId: 'u1', status: 'approved' },
    { id: 'app-2', courseId: course.id, userId: 'u2', status: 'approved' },
  );
  assert.throws(
    () => assertCourseCapacityCanChange(state, { ...course, capacity: 1 }),
    /capacity cannot be lower/,
  );
  assert.doesNotThrow(() => assertCourseCapacityCanChange(state, { ...course, capacity: 2 }));
});

test('covered areas cannot be deactivated while active offline records depend on them', () => {
  const state = stateWithArea();
  const area = state.coveredAreas[0];
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'offline',
    title: 'Offline course',
    description: 'A course',
    coveredAreaId: area.id,
    status: 'published',
  }, state, owner.id);
  state.courses.push(course);
  assert.throws(
    () => assertCoveredAreaCanChange(state, { ...area, active: false }),
    /active offline course/,
  );
  state.courses[0] = { ...course, status: 'archived' };
  state.privateRequests.push(normalizePrivateRequestInput({
    deliveryMode: 'offline',
    coveredAreaId: area.id,
    groupSize: 1,
    goals: 'Practice',
  }, state, user));
  assert.throws(
    () => assertCoveredAreaCanChange(state, { ...area, active: false }),
    /active private request/,
  );
});

test('student action item updates are isolated by user id', () => {
  const item = normalizeActionItem({
    userId: 'user-1',
    title: 'Meditate',
    description: '20 minutes',
  }, emptyCourseState(), owner.id);
  assert.equal(updateStudentActionItem({ status: 'done' }, item, 'user-1').status, 'done');
  assert.throws(
    () => updateStudentActionItem({ status: 'done' }, item, 'user-2'),
    (err) => err instanceof HttpError && err.status === 404,
  );
});

test('journal comments attach to the selected user entry and action items keep the source', () => {
  const state = emptyCourseState();
  const entry = normalizeJournalEntry({ body: 'Today I felt clearer after practice.' }, user);
  state.journalEntries.push(entry);
  const comment = normalizeJournalComment({
    entryId: entry.id,
    selectedText: 'felt clearer',
    comment: 'Keep tracking this pattern.',
  }, state, owner.id);
  assert.equal(comment.userId, user.id);
  assert.equal(comment.entryId, entry.id);

  const action = normalizeActionItem({
    userId: user.id,
    source: 'journal',
    sourceId: entry.id,
    title: 'Repeat the practice',
  }, state, owner.id);
  assert.equal(action.sourceId, entry.id);
  assert.equal(action.status, 'open');
});

test('private request confirmation requires a valid final schedule', () => {
  const request = normalizePrivateRequestInput({ deliveryMode: 'online', groupSize: 1, goals: 'Practice' }, emptyCourseState(), user);
  assert.throws(
    () => updatePrivateRequest({ status: 'confirmed' }, request),
    /require start and end/,
  );
  const confirmed = updatePrivateRequest({
    status: 'confirmed',
    confirmedStartAt: '2026-07-01T10:00:00Z',
    confirmedEndAt: '2026-07-01T11:00:00Z',
  }, request);
  assert.equal(confirmed.status, 'confirmed');
});

test('calendar view merges course sessions, private requests, confirmations, and owner blocks', () => {
  const state = stateWithArea();
  const course = normalizeCourse({
    courseType: 'free_workshop',
    deliveryMode: 'online',
    title: 'Intro workshop',
    description: 'Workshop',
    status: 'published',
  }, state, owner.id);
  state.courses.push(course);
  state.courseSessions.push({
    id: 'session-1',
    courseId: course.id,
    startAt: '2026-07-01T10:00:00.000Z',
    endAt: '2026-07-01T11:00:00.000Z',
    timezone: 'America/Los_Angeles',
  });
  const request = normalizePrivateRequestInput({ deliveryMode: 'online', groupSize: 1, goals: 'Practice' }, state, user);
  state.privateRequests.push(updatePrivateRequest({
    status: 'confirmed',
    confirmedStartAt: '2026-07-02T10:00:00Z',
    confirmedEndAt: '2026-07-02T11:00:00Z',
  }, request));
  state.ownerBlockedTimes.push({
    id: 'block-1',
    eventType: 'owner_blocked_time',
    title: 'Unavailable',
    startAt: '2026-07-03T10:00:00.000Z',
    endAt: '2026-07-03T11:00:00.000Z',
    timezone: 'America/Los_Angeles',
  });

  assert.deepEqual(
    calendarEvents(state).map((event) => event.eventType).sort(),
    ['confirmed_private_class', 'free_workshop', 'owner_blocked_time'],
  );
});

test('application status helper accepts the standard owner decisions', () => {
  const app = { id: 'app-1', status: 'pending' };
  assert.equal(updateApplicationStatus(app, 'approved').status, 'approved');
  assert.equal(updateApplicationStatus(app, 'waitlisted').status, 'waitlisted');
  assert.throws(() => updateApplicationStatus(app, 'unknown'), /status/);
});
