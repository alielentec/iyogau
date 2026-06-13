import {
  handleOptions,
  HttpError,
  readJson,
  requireSameOrigin,
  sendError,
  sendJson,
  setJsonHeaders,
} from './api-utils.js';
import { loadCourseState, mutateCourseState, sortByUpdatedAt } from './course-store.js';
import {
  assertCourseCapacityCanChange,
  assertCoveredAreaCanChange,
  calendarEvents,
  courseWithSessions,
  normalizeActionItem,
  normalizeApplicationInput,
  normalizeCourse,
  normalizeCourseSessions,
  normalizeCoveredArea,
  normalizeJournalComment,
  normalizeJournalEntry,
  normalizeOwnerCalendarTime,
  normalizeOwnerBlock,
  normalizePrivateRequestInput,
  publicCoveredArea,
  publicCourse,
  updateApplicationStatus,
  updatePrivateRequest,
  updateStudentActionItem,
} from './course-validation.js';
import {
  buildGoogleCalendarConnectUrl,
  ownerGoogleCalendarStatus,
  syncGoogleCalendarForOwner,
} from './google-calendar-sync.js';
import { requireOwnerSession, requireSession, sessionUserView } from './owner-auth.js';

function withCourse(course, state) {
  return publicCourse(courseWithSessions(state, course));
}

function userCourseSummary(state, courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  return course ? withCourse(course, state) : null;
}

function ownerUsers(state) {
  const byId = new Map();
  function add(userId, email, name) {
    if (!userId) return;
    const current = byId.get(userId) || {
      id: userId,
      email: '',
      name: '',
      role: 'user',
      applications: 0,
      approvedApplications: 0,
      privateRequests: 0,
      confirmedPrivateRequests: 0,
      journals: 0,
      actionItems: 0,
      lastActivityAt: '',
    };
    if (email) current.email = email;
    if (name) current.name = name;
    byId.set(userId, current);
  }
  function touch(userId, at) {
    if (!userId || !at) return;
    const current = byId.get(userId);
    if (current && String(at) > String(current.lastActivityAt || '')) current.lastActivityAt = at;
  }
  state.applications.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    const current = byId.get(item.userId);
    current.applications += 1;
    if (item.status === 'approved') current.approvedApplications += 1;
    touch(item.userId, item.updatedAt || item.createdAt);
  });
  state.privateRequests.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    const current = byId.get(item.userId);
    current.privateRequests += 1;
    if (item.status === 'confirmed') current.confirmedPrivateRequests += 1;
    touch(item.userId, item.updatedAt || item.createdAt);
  });
  state.journalEntries.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    byId.get(item.userId).journals += 1;
    touch(item.userId, item.updatedAt || item.createdAt);
  });
  state.actionItems.forEach((item) => {
    add(item.userId);
    byId.get(item.userId).actionItems += 1;
    touch(item.userId, item.updatedAt || item.createdAt);
  });
  return Array.from(byId.values()).map((user) => ({
    ...user,
    role: user.approvedApplications || user.confirmedPrivateRequests ? 'student' : (user.applications || user.privateRequests ? 'applicant' : 'user'),
  })).sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')) || String(a.email || a.id).localeCompare(String(b.email || b.id)));
}

async function api(handler, req, res, owner = false) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);
    const session = owner ? requireOwnerSession(req) : requireSession(req);
    return await handler(req, res, session);
  } catch (err) {
    return sendError(res, err);
  }
}

export async function coursesHandler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
    const state = await loadCourseState();
    const courses = state.courses
      .filter((course) => course.status === 'published')
      .map((course) => withCourse(course, state));
    return sendJson(res, 200, {
      courses,
      coveredAreas: state.coveredAreas
        .filter((area) => area.active !== false)
        .map(publicCoveredArea),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function applicationsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const applications = sortByUpdatedAt(state.applications.filter((item) => item.userId === session.user.id))
        .map((item) => ({ ...item, course: userCourseSummary(state, item.courseId) }));
      return sendJson(response, 200, { applications });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const application = normalizeApplicationInput(body, state, session.user);
        state.applications.push(application);
        return { application: { ...application, course: userCourseSummary(state, application.courseId) } };
      });
      return sendJson(response, 201, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function privateRequestsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const requests = sortByUpdatedAt(state.privateRequests.filter((item) => item.userId === session.user.id));
      return sendJson(response, 200, {
        privateRequests: requests,
        coveredAreas: state.coveredAreas
          .filter((area) => area.active !== false)
          .map(publicCoveredArea),
      });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const privateRequest = normalizePrivateRequestInput(body, state, session.user);
        state.privateRequests.push(privateRequest);
        return { privateRequest };
      });
      return sendJson(response, 201, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function journalsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const entries = sortByUpdatedAt(state.journalEntries.filter((entry) => entry.userId === session.user.id))
        .map((entry) => ({
          ...entry,
          comments: sortByUpdatedAt(state.journalComments.filter((comment) => comment.entryId === entry.id)),
          actionItems: sortByUpdatedAt(state.actionItems.filter((item) => item.sourceId === entry.id && item.userId === session.user.id)),
        }));
      return sendJson(response, 200, { entries });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const entry = normalizeJournalEntry(body, session.user);
        state.journalEntries.push(entry);
        return { entry };
      });
      return sendJson(response, 201, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function actionItemsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const actionItems = sortByUpdatedAt(state.actionItems.filter((item) => item.userId === session.user.id));
      return sendJson(response, 200, { actionItems });
    }
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.actionItems.findIndex((item) => item.id === id && item.userId === session.user.id);
        if (index < 0) throw new HttpError(404, 'Action item not found.');
        state.actionItems[index] = updateStudentActionItem(body, state.actionItems[index], session.user.id);
        return { actionItem: state.actionItems[index] };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function ownerCoursesHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      return sendJson(response, 200, {
        user: sessionUserView(session.user),
        courses: state.courses.map((course) => courseWithSessions(state, course)),
        coveredAreas: state.coveredAreas,
      });
    }
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const payload = await mutateCourseState(async (state) => {
        const course = normalizeCourse(body, state, session.user.id);
        const sessions = normalizeCourseSessions(course.id, body.sessions || []);
        state.courses.push(course);
        state.courseSessions.push(...sessions);
        return { course: courseWithSessions(state, course) };
      });
      return sendJson(response, 201, payload);
    }
    if (request.method === 'PUT') {
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.courses.findIndex((course) => course.id === id);
        if (index < 0) throw new HttpError(404, 'Course not found.');
        const course = normalizeCourse(body.course || body, state, session.user.id, state.courses[index]);
        assertCourseCapacityCanChange(state, course);
        const existingSessions = state.courseSessions.filter((item) => item.courseId === id);
        const sessions = normalizeCourseSessions(id, (body.course || body).sessions, existingSessions);
        state.courses[index] = course;
        if ((body.course || body).sessions !== undefined) {
          state.courseSessions = state.courseSessions.filter((item) => item.courseId !== id).concat(sessions);
        }
        return { course: courseWithSessions(state, course) };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerCoveredAreasHandler(req, res) {
  return api(async (request, response) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      return sendJson(response, 200, { coveredAreas: state.coveredAreas });
    }
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const payload = await mutateCourseState(async (state) => {
        const area = normalizeCoveredArea(body);
        state.coveredAreas.push(area);
        return { coveredArea: area };
      });
      return sendJson(response, 201, payload);
    }
    if (request.method === 'PUT') {
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.coveredAreas.findIndex((area) => area.id === id);
        if (index < 0) throw new HttpError(404, 'Covered area not found.');
        const coveredArea = normalizeCoveredArea(body.coveredArea || body, state.coveredAreas[index]);
        assertCoveredAreaCanChange(state, coveredArea);
        state.coveredAreas[index] = coveredArea;
        return { coveredArea };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerApplicationsHandler(req, res) {
  return api(async (request, response) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const applications = sortByUpdatedAt(state.applications).map((item) => ({ ...item, course: userCourseSummary(state, item.courseId) }));
      return sendJson(response, 200, { applications });
    }
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.applications.findIndex((item) => item.id === id);
        if (index < 0) throw new HttpError(404, 'Application not found.');
        const candidate = updateApplicationStatus(state.applications[index], body.status, body.ownerNote);
        const course = state.courses.find((item) => item.id === candidate.courseId);
        if (candidate.status === 'approved' && course?.capacity) {
          const approvedCount = state.applications.filter((item) => item.courseId === candidate.courseId && item.status === 'approved' && item.id !== candidate.id).length;
          if (approvedCount >= course.capacity) throw new HttpError(409, 'Course capacity is full. Use waitlist instead.');
        }
        state.applications[index] = candidate;
        return { application: { ...candidate, course: userCourseSummary(state, candidate.courseId) } };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerPrivateRequestsHandler(req, res) {
  return api(async (request, response) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      return sendJson(response, 200, { privateRequests: sortByUpdatedAt(state.privateRequests), coveredAreas: state.coveredAreas });
    }
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.privateRequests.findIndex((item) => item.id === id);
        if (index < 0) throw new HttpError(404, 'Private request not found.');
        state.privateRequests[index] = updatePrivateRequest(body, state.privateRequests[index]);
        return { privateRequest: state.privateRequests[index] };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerCalendarHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      return sendJson(response, 200, {
        events: calendarEvents(state),
        google: await ownerGoogleCalendarStatus(request, session),
      });
    }
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const payload = await mutateCourseState(async (state) => {
        const eventType = String(body.eventType || 'owner_blocked_time');
        if (eventType === 'owner_availability' || eventType === 'owner_blocked_time') {
          const event = normalizeOwnerCalendarTime(body.eventType ? body : { ...body, eventType: 'owner_blocked_time' }, session.user.id);
          if (event.eventType === 'owner_availability') state.ownerAvailabilityTimes.push(event);
          else state.ownerBlockedTimes.push(event);
          return { event };
        }
        if (eventType === 'free_workshop' || eventType === 'group_course_session') {
          const course = normalizeCourse({
            courseType: eventType === 'free_workshop' ? 'free_workshop' : 'regular_group_course',
            deliveryMode: body.deliveryMode || 'online',
            title: body.title,
            description: body.description || body.notes || 'Scheduled from the owner calendar.',
            priceCents: body.priceCents || 0,
            currency: body.currency || 'USD',
            capacity: body.capacity || null,
            coveredAreaId: body.coveredAreaId || '',
            locationName: body.locationName || '',
            onlineUrl: body.onlineUrl || '',
            status: body.status || 'draft',
          }, state, session.user.id);
          const sessions = normalizeCourseSessions(course.id, [{
            title: body.title,
            startAt: body.startAt,
            endAt: body.endAt,
            timezone: body.timezone || 'America/Los_Angeles',
          }]);
          state.courses.push(course);
          state.courseSessions.push(...sessions);
          return { event: { ...sessions[0], eventType, courseId: course.id } };
        }
        if (eventType === 'confirmed_private_class') {
          const privateRequest = normalizePrivateRequestInput({
            deliveryMode: body.deliveryMode || 'online',
            groupSize: body.groupSize || 1,
            coveredAreaId: body.coveredAreaId || '',
            locationName: body.locationName || '',
            goals: body.title || 'Owner-created private class',
            preferredDates: '',
            notes: body.notes || '',
          }, state, {
            id: String(body.userId || body.userEmail || 'owner-created-private-student'),
            email: body.userEmail || '',
            name: body.userName || body.title || 'Private student',
          });
          const confirmed = updatePrivateRequest({
            status: 'confirmed',
            ownerResponse: body.ownerResponse || 'Confirmed by owner.',
            confirmedStartAt: body.startAt,
            confirmedEndAt: body.endAt,
            timezone: body.timezone || 'America/Los_Angeles',
          }, privateRequest);
          state.privateRequests.push(confirmed);
          return { event: confirmed };
        }
        throw new HttpError(400, 'Calendar event type is invalid.');
      });
      return sendJson(response, 201, payload);
    }
    if (request.method === 'PUT') {
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const collections = [state.ownerAvailabilityTimes, state.ownerBlockedTimes];
        for (const collection of collections) {
          const index = collection.findIndex((item) => item.id === id);
          if (index >= 0) {
            const event = normalizeOwnerCalendarTime(body.event || body, session.user.id, collection[index]);
            collection.splice(index, 1);
            if (event.eventType === 'owner_availability') state.ownerAvailabilityTimes.push(event);
            else state.ownerBlockedTimes.push(event);
            return { event };
          }
        }
        throw new HttpError(404, 'Calendar event not found.');
      });
      return sendJson(response, 200, payload);
    }
    if (request.method === 'DELETE') {
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const before = state.ownerAvailabilityTimes.length + state.ownerBlockedTimes.length;
        state.ownerAvailabilityTimes = state.ownerAvailabilityTimes.filter((item) => item.id !== id);
        state.ownerBlockedTimes = state.ownerBlockedTimes.filter((item) => item.id !== id);
        if (before === state.ownerAvailabilityTimes.length + state.ownerBlockedTimes.length) {
          throw new HttpError(404, 'Calendar event not found.');
        }
        return { deleted: true };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerGoogleCalendarStatusHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
    return sendJson(response, 200, await ownerGoogleCalendarStatus(request, session));
  }, req, res, true);
}

export async function ownerGoogleCalendarConnectHandler(req, res) {
  return api(async (request, response, session) => {
    requireSameOrigin(request);
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });
    const body = await readJson(request);
    return sendJson(response, 200, {
      authUrl: buildGoogleCalendarConnectUrl(request, response, session, body.returnTo || '/owner/#calendar'),
    });
  }, req, res, true);
}

export async function ownerGoogleCalendarSyncHandler(req, res) {
  return api(async (request, response, session) => {
    requireSameOrigin(request);
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });
    return sendJson(response, 200, await syncGoogleCalendarForOwner(session));
  }, req, res, true);
}

export async function ownerGoogleCalendarWebhookHandler(req, res) {
  return api(async (request, response, session) => {
    requireSameOrigin(request);
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });
    return sendJson(response, 202, {
      accepted: true,
      message: 'Webhook received. Manual sync is used in local development.',
      owner: sessionUserView(session.user),
    });
  }, req, res, true);
}

export async function ownerUsersHandler(req, res) {
  return api(async (request, response) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
    const state = await loadCourseState();
    return sendJson(response, 200, { users: ownerUsers(state) });
  }, req, res, true);
}

export async function ownerJournalCommentsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      const userId = String(new URL(request.url, 'http://local').searchParams.get('userId') || '');
      const entries = sortByUpdatedAt(userId ? state.journalEntries.filter((entry) => entry.userId === userId) : state.journalEntries)
        .map((entry) => ({
          ...entry,
          comments: sortByUpdatedAt(state.journalComments.filter((comment) => comment.entryId === entry.id)),
          actionItems: sortByUpdatedAt(state.actionItems.filter((item) => item.sourceId === entry.id)),
        }));
      return sendJson(response, 200, { entries });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const body = await readJson(request);
      const payload = await mutateCourseState(async (state) => {
        const comment = normalizeJournalComment(body, state, session.user.id);
        state.journalComments.push(comment);
        return { comment };
      });
      return sendJson(response, 201, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerActionItemsHandler(req, res) {
  return api(async (request, response, session) => {
    if (request.method === 'GET') {
      const state = await loadCourseState();
      return sendJson(response, 200, { actionItems: sortByUpdatedAt(state.actionItems) });
    }
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const payload = await mutateCourseState(async (state) => {
        const item = normalizeActionItem(body, state, session.user.id);
        state.actionItems.push(item);
        return { actionItem: item };
      });
      return sendJson(response, 201, payload);
    }
    if (request.method === 'PATCH') {
      const payload = await mutateCourseState(async (state) => {
        const id = String(body.id || '');
        const index = state.actionItems.findIndex((item) => item.id === id);
        if (index < 0) throw new HttpError(404, 'Action item not found.');
        state.actionItems[index] = normalizeActionItem(body, state, session.user.id, state.actionItems[index]);
        return { actionItem: state.actionItems[index] };
      });
      return sendJson(response, 200, payload);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}
