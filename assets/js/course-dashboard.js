/* =====================================================================
 *  course-dashboard.js
 *  ---------------------------------------------------------------------
 *  Course discovery, student dashboard, and owner dashboard flows.
 * ===================================================================== */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'class') node.className = attrs[key];
        else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
      });
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function jsonFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({ accept: 'application/json' }, options.headers || {});
    if (options.body && !options.headers['content-type']) options.headers['content-type'] = 'application/json';
    return fetch(url, Object.assign({ credentials: 'same-origin' }, options))
      .then(function (response) {
        return response.text().then(function (text) {
          var json = {};
          if (text) {
            try { json = JSON.parse(text); } catch (err) {}
          }
          if (!response.ok) {
            var error = new Error((json && json.error) || 'Request failed.');
            error.status = response.status;
            throw error;
          }
          return json;
        });
      });
  }

  function money(cents, currency) {
    if (!cents) return 'Free';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(cents / 100);
    } catch {
      return '$' + Math.round(cents / 100).toLocaleString('en-US');
    }
  }

  function dateRange(session) {
    if (!session || !session.startAt) return 'Schedule pending';
    var start = new Date(session.startAt);
    var end = session.endAt ? new Date(session.endAt) : null;
    var date = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    var time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (!end) return date + ' at ' + time;
    return date + ' - ' + time + ' to ' + end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function typeLabel(type) {
    if (type === 'free_workshop') return 'Free Workshop';
    return 'Regular Group Course';
  }

  function statusPill(status) {
    return el('span', { class: 'course-status course-status--' + String(status || 'pending') }, status || 'pending');
  }

  function courseMeta(course) {
    var bits = [
      typeLabel(course.courseType),
      course.deliveryMode === 'offline' ? 'Offline' : 'Online',
      money(course.priceCents, course.currency),
    ];
    if (course.capacity) bits.push(course.capacity + ' seats');
    if (course.coveredArea) bits.push(course.coveredArea.name);
    return bits.join(' · ');
  }

  function openSignIn() {
    var control = $('[data-account-login]');
    if (control) control.click();
  }

  function loadSession() {
    return jsonFetch('/api/auth/session/').then(function (json) {
      return json.authenticated ? json.user : null;
    }).catch(function () { return null; });
  }

  function renderCourseCard(course, opts) {
    opts = opts || {};
    var firstSession = (course.sessions || [])[0];
    var article = el('article', { class: 'course-card' });
    var head = el('div', { class: 'course-card__head' });
    head.appendChild(el('span', { class: 'course-card__type' }, typeLabel(course.courseType)));
    head.appendChild(el('span', { class: 'course-card__mode' }, course.deliveryMode === 'offline' ? 'Offline' : 'Online'));
    article.appendChild(head);
    article.appendChild(el('h3', null, course.title));
    article.appendChild(el('p', { class: 'course-card__desc' }, course.description));
    article.appendChild(el('p', { class: 'course-card__meta' }, courseMeta(course)));
    article.appendChild(el('p', { class: 'course-card__schedule' }, dateRange(firstSession)));
    if (opts.apply) {
      var btn = el('button', { class: 'btn btn-primary', type: 'button', 'data-apply-course': course.id }, 'Apply');
      article.appendChild(btn);
    } else {
      article.appendChild(el('a', { class: 'btn btn-secondary', href: '/dashboard/' }, 'Sign in to apply'));
    }
    return article;
  }

  function initPublicCourses(root) {
    var dynamic = $('[data-public-course-list]', root);
    if (!dynamic) return;
    dynamic.innerHTML = '<p class="course-muted">Loading scheduled courses...</p>';
    jsonFetch('/api/courses/')
      .then(function (json) {
        var courses = Array.isArray(json.courses) ? json.courses : [];
        dynamic.innerHTML = '';
        if (!courses.length) {
          dynamic.appendChild(el('p', { class: 'course-muted' }, 'No public cohorts are scheduled yet. Sign in to request private guidance or check back for the next workshop.'));
          return;
        }
        courses.slice(0, 3).forEach(function (course) {
          dynamic.appendChild(renderCourseCard(course));
        });
      })
      .catch(function () {
        dynamic.innerHTML = '<p class="course-muted">Scheduled course data is unavailable right now.</p>';
      });
  }

  function setDashboardMessage(root, text, kind) {
    var node = $('[data-course-message]', root);
    if (!node) return;
    node.textContent = text || '';
    node.hidden = !text;
    if (kind) node.setAttribute('data-state', kind);
    else node.removeAttribute('data-state');
  }

  function renderStudent(root, state) {
    var auth = $('[data-course-auth]', root);
    var content = $('[data-course-content]', root);
    if (!state.user) {
      if (auth) auth.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (auth) auth.hidden = true;
    if (content) content.hidden = false;

    var courseList = $('[data-course-list]', root);
    if (courseList) {
      courseList.innerHTML = '';
      if (!state.courses.length) courseList.appendChild(el('p', { class: 'course-muted' }, 'No public courses are open yet.'));
      state.courses.forEach(function (course) { courseList.appendChild(renderCourseCard(course, { apply: true })); });
    }

    var apps = $('[data-application-list]', root);
    if (apps) {
      apps.innerHTML = '';
      if (!state.applications.length) apps.appendChild(el('p', { class: 'course-muted' }, 'No course applications yet.'));
      state.applications.forEach(function (item) {
        var row = el('article', { class: 'course-row' });
        row.appendChild(statusPill(item.status));
        row.appendChild(el('h3', null, item.course ? item.course.title : 'Course'));
        row.appendChild(el('p', null, item.ownerNote || item.goals || 'Application submitted.'));
        apps.appendChild(row);
      });
    }

    var requests = $('[data-private-list]', root);
    if (requests) {
      requests.innerHTML = '';
      if (!state.privateRequests.length) requests.appendChild(el('p', { class: 'course-muted' }, 'No private class requests yet.'));
      state.privateRequests.forEach(function (item) {
        var row = el('article', { class: 'course-row' });
        row.appendChild(statusPill(item.status));
        row.appendChild(el('h3', null, (item.deliveryMode === 'offline' ? 'Offline' : 'Online') + ' private class'));
        row.appendChild(el('p', null, item.ownerResponse || item.preferredDates || item.goals || 'Request sent.'));
        requests.appendChild(row);
      });
    }

    var journal = $('[data-journal-list]', root);
    if (journal) {
      journal.innerHTML = '';
      if (!state.entries.length) journal.appendChild(el('p', { class: 'course-muted' }, 'No journal entries yet.'));
      state.entries.forEach(function (entry) {
        var row = el('article', { class: 'course-row course-row--journal' });
        row.appendChild(el('h3', null, new Date(entry.createdAt).toLocaleDateString()));
        row.appendChild(el('p', null, entry.body));
        (entry.comments || []).forEach(function (comment) {
          var note = el('blockquote', { class: 'course-comment' });
          if (comment.selectedText) note.appendChild(el('strong', null, comment.selectedText));
          note.appendChild(el('span', null, comment.comment));
          row.appendChild(note);
        });
        journal.appendChild(row);
      });
    }

    var actions = $('[data-action-list]', root);
    if (actions) {
      actions.innerHTML = '';
      if (!state.actionItems.length) actions.appendChild(el('p', { class: 'course-muted' }, 'No action items assigned yet.'));
      state.actionItems.forEach(function (item) {
        var row = el('article', { class: 'course-row course-row--action' });
        row.appendChild(statusPill(item.status));
        row.appendChild(el('h3', null, item.title));
        row.appendChild(el('p', null, item.description || item.ownerComment || ''));
        if (item.status === 'open') {
          row.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-action-done': item.id }, 'Mark done'));
        }
        actions.appendChild(row);
      });
    }
  }

  function loadStudent(root) {
    var state = { user: null, courses: [], applications: [], privateRequests: [], entries: [], actionItems: [], coveredAreas: [] };
    return loadSession()
      .then(function (user) {
        state.user = user;
        if (!user) return state;
        return Promise.all([
          jsonFetch('/api/courses/'),
          jsonFetch('/api/applications/'),
          jsonFetch('/api/private-requests/'),
          jsonFetch('/api/journals/'),
          jsonFetch('/api/action-items/'),
        ]).then(function (parts) {
          state.courses = parts[0].courses || [];
          state.coveredAreas = parts[2].coveredAreas || parts[0].coveredAreas || [];
          state.applications = parts[1].applications || [];
          state.privateRequests = parts[2].privateRequests || [];
          state.entries = parts[3].entries || [];
          state.actionItems = parts[4].actionItems || [];
          return state;
        });
      })
      .then(function (next) {
        renderCoveredAreaOptions(root, next.coveredAreas || []);
        renderStudent(root, next);
        return next;
      })
      .catch(function (err) {
        setDashboardMessage(root, err.message || 'Could not load dashboard.', 'error');
      });
  }

  function renderCoveredAreaOptions(root, areas) {
    $all('[data-covered-area-select]', root).forEach(function (select) {
      var value = select.value;
      select.innerHTML = '<option value="">Select covered area</option>';
      areas.forEach(function (area) {
        var option = el('option', { value: area.id }, area.name + (area.city ? ' - ' + area.city : ''));
        select.appendChild(option);
      });
      if (value) select.value = value;
    });
  }

  function formJson(form) {
    var out = {};
    $all('input, textarea, select', form).forEach(function (field) {
      if (!field.name) return;
      if (field.type === 'checkbox') out[field.name] = field.checked;
      else out[field.name] = field.value;
    });
    return out;
  }

  var ownerUi = {
    calendarDate: new Date(),
    calendarView: 'month',
    userFilter: 'all',
    userSearch: '',
    selectedEventId: '',
    selectedUserId: '',
  };

  function initStudentDashboard(root) {
    root.addEventListener('click', function (evt) {
      var apply = evt.target.closest('[data-apply-course]');
      if (apply) {
        evt.preventDefault();
        apply.disabled = true;
        jsonFetch('/api/applications/', {
          method: 'POST',
          body: JSON.stringify({ courseId: apply.getAttribute('data-apply-course') }),
        }).then(function () {
          setDashboardMessage(root, 'Application submitted.', 'success');
          return loadStudent(root);
        }).catch(function (err) {
          setDashboardMessage(root, err.message || 'Could not apply.', 'error');
        }).finally(function () {
          apply.disabled = false;
        });
        return;
      }
      var done = evt.target.closest('[data-action-done]');
      if (done) {
        evt.preventDefault();
        jsonFetch('/api/action-items/', {
          method: 'PATCH',
          body: JSON.stringify({ id: done.getAttribute('data-action-done'), status: 'done' }),
        }).then(function () {
          setDashboardMessage(root, 'Action item marked done.', 'success');
          return loadStudent(root);
        }).catch(function (err) {
          setDashboardMessage(root, err.message || 'Could not update action item.', 'error');
        });
      }
    });

    var privateForm = $('[data-private-request-form]', root);
    if (privateForm) {
      privateForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        jsonFetch('/api/private-requests/', { method: 'POST', body: JSON.stringify(formJson(privateForm)) })
          .then(function () {
            privateForm.reset();
            setDashboardMessage(root, 'Private class request sent.', 'success');
            return loadStudent(root);
          })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not send request.', 'error'); });
      });
    }

    var journalForm = $('[data-journal-form]', root);
    if (journalForm) {
      journalForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        jsonFetch('/api/journals/', { method: 'POST', body: JSON.stringify(formJson(journalForm)) })
          .then(function () {
            journalForm.reset();
            setDashboardMessage(root, 'Journal entry saved.', 'success');
            return loadStudent(root);
          })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save journal.', 'error'); });
      });
    }

    window.addEventListener('iyogau:auth-state-changed', function () { loadStudent(root); });
    loadStudent(root);
  }

  function renderOwner(root, state) {
    root.__ownerState = state;
    var auth = $('[data-owner-auth]', root);
    var content = $('[data-owner-content]', root);
    if (!state.owner) {
      if (auth) auth.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (auth) auth.hidden = true;
    if (content) content.hidden = false;

    renderCoveredAreaOptions(root, state.coveredAreas);
    renderGoogleCalendarStatus(root, state.google || {});
    renderOwnerCalendar(root, state);
    renderOwnerCourses(root, state.courses);
    renderOwnerAreas(root, state.coveredAreas);
    renderOwnerUsers(root, state);
    renderApplications(root, state.applications);
    renderPrivateRequests(root, state.privateRequests);
    renderJournalReview(root, state.entries);
    renderOwnerActions(root, state.actionItems);
    renderStudentProfile(root, ownerUi.selectedUserId, state);
  }

  function renderGoogleCalendarStatus(root, google) {
    var node = $('[data-google-calendar-status]', root);
    if (!node) return;
    node.innerHTML = '';
    var status = el('div', { class: 'owner-sync-card' });
    status.appendChild(statusPill(google.connected ? 'connected' : (google.configured ? 'pending' : 'not-configured')));
    status.appendChild(el('strong', null, google.connected ? 'Google Calendar connected' : (google.configured ? 'Calendar ready to connect' : 'Calendar sync not configured')));
    status.appendChild(el('span', null, google.connected
      ? ((google.calendarName || 'iYogaU Calendar') + ' · ' + (google.lastSyncedAt ? 'Last sync ' + shortDateTime(google.lastSyncedAt) : 'Not synced yet'))
      : (google.configured ? 'Connect Ali owner access to sync iYogaU events.' : 'Add Calendar OAuth variables to enable live sync.')));
    var actions = el('div', { class: 'owner-sync-card__actions' });
    if (google.configured && !google.connected) {
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-google-calendar-connect': '1' }, 'Connect Google Calendar'));
    }
    if (google.connected) {
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-google-calendar-sync': '1' }, 'Sync now'));
    }
    status.appendChild(actions);
    if (google.lastError) status.appendChild(el('span', { class: 'owner-sync-card__error' }, google.lastError));
    node.appendChild(status);
  }

  function renderOwnerCalendar(root, state) {
    var label = $('[data-owner-calendar-label]', root);
    var grid = $('[data-owner-calendar-grid]', root);
    if (!grid) return;
    var view = ownerUi.calendarView || 'month';
    $all('[data-owner-calendar-view]', root).forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-owner-calendar-view') === view ? 'true' : 'false');
    });
    if (label) label.textContent = calendarRangeLabel(ownerUi.calendarDate, view);
    grid.innerHTML = '';
    var events = (state.events || []).slice().sort(function (a, b) {
      return String(a.startAt || '').localeCompare(String(b.startAt || ''));
    });
    if (view === 'list') renderCalendarList(grid, events);
    else renderCalendarCells(grid, events, view);
    renderEventDetail(root, ownerUi.selectedEventId, state);
  }

  function renderCalendarCells(node, events, view) {
    var days = calendarDays(ownerUi.calendarDate, view);
    var board = el('div', { class: 'owner-calendar-grid owner-calendar-grid--' + view });
    var headings = view === 'day' ? [] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    headings.forEach(function (day) {
      board.appendChild(el('div', { class: 'owner-calendar-grid__weekday' }, day));
    });
    days.forEach(function (date) {
      var key = dateKey(date);
      var cell = el('div', { class: 'owner-calendar-cell' + (sameMonth(date, ownerUi.calendarDate) ? '' : ' is-muted') });
      cell.appendChild(el('span', { class: 'owner-calendar-cell__date' }, String(date.getDate())));
      events.filter(function (event) { return dateKey(new Date(event.startAt)) === key; }).slice(0, 4).forEach(function (event) {
        cell.appendChild(calendarEventButton(event));
      });
      var hiddenCount = events.filter(function (event) { return dateKey(new Date(event.startAt)) === key; }).length - 4;
      if (hiddenCount > 0) cell.appendChild(el('span', { class: 'owner-calendar-more' }, '+' + hiddenCount + ' more'));
      board.appendChild(cell);
    });
    node.appendChild(board);
  }

  function renderCalendarList(node, events) {
    var list = el('div', { class: 'owner-agenda' });
    if (!events.length) {
      list.appendChild(el('p', { class: 'course-muted' }, 'No calendar items yet.'));
      node.appendChild(list);
      return;
    }
    events.forEach(function (event) {
      var row = el('article', { class: 'owner-agenda-row owner-agenda-row--' + eventClass(event.eventType) });
      row.appendChild(el('span', { class: 'owner-agenda-row__time' }, shortDateTime(event.startAt)));
      row.appendChild(calendarEventButton(event));
      row.appendChild(el('span', { class: 'owner-agenda-row__meta' }, sourceLabel(event)));
      list.appendChild(row);
    });
    node.appendChild(list);
  }

  function calendarEventButton(event) {
    var button = el('button', {
      type: 'button',
      class: 'owner-event-chip owner-event-chip--' + eventClass(event.eventType),
      'data-owner-calendar-event': event.id,
      title: event.title || event.eventType,
    });
    button.appendChild(el('span', null, event.title || event.eventType));
    button.appendChild(el('small', null, eventTime(event)));
    return button;
  }

  function renderEventDetail(root, id, state) {
    var node = $('[data-owner-event-detail]', root);
    if (!node) return;
    var event = (state.events || []).find(function (item) { return item.id === id; }) || null;
    node.innerHTML = '';
    node.appendChild(el('h3', null, event ? event.title : 'Event details'));
    if (!event) {
      node.appendChild(el('p', { class: 'course-muted' }, 'Select a calendar item to review its source and sync status.'));
      return;
    }
    node.appendChild(statusPill(event.eventType));
    node.appendChild(el('p', null, dateRange(event)));
    node.appendChild(el('p', { class: 'course-muted' }, sourceLabel(event)));
    node.appendChild(el('p', { class: 'course-muted' }, 'Sync: ' + (event.syncStatus || 'local_only') + (event.googleEventId ? ' · Google event connected' : '')));
    if (event.sourceType === 'owner_availability' || event.sourceType === 'owner_blocked_time') {
      var form = el('form', { class: 'course-form owner-event-edit', 'data-owner-event-edit': event.id });
      var grid = el('div', { class: 'course-form__grid' });
      var typeLabelEl = el('label', null, 'Type');
      var type = el('select', { name: 'eventType' });
      type.appendChild(el('option', { value: 'owner_availability' }, 'Available'));
      type.appendChild(el('option', { value: 'owner_blocked_time' }, 'Unavailable'));
      type.value = event.eventType;
      typeLabelEl.appendChild(type);
      grid.appendChild(typeLabelEl);
      grid.appendChild(labelWithInput('Title', { name: 'title', value: event.title || '' }));
      grid.appendChild(labelWithInput('Start', { name: 'startAt', type: 'datetime-local', value: localInputDateTime(event.startAt) }));
      grid.appendChild(labelWithInput('End', { name: 'endAt', type: 'datetime-local', value: localInputDateTime(event.endAt) }));
      grid.appendChild(labelWithInput('Timezone', { name: 'timezone', value: event.timezone || 'America/Los_Angeles' }));
      form.appendChild(grid);
      var notesLabel = el('label', null, 'Notes');
      notesLabel.appendChild(el('textarea', { name: 'notes' }, event.notes || ''));
      form.appendChild(notesLabel);
      var actions = el('div', { class: 'owner-table-actions' });
      actions.appendChild(el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save event'));
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-event-delete': event.id }, 'Delete'));
      form.appendChild(actions);
      node.appendChild(form);
    } else {
      var links = el('div', { class: 'owner-table-actions' });
      if (event.courseId) links.appendChild(ownerSectionButton('Open course section', '#courses'));
      if (event.requestId) links.appendChild(ownerSectionButton('Open applications', '#applications'));
      node.appendChild(links);
    }
  }

  function labelWithInput(text, attrs) {
    var label = el('label', null, text);
    label.appendChild(el('input', attrs));
    return label;
  }

  function ownerSectionButton(text, hash) {
    return el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-jump': hash }, text);
  }

  function renderOwnerCourses(root, courses) {
    renderOwnerTable($('[data-owner-course-list]', root), 'Courses', [
      { label: 'Title', render: function (course) { return course.title; } },
      { label: 'Type', render: function (course) { return typeLabel(course.courseType); } },
      { label: 'Mode', render: function (course) { return course.deliveryMode === 'offline' ? 'Offline' : 'Online'; } },
      { label: 'Schedule', render: function (course) { return dateRange((course.sessions || [])[0]); } },
      { label: 'Capacity', render: function (course) { return course.capacity || 'Open'; } },
      { label: 'Status', render: function (course) { return statusPill(course.status); } },
    ], courses, 'No courses yet.');
  }

  function renderOwnerAreas(root, areas) {
    renderOwnerTable($('[data-owner-area-list]', root), 'Covered areas', [
      { label: 'Name', render: function (area) { return area.name; } },
      { label: 'City', render: function (area) { return [area.city, area.region, area.country].filter(Boolean).join(', ') || area.country; } },
      { label: 'Radius', render: function (area) { return area.radiusKm ? area.radiusKm + ' km' : 'Not set'; } },
      { label: 'Status', render: function (area) { return statusPill(area.active === false ? 'inactive' : 'active'); } },
    ], areas, 'No covered areas yet.');
  }

  function renderOwnerUsers(root, state) {
    var users = (state.users || []).filter(function (user) {
      var role = ownerUserRole(user);
      var query = ownerUi.userSearch.toLowerCase();
      if (ownerUi.userFilter !== 'all' && role !== ownerUi.userFilter) return false;
      if (!query) return true;
      return String(user.email || '').toLowerCase().includes(query) ||
        String(user.name || '').toLowerCase().includes(query) ||
        String(user.id || '').toLowerCase().includes(query);
    });
    $all('[data-owner-user-filter]', root).forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-owner-user-filter') === ownerUi.userFilter ? 'true' : 'false');
    });
    renderOwnerTable($('[data-owner-user-list]', root), 'Students and users', [
      { label: 'Person', render: function (user) { return user.name || user.email || user.id; } },
      { label: 'Email', render: function (user) { return user.email || 'No email'; } },
      { label: 'Status', render: function (user) { return statusPill(ownerUserRole(user)); } },
      { label: 'Applications', render: function (user) { return String(user.applications || 0); } },
      { label: 'Journals', render: function (user) { return String(user.journals || 0); } },
      { label: 'Actions', render: function (user) { return String(user.actionItems || 0); } },
      { label: 'Open', render: function (user) { return el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-open-user': user.id }, 'Profile'); } },
    ], users, 'No registered user activity yet.');
  }

  function renderOwnerActions(root, items) {
    renderOwnerTable($('[data-owner-action-list]', root), 'Action items', [
      { label: 'Status', render: function (item) { return statusPill(item.status); } },
      { label: 'Title', render: function (item) { return item.title; } },
      { label: 'User', render: function (item) { return item.userId; } },
      { label: 'Due', render: function (item) { return item.dueAt ? shortDateTime(item.dueAt) : 'No due date'; } },
    ], items, 'No action items yet.');
  }

  function renderOwnerTable(node, caption, columns, items, emptyText) {
    if (!node) return;
    node.innerHTML = '';
    if (!items || !items.length) {
      node.appendChild(el('p', { class: 'course-muted' }, emptyText || 'No records yet.'));
      return;
    }
    var table = el('table', { class: 'owner-table' });
    table.appendChild(el('caption', { class: 'sr-only' }, caption));
    var thead = el('thead');
    var headRow = el('tr');
    columns.forEach(function (column) { headRow.appendChild(el('th', { scope: 'col' }, column.label)); });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    items.forEach(function (item) {
      var tr = el('tr');
      columns.forEach(function (column) {
        var td = el('td', { 'data-label': column.label });
        var value = column.render(item);
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = value == null ? '' : String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    node.appendChild(table);
  }

  function renderApplications(root, applications) {
    var node = $('[data-owner-application-list]', root);
    renderOwnerTable(node, 'Applications', [
      { label: 'Applicant', render: function (app) { return app.userName || app.userEmail || app.userId; } },
      { label: 'Course', render: function (app) { return app.course ? app.course.title : 'Course'; } },
      { label: 'Status', render: function (app) { return statusPill(app.status); } },
      { label: 'Notes', render: function (app) { return app.goals || app.notes || app.ownerNote || 'No notes'; } },
      { label: 'Actions', render: function (app) {
        var actions = el('div', { class: 'owner-table-actions' });
        ['approved', 'waitlisted', 'rejected'].forEach(function (status) {
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-application': app.id, 'data-status': status }, status));
        });
        return actions;
      } },
    ], applications, 'No applications yet.');
  }

  function renderPrivateRequests(root, requests) {
    var node = $('[data-owner-private-list]', root);
    renderOwnerTable(node, 'Private requests', [
      { label: 'Student', render: function (request) { return request.userName || request.userEmail || request.userId; } },
      { label: 'Group', render: function (request) { return request.groupSize + ' person'; } },
      { label: 'Mode', render: function (request) { return request.deliveryMode === 'offline' ? 'Offline' : 'Online'; } },
      { label: 'Status', render: function (request) { return statusPill(request.status); } },
      { label: 'Request', render: function (request) { return request.goals || request.preferredDates || request.notes || 'No notes'; } },
      { label: 'Schedule', render: function (request) {
        var box = el('div', { class: 'owner-inline-fields' });
        box.appendChild(el('input', { name: 'ownerResponse', placeholder: 'Owner response', 'data-private-response': request.id }));
        box.appendChild(el('input', { name: 'confirmedStartAt', type: 'datetime-local', 'data-private-start': request.id }));
        box.appendChild(el('input', { name: 'confirmedEndAt', type: 'datetime-local', 'data-private-end': request.id }));
        return box;
      } },
      { label: 'Actions', render: function (request) {
        var actions = el('div', { class: 'owner-table-actions' });
        ['proposed', 'confirmed', 'rejected'].forEach(function (status) {
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-private': request.id, 'data-status': status }, status));
        });
        return actions;
      } },
    ], requests, 'No private requests yet.');
  }

  function renderJournalReview(root, entries) {
    var node = $('[data-owner-journal-list]', root);
    renderOwnerTable(node, 'Journal review', [
      { label: 'Student', render: function (entry) { return entry.userName || entry.userEmail || entry.userId; } },
      { label: 'Date', render: function (entry) { return new Date(entry.createdAt).toLocaleDateString(); } },
      { label: 'Entry', render: function (entry) { return entry.body; } },
      { label: 'Review', render: function (entry) {
        var box = el('div', { class: 'owner-inline-fields' });
        box.appendChild(el('input', { placeholder: 'Selected sentence', 'data-comment-selected': entry.id }));
        box.appendChild(el('textarea', { placeholder: 'Owner comment', 'data-comment-body': entry.id }));
        return box;
      } },
      { label: 'Actions', render: function (entry) {
        var actions = el('div', { class: 'owner-table-actions' });
        actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-comment': entry.id }, 'Comment'));
        actions.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-action-from-entry': entry.id, 'data-user-id': entry.userId }, 'Create action'));
        return actions;
      } },
    ], entries, 'No journal entries yet.');
  }

  function renderStudentProfile(root, userId, state) {
    var node = $('[data-owner-student-profile]', root);
    if (!node) return;
    if (!userId) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }
    var user = (state.users || []).find(function (item) { return item.id === userId; });
    if (!user) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }
    var apps = (state.applications || []).filter(function (item) { return item.userId === userId; });
    var requests = (state.privateRequests || []).filter(function (item) { return item.userId === userId; });
    var journals = (state.entries || []).filter(function (item) { return item.userId === userId; });
    var actions = (state.actionItems || []).filter(function (item) { return item.userId === userId; });
    node.hidden = false;
    node.innerHTML = '';
    node.appendChild(el('h3', null, user.name || user.email || user.id));
    node.appendChild(el('p', { class: 'course-muted' }, (user.email || 'No email') + ' · ' + ownerUserRole(user)));
    var stats = el('div', { class: 'owner-student-profile__stats' });
    stats.appendChild(el('span', null, apps.length + ' applications'));
    stats.appendChild(el('span', null, requests.length + ' private requests'));
    stats.appendChild(el('span', null, journals.length + ' journals'));
    stats.appendChild(el('span', null, actions.length + ' action items'));
    node.appendChild(stats);
    var recent = el('div', { class: 'owner-student-profile__recent' });
    recent.appendChild(el('strong', null, 'Recent activity'));
    recent.appendChild(el('p', null, journals[0] ? journals[0].body : 'No journal entries yet.'));
    node.appendChild(recent);
  }

  function ownerUserRole(user) {
    if (user.role) return user.role;
    if (user.approvedApplications || user.confirmedPrivateRequests) return 'student';
    if (user.applications || user.privateRequests) return 'applicant';
    return 'user';
  }

  function calendarDays(anchor, view) {
    if (view === 'day') return [startOfDay(anchor)];
    if (view === 'week') {
      var weekStart = startOfWeek(anchor);
      return Array.from({ length: 7 }, function (_, index) { return addDays(weekStart, index); });
    }
    var start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return Array.from({ length: 42 }, function (_, index) { return addDays(start, index); });
  }

  function calendarRangeLabel(anchor, view) {
    if (view === 'day') return anchor.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    if (view === 'week') {
      var start = startOfWeek(anchor);
      var end = addDays(start, 6);
      return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' - ' + end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (view === 'list') return 'Agenda';
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfWeek(date) {
    var day = date.getDay();
    return addDays(startOfDay(date), -day);
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function eventClass(type) {
    return String(type || 'event').replace(/_/g, '-');
  }

  function eventTime(event) {
    if (!event.startAt) return '';
    return new Date(event.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function shortDateTime(value) {
    if (!value) return '';
    var date = new Date(value);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function sourceLabel(event) {
    if (event.sourceType === 'course_session') return 'Course session';
    if (event.sourceType === 'private_request') return 'Private class';
    if (event.sourceType === 'owner_availability') return 'Owner availability';
    if (event.sourceType === 'owner_blocked_time') return 'Unavailable time';
    return event.eventType || 'Calendar item';
  }

  function loadOwner(root) {
    var state = { owner: false, courses: [], coveredAreas: [], applications: [], privateRequests: [], events: [], users: [], entries: [], actionItems: [], google: {} };
    return loadSession()
      .then(function (user) {
        if (!user) {
          renderOwner(root, state);
          setDashboardMessage(root, 'Sign in with the owner account to manage courses.', null);
          return null;
        }
        return jsonFetch('/api/owner/courses/');
      })
      .then(function (ownerGate) {
        if (!ownerGate) return null;
        return Promise.all([
          Promise.resolve(ownerGate),
          jsonFetch('/api/owner/applications/'),
          jsonFetch('/api/owner/private-requests/'),
          jsonFetch('/api/owner/calendar/'),
          jsonFetch('/api/owner/users/'),
          jsonFetch('/api/owner/journal-comments/'),
          jsonFetch('/api/owner/action-items/'),
        ]);
      })
      .then(function (parts) {
        if (!parts) return;
        state.owner = true;
        state.courses = parts[0].courses || [];
        state.coveredAreas = parts[0].coveredAreas || [];
        state.applications = parts[1].applications || [];
        state.privateRequests = parts[2].privateRequests || [];
        state.events = parts[3].events || [];
        state.google = parts[3].google || {};
        state.users = parts[4].users || [];
        state.entries = parts[5].entries || [];
        state.actionItems = parts[6].actionItems || [];
        renderOwner(root, state);
      })
      .catch(function (err) {
        state.owner = false;
        renderOwner(root, state);
        setDashboardMessage(root, err.status === 403 ? 'Owner access is required for this dashboard.' : (err.message || 'Could not load owner dashboard.'), 'error');
      });
  }

  function isoFromLocal(value) {
    if (!value) return '';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function localInputDateTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var pad = function (num) { return String(num).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function ownerCoursePayload(form) {
    var data = formJson(form);
    var sessions = [];
    if (data.sessionStartAt && data.sessionEndAt) {
      sessions.push({
        title: data.title,
        startAt: isoFromLocal(data.sessionStartAt),
        endAt: isoFromLocal(data.sessionEndAt),
        timezone: data.timezone || 'America/Los_Angeles',
      });
    }
    return {
      courseType: data.courseType,
      deliveryMode: data.deliveryMode,
      title: data.title,
      description: data.description,
      priceCents: data.courseType === 'free_workshop' ? 0 : Number(data.priceCents || 0),
      currency: data.currency || 'USD',
      capacity: data.capacity ? Number(data.capacity) : null,
      coveredAreaId: data.coveredAreaId,
      locationName: data.locationName,
      onlineUrl: data.onlineUrl,
      status: data.status || 'draft',
      sessions: sessions,
    };
  }

  function initOwnerDashboard(root) {
    initOwnerSidebar(root);
    var areaForm = $('[data-owner-area-form]', root);
    if (areaForm) {
      areaForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        jsonFetch('/api/owner/covered-areas/', { method: 'POST', body: JSON.stringify(formJson(areaForm)) })
          .then(function () { areaForm.reset(); setDashboardMessage(root, 'Covered area saved.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save covered area.', 'error'); });
      });
    }
    var courseForm = $('[data-owner-course-form]', root);
    if (courseForm) {
      courseForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        jsonFetch('/api/owner/courses/', { method: 'POST', body: JSON.stringify(ownerCoursePayload(courseForm)) })
          .then(function () { courseForm.reset(); setDashboardMessage(root, 'Course saved.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save course.', 'error'); });
      });
    }
    var calendarForm = $('[data-owner-calendar-form]', root) || $('[data-owner-block-form]', root);
    if (calendarForm) {
      calendarForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        var data = formJson(calendarForm);
        if (data.eventType === 'confirmed_private_class') {
          data.userId = data.userEmail || 'owner-created-private-student';
          data.userName = data.userEmail || 'Private student';
          data.groupSize = data.capacity || 1;
        }
        if (data.eventType === 'group_course_session') data.courseType = 'regular_group_course';
        data.startAt = isoFromLocal(data.startAt);
        data.endAt = isoFromLocal(data.endAt);
        jsonFetch('/api/owner/calendar/', { method: 'POST', body: JSON.stringify(data) })
          .then(function () { calendarForm.reset(); setDashboardMessage(root, 'Calendar item saved.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save calendar item.', 'error'); });
      });
    }
    var actionForm = $('[data-owner-action-form]', root);
    if (actionForm) {
      actionForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        jsonFetch('/api/owner/action-items/', { method: 'POST', body: JSON.stringify(formJson(actionForm)) })
          .then(function () { actionForm.reset(); setDashboardMessage(root, 'Action item assigned.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not assign action item.', 'error'); });
      });
    }
    root.addEventListener('click', function (evt) {
      var nav = evt.target.closest('[data-owner-nav-link]');
      if (nav) {
        evt.preventDefault();
        closeOwnerSidebar(root, true);
        var target = $(nav.getAttribute('href'), root);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.focus({ preventScroll: true });
          setOwnerActiveNav(root, nav.getAttribute('href'));
          if (history.pushState) history.pushState(null, '', nav.getAttribute('href'));
        }
        return;
      }
      if (evt.target.closest('[data-owner-sidebar-toggle]')) {
        evt.preventDefault();
        setOwnerSidebar(root, true);
        return;
      }
      if (evt.target.closest('[data-owner-sidebar-close]') || evt.target.closest('[data-owner-sidebar-backdrop]')) {
        evt.preventDefault();
        closeOwnerSidebar(root, true);
        return;
      }
      var jump = evt.target.closest('[data-owner-jump]');
      if (jump) {
        var hash = jump.getAttribute('data-owner-jump');
        var section = $(hash, root);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setOwnerActiveNav(root, hash);
          if (history.pushState) history.pushState(null, '', hash);
        }
        return;
      }
      var viewButton = evt.target.closest('[data-owner-calendar-view]');
      if (viewButton) {
        ownerUi.calendarView = viewButton.getAttribute('data-owner-calendar-view') || 'month';
        renderOwnerCalendar(root, root.__ownerState || { events: [] });
        return;
      }
      if (evt.target.closest('[data-owner-calendar-today]')) {
        ownerUi.calendarDate = new Date();
        renderOwnerCalendar(root, root.__ownerState || { events: [] });
        return;
      }
      if (evt.target.closest('[data-owner-calendar-prev]') || evt.target.closest('[data-owner-calendar-next]')) {
        var direction = evt.target.closest('[data-owner-calendar-prev]') ? -1 : 1;
        if (ownerUi.calendarView === 'month') ownerUi.calendarDate = addMonths(ownerUi.calendarDate, direction);
        else ownerUi.calendarDate = addDays(ownerUi.calendarDate, ownerUi.calendarView === 'day' ? direction : direction * 7);
        renderOwnerCalendar(root, root.__ownerState || { events: [] });
        return;
      }
      var eventButton = evt.target.closest('[data-owner-calendar-event]');
      if (eventButton) {
        ownerUi.selectedEventId = eventButton.getAttribute('data-owner-calendar-event');
        renderEventDetail(root, ownerUi.selectedEventId, root.__ownerState || { events: [] });
        return;
      }
      var filterButton = evt.target.closest('[data-owner-user-filter]');
      if (filterButton) {
        ownerUi.userFilter = filterButton.getAttribute('data-owner-user-filter') || 'all';
        renderOwnerUsers(root, root.__ownerState || { users: [] });
        return;
      }
      var openUser = evt.target.closest('[data-owner-open-user]');
      if (openUser) {
        ownerUi.selectedUserId = openUser.getAttribute('data-owner-open-user');
        renderStudentProfile(root, ownerUi.selectedUserId, root.__ownerState || {});
        var profile = $('[data-owner-student-profile]', root);
        if (profile) profile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      var connectCalendar = evt.target.closest('[data-google-calendar-connect]');
      if (connectCalendar) {
        jsonFetch('/api/owner/google-calendar/connect/', {
          method: 'POST',
          body: JSON.stringify({ returnTo: '/owner/#calendar' }),
        }).then(function (json) {
          if (json.authUrl) window.location.href = json.authUrl;
        }).catch(function (err) {
          setDashboardMessage(root, err.message || 'Could not connect Google Calendar.', 'error');
        });
        return;
      }
      var syncCalendar = evt.target.closest('[data-google-calendar-sync]');
      if (syncCalendar) {
        syncCalendar.disabled = true;
        jsonFetch('/api/owner/google-calendar/sync/', { method: 'POST', body: JSON.stringify({}) })
          .then(function (json) {
            setDashboardMessage(root, 'Google Calendar synced: ' + (json.pushed || 0) + ' pushed, ' + (json.imported || 0) + ' imported.', 'success');
            return loadOwner(root);
          })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not sync Google Calendar.', 'error'); })
          .finally(function () { syncCalendar.disabled = false; });
        return;
      }
      var deleteEvent = evt.target.closest('[data-owner-event-delete]');
      if (deleteEvent) {
        jsonFetch('/api/owner/calendar/', {
          method: 'DELETE',
          body: JSON.stringify({ id: deleteEvent.getAttribute('data-owner-event-delete') }),
        }).then(function () {
          ownerUi.selectedEventId = '';
          setDashboardMessage(root, 'Calendar event deleted.', 'success');
          return loadOwner(root);
        }).catch(function (err) {
          setDashboardMessage(root, err.message || 'Could not delete calendar event.', 'error');
        });
        return;
      }
      var app = evt.target.closest('[data-owner-application]');
      if (app) {
        jsonFetch('/api/owner/applications/', {
          method: 'PATCH',
          body: JSON.stringify({ id: app.getAttribute('data-owner-application'), status: app.getAttribute('data-status') }),
        }).then(function () { setDashboardMessage(root, 'Application updated.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not update application.', 'error'); });
        return;
      }
      var priv = evt.target.closest('[data-owner-private]');
      if (priv) {
        var id = priv.getAttribute('data-owner-private');
        var payload = {
          id: id,
          status: priv.getAttribute('data-status'),
          ownerResponse: ($('[data-private-response="' + id + '"]', root) || {}).value || '',
          confirmedStartAt: isoFromLocal(($('[data-private-start="' + id + '"]', root) || {}).value || ''),
          confirmedEndAt: isoFromLocal(($('[data-private-end="' + id + '"]', root) || {}).value || ''),
        };
        jsonFetch('/api/owner/private-requests/', { method: 'PATCH', body: JSON.stringify(payload) })
          .then(function () { setDashboardMessage(root, 'Private request updated.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not update private request.', 'error'); });
        return;
      }
      var comment = evt.target.closest('[data-owner-comment]');
      if (comment) {
        var entryId = comment.getAttribute('data-owner-comment');
        jsonFetch('/api/owner/journal-comments/', {
          method: 'POST',
          body: JSON.stringify({
            entryId: entryId,
            selectedText: ($('[data-comment-selected="' + entryId + '"]', root) || {}).value || '',
            comment: ($('[data-comment-body="' + entryId + '"]', root) || {}).value || '',
          }),
        }).then(function () { setDashboardMessage(root, 'Journal comment saved.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save comment.', 'error'); });
        return;
      }
      var action = evt.target.closest('[data-owner-action-from-entry]');
      if (action) {
        var sourceId = action.getAttribute('data-owner-action-from-entry');
        var userId = action.getAttribute('data-user-id');
        var selectedText = ($('[data-comment-selected="' + sourceId + '"]', root) || {}).value || 'Journal follow-up';
        jsonFetch('/api/owner/action-items/', {
          method: 'POST',
          body: JSON.stringify({ userId: userId, source: 'journal', sourceId: sourceId, title: selectedText, description: 'Follow up on this journal reflection.' }),
        }).then(function () { setDashboardMessage(root, 'Action item created.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not create action item.', 'error'); });
      }
    });
    root.addEventListener('submit', function (evt) {
      var editForm = evt.target.closest('[data-owner-event-edit]');
      if (!editForm) return;
      evt.preventDefault();
      var data = formJson(editForm);
      data.id = editForm.getAttribute('data-owner-event-edit');
      data.startAt = isoFromLocal(data.startAt);
      data.endAt = isoFromLocal(data.endAt);
      jsonFetch('/api/owner/calendar/', { method: 'PUT', body: JSON.stringify(data) })
        .then(function (json) {
          ownerUi.selectedEventId = json.event && json.event.id ? json.event.id : ownerUi.selectedEventId;
          setDashboardMessage(root, 'Calendar event saved.', 'success');
          return loadOwner(root);
        })
        .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save calendar event.', 'error'); });
    });
    var userSearch = $('[data-owner-user-search]', root);
    if (userSearch) {
      userSearch.addEventListener('input', function () {
        ownerUi.userSearch = userSearch.value || '';
        renderOwnerUsers(root, root.__ownerState || { users: [] });
      });
    }
    root.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') closeOwnerSidebar(root, true);
    });
    window.addEventListener('iyogau:auth-state-changed', function (evt) {
      if (evt.detail && evt.detail.reason === 'loading') return;
      loadOwner(root);
    });
    loadOwner(root);
  }

  function initOwnerSidebar(root) {
    closeOwnerSidebar(root, false);
    setOwnerActiveNav(root, window.location.hash || '#calendar');
  }

  function setOwnerSidebar(root, open) {
    var sidebar = $('[data-owner-sidebar]', root);
    var toggle = $('[data-owner-sidebar-toggle]', root);
    var backdrop = $('[data-owner-sidebar-backdrop]', root);
    if (!sidebar || !toggle) return;
    sidebar.classList.toggle('is-open', open);
    sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (backdrop) backdrop.hidden = !open;
    $all('a, button', sidebar).forEach(function (control) {
      control.tabIndex = open ? 0 : -1;
    });
  }

  function closeOwnerSidebar(root, focusToggle) {
    setOwnerSidebar(root, false);
    if (focusToggle) {
      var toggle = $('[data-owner-sidebar-toggle]', root);
      if (toggle) toggle.focus();
    }
  }

  function setOwnerActiveNav(root, href) {
    $all('[data-owner-nav-link]', root).forEach(function (link) {
      var active = link.getAttribute('href') === href;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    $all('[data-course-public]').forEach(initPublicCourses);
    $all('[data-course-dashboard]').forEach(initStudentDashboard);
    $all('[data-owner-dashboard]').forEach(initOwnerDashboard);
  });
}());
