import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ownerPage = fs.readFileSync('owner/index.html', 'utf8');
const dashboardJs = fs.readFileSync('assets/js/course-dashboard.js', 'utf8');
const dashboardCss = fs.readFileSync('assets/css/course-dashboard.css', 'utf8');

test('owner dashboard uses hidden left drawer navigation instead of top tabs', () => {
  assert.match(ownerPage, /data-owner-sidebar-toggle/);
  assert.match(ownerPage, /id="owner-sidebar"/);
  assert.match(ownerPage, /data-owner-nav-link[^>]*>Calendar/);
  assert.match(ownerPage, /data-owner-nav-link[^>]*>Students/);
  assert.match(ownerPage, /data-owner-nav-link[^>]*>Courses/);
  assert.match(ownerPage, /data-owner-nav-link[^>]*>Applications/);
  assert.match(ownerPage, /data-owner-nav-link[^>]*>Journals/);
  assert.equal(ownerPage.includes('<nav class="course-tabs"'), false);
  assert.match(dashboardCss, /\.owner-sidebar\.is-open/);
});

test('owner dashboard exposes calendar views, sync controls, and student filters', () => {
  assert.match(ownerPage, /data-owner-calendar-view="month"/);
  assert.match(ownerPage, /data-owner-calendar-view="week"/);
  assert.match(ownerPage, /data-owner-calendar-view="day"/);
  assert.match(ownerPage, /data-owner-calendar-view="list"/);
  assert.match(ownerPage, /data-google-calendar-status/);
  assert.match(ownerPage, /data-owner-user-filter="student"/);
  assert.match(dashboardJs, /\/api\/owner\/google-calendar\/connect\//);
  assert.match(dashboardJs, /\/api\/owner\/google-calendar\/sync\//);
});

test('owner calendar supports class creation and event edit actions', () => {
  assert.match(ownerPage, /value="owner_availability"/);
  assert.match(ownerPage, /value="owner_blocked_time"/);
  assert.match(ownerPage, /value="free_workshop"/);
  assert.match(ownerPage, /value="group_course_session"/);
  assert.match(ownerPage, /value="confirmed_private_class"/);
  assert.match(dashboardJs, /data-owner-event-edit/);
  assert.match(dashboardJs, /jsonFetch\('\/api\/owner\/calendar\/'[\s\S]*method:\s*'PUT'/);
  assert.match(dashboardJs, /jsonFetch\('\/api\/owner\/calendar\/'[\s\S]*method:\s*'DELETE'/);
});
