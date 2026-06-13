import assert from 'node:assert/strict';
import test from 'node:test';

import {
  googleCalendarEventFromLocalEvent,
  googlePushResultFields,
  isIYogaUGoogleEvent,
  shouldImportGoogleEvent,
} from './google-calendar-sync.js';
import { emptyCourseState } from './course-store.js';

test('local owner availability maps to transparent iYogaU Google event metadata', () => {
  const payload = googleCalendarEventFromLocalEvent({
    id: 'availability-1',
    sourceType: 'owner_availability',
    sourceId: 'availability-1',
    eventType: 'owner_availability',
    title: 'Available for private classes',
    startAt: '2026-07-01T10:00:00.000Z',
    endAt: '2026-07-01T12:00:00.000Z',
    timezone: 'America/Los_Angeles',
  });

  assert.equal(payload.summary, '[iYogaU] Available for private classes');
  assert.equal(payload.transparency, 'transparent');
  assert.equal(payload.extendedProperties.private.iyogau, '1');
  assert.equal(payload.extendedProperties.private.iyogauType, 'owner_availability');
  assert.equal(payload.extendedProperties.private.sourceType, 'owner_availability');
  assert.equal(payload.extendedProperties.private.sourceId, 'availability-1');
});

test('Google event filtering accepts only iYogaU tagged or prefixed events', () => {
  assert.equal(isIYogaUGoogleEvent({
    summary: 'Personal dentist appointment',
    extendedProperties: { private: {} },
  }), false);
  assert.equal(isIYogaUGoogleEvent({
    summary: '[iYogaU] Regular course',
    extendedProperties: { private: {} },
  }), true);
  assert.equal(isIYogaUGoogleEvent({
    summary: 'Regular course',
    extendedProperties: { private: { iyogau: '1' } },
  }), true);
});

test('Google import guard prevents duplicate local records by googleEventId', () => {
  const state = emptyCourseState();
  state.ownerAvailabilityTimes.push({
    id: 'availability-1',
    googleEventId: 'google-event-1',
  });

  assert.equal(shouldImportGoogleEvent(state, {
    id: 'google-event-1',
    summary: '[iYogaU] Available',
  }), false);
  assert.equal(shouldImportGoogleEvent(state, {
    id: 'google-event-2',
    summary: '[iYogaU] Available',
  }), true);
  assert.equal(shouldImportGoogleEvent(state, {
    id: 'personal-event',
    summary: 'Personal appointment',
  }), false);
});

test('deleted Google event marks local sync disconnected without deleting local event', () => {
  const fields = googlePushResultFields({
    googleEventId: 'google-event-deleted',
    deleted: true,
  }, {
    calendarId: 'iyogau-calendar',
  }, '2026-07-01T00:00:00.000Z');

  assert.equal(fields.googleEventId, 'google-event-deleted');
  assert.equal(fields.syncStatus, 'disconnected');
  assert.equal(fields.googleCalendarId, 'iyogau-calendar');
  assert.match(fields.syncError, /deleted/);
});
