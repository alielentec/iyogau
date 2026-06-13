import assert from 'node:assert/strict';
import test from 'node:test';

import { ownerUsers } from './course-api.js';
import { emptyCourseState } from './course-store.js';
import {
  normalizeApplicationInput,
  normalizeCourse,
  normalizePrivateRequestInput,
  updateApplicationStatus,
  updatePrivateRequest,
} from './course-validation.js';

const owner = { id: 'owner-1', email: 'ali.elentec@gmail.com', name: 'Ali' };
const student = { id: 'student-1', email: 'student@example.com', name: 'Student One' };

test('owner user summaries expose course counts, active status, and last activity', () => {
  const state = emptyCourseState();
  const course = normalizeCourse({
    courseType: 'regular_group_course',
    deliveryMode: 'online',
    title: 'Regular course',
    description: 'A course',
    status: 'published',
  }, state, owner.id);
  state.courses.push(course);

  const application = updateApplicationStatus(
    normalizeApplicationInput({ courseId: course.id }, state, student),
    'approved',
  );
  application.updatedAt = '2026-07-10T12:00:00.000Z';
  state.applications.push(application);

  const request = updatePrivateRequest({
    status: 'confirmed',
    confirmedStartAt: '2026-07-11T12:00:00.000Z',
    confirmedEndAt: '2026-07-11T13:00:00.000Z',
  }, normalizePrivateRequestInput({ deliveryMode: 'online', groupSize: 1, goals: 'Private practice' }, state, student));
  request.updatedAt = '2026-07-11T13:30:00.000Z';
  state.privateRequests.push(request);

  const users = ownerUsers(state);
  assert.equal(users.length, 1);
  assert.equal(users[0].id, student.id);
  assert.equal(users[0].role, 'student');
  assert.equal(users[0].courses, 2);
  assert.equal(users[0].activeCourses, 2);
  assert.equal(users[0].applications, 1);
  assert.equal(users[0].lastActivityAt, '2026-07-11T13:30:00.000Z');
});
