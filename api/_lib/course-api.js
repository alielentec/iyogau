import {
  handleOptions,
  HttpError,
  readJson,
  requireSameOrigin,
  sendError,
  sendJson,
  setJsonHeaders,
} from './api-utils.js';
import { loadCourseState, saveCourseState, sortByUpdatedAt } from './course-store.js';
import {
  calendarEvents,
  courseWithSessions,
  normalizeActionItem,
  normalizeApplicationInput,
  normalizeCourse,
  normalizeCourseSessions,
  normalizeCoveredArea,
  normalizeJournalComment,
  normalizeJournalEntry,
  normalizeOwnerBlock,
  normalizePrivateRequestInput,
  publicCourse,
  updateApplicationStatus,
  updatePrivateRequest,
  updateStudentActionItem,
} from './course-validation.js';
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
    const current = byId.get(userId) || { id: userId, email: '', name: '', applications: 0, privateRequests: 0, journals: 0, actionItems: 0 };
    if (email) current.email = email;
    if (name) current.name = name;
    byId.set(userId, current);
  }
  state.applications.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    byId.get(item.userId).applications += 1;
  });
  state.privateRequests.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    byId.get(item.userId).privateRequests += 1;
  });
  state.journalEntries.forEach((item) => {
    add(item.userId, item.userEmail, item.userName);
    byId.get(item.userId).journals += 1;
  });
  state.actionItems.forEach((item) => {
    add(item.userId);
    byId.get(item.userId).actionItems += 1;
  });
  return Array.from(byId.values()).sort((a, b) => String(a.email || a.id).localeCompare(String(b.email || b.id)));
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
      coveredAreas: state.coveredAreas.filter((area) => area.active !== false),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

export async function applicationsHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
      const applications = sortByUpdatedAt(state.applications.filter((item) => item.userId === session.user.id))
        .map((item) => ({ ...item, course: userCourseSummary(state, item.courseId) }));
      return sendJson(response, 200, { applications });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const application = normalizeApplicationInput(await readJson(request), state, session.user);
      state.applications.push(application);
      await saveCourseState(state);
      return sendJson(response, 201, { application: { ...application, course: userCourseSummary(state, application.courseId) } });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function privateRequestsHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
      const requests = sortByUpdatedAt(state.privateRequests.filter((item) => item.userId === session.user.id));
      return sendJson(response, 200, { privateRequests: requests, coveredAreas: state.coveredAreas.filter((area) => area.active !== false) });
    }
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const privateRequest = normalizePrivateRequestInput(await readJson(request), state, session.user);
      state.privateRequests.push(privateRequest);
      await saveCourseState(state);
      return sendJson(response, 201, { privateRequest });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function journalsHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
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
      const entry = normalizeJournalEntry(await readJson(request), session.user);
      state.journalEntries.push(entry);
      await saveCourseState(state);
      return sendJson(response, 201, { entry });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function actionItemsHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
      const actionItems = sortByUpdatedAt(state.actionItems.filter((item) => item.userId === session.user.id));
      return sendJson(response, 200, { actionItems });
    }
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const id = String(body.id || '');
      const index = state.actionItems.findIndex((item) => item.id === id && item.userId === session.user.id);
      if (index < 0) throw new HttpError(404, 'Action item not found.');
      state.actionItems[index] = updateStudentActionItem(body, state.actionItems[index], session.user.id);
      await saveCourseState(state);
      return sendJson(response, 200, { actionItem: state.actionItems[index] });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, false);
}

export async function ownerCoursesHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
      return sendJson(response, 200, {
        user: sessionUserView(session.user),
        courses: state.courses.map((course) => courseWithSessions(state, course)),
        coveredAreas: state.coveredAreas,
      });
    }
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const course = normalizeCourse(body, state, session.user.id);
      const sessions = normalizeCourseSessions(course.id, body.sessions || []);
      state.courses.push(course);
      state.courseSessions.push(...sessions);
      await saveCourseState(state);
      return sendJson(response, 201, { course: courseWithSessions(state, course) });
    }
    if (request.method === 'PUT') {
      const id = String(body.id || '');
      const index = state.courses.findIndex((course) => course.id === id);
      if (index < 0) throw new HttpError(404, 'Course not found.');
      const course = normalizeCourse(body.course || body, state, session.user.id, state.courses[index]);
      const existingSessions = state.courseSessions.filter((item) => item.courseId === id);
      const sessions = normalizeCourseSessions(id, (body.course || body).sessions, existingSessions);
      state.courses[index] = course;
      if ((body.course || body).sessions !== undefined) {
        state.courseSessions = state.courseSessions.filter((item) => item.courseId !== id).concat(sessions);
      }
      await saveCourseState(state);
      return sendJson(response, 200, { course: courseWithSessions(state, course) });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerCoveredAreasHandler(req, res) {
  return api(async (request, response) => {
    const state = await loadCourseState();
    if (request.method === 'GET') return sendJson(response, 200, { coveredAreas: state.coveredAreas });
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const area = normalizeCoveredArea(body);
      state.coveredAreas.push(area);
      await saveCourseState(state);
      return sendJson(response, 201, { coveredArea: area });
    }
    if (request.method === 'PUT') {
      const id = String(body.id || '');
      const index = state.coveredAreas.findIndex((area) => area.id === id);
      if (index < 0) throw new HttpError(404, 'Covered area not found.');
      state.coveredAreas[index] = normalizeCoveredArea(body.coveredArea || body, state.coveredAreas[index]);
      await saveCourseState(state);
      return sendJson(response, 200, { coveredArea: state.coveredAreas[index] });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerApplicationsHandler(req, res) {
  return api(async (request, response) => {
    const state = await loadCourseState();
    if (request.method === 'GET') {
      const applications = sortByUpdatedAt(state.applications).map((item) => ({ ...item, course: userCourseSummary(state, item.courseId) }));
      return sendJson(response, 200, { applications });
    }
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
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
      await saveCourseState(state);
      return sendJson(response, 200, { application: { ...candidate, course: userCourseSummary(state, candidate.courseId) } });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerPrivateRequestsHandler(req, res) {
  return api(async (request, response) => {
    const state = await loadCourseState();
    if (request.method === 'GET') return sendJson(response, 200, { privateRequests: sortByUpdatedAt(state.privateRequests), coveredAreas: state.coveredAreas });
    requireSameOrigin(request);
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const id = String(body.id || '');
      const index = state.privateRequests.findIndex((item) => item.id === id);
      if (index < 0) throw new HttpError(404, 'Private request not found.');
      state.privateRequests[index] = updatePrivateRequest(body, state.privateRequests[index]);
      await saveCourseState(state);
      return sendJson(response, 200, { privateRequest: state.privateRequests[index] });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerCalendarHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') return sendJson(response, 200, { events: calendarEvents(state) });
    requireSameOrigin(request);
    if (request.method === 'POST') {
      const block = normalizeOwnerBlock(await readJson(request), session.user.id);
      state.ownerBlockedTimes.push(block);
      await saveCourseState(state);
      return sendJson(response, 201, { event: block });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
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
    const state = await loadCourseState();
    if (request.method === 'GET') {
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
      const comment = normalizeJournalComment(await readJson(request), state, session.user.id);
      state.journalComments.push(comment);
      await saveCourseState(state);
      return sendJson(response, 201, { comment });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}

export async function ownerActionItemsHandler(req, res) {
  return api(async (request, response, session) => {
    const state = await loadCourseState();
    if (request.method === 'GET') return sendJson(response, 200, { actionItems: sortByUpdatedAt(state.actionItems) });
    requireSameOrigin(request);
    const body = await readJson(request);
    if (request.method === 'POST') {
      const item = normalizeActionItem(body, state, session.user.id);
      state.actionItems.push(item);
      await saveCourseState(state);
      return sendJson(response, 201, { actionItem: item });
    }
    if (request.method === 'PATCH') {
      const id = String(body.id || '');
      const index = state.actionItems.findIndex((item) => item.id === id);
      if (index < 0) throw new HttpError(404, 'Action item not found.');
      state.actionItems[index] = normalizeActionItem(body, state, session.user.id, state.actionItems[index]);
      await saveCourseState(state);
      return sendJson(response, 200, { actionItem: state.actionItems[index] });
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }, req, res, true);
}
