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
    renderOwnerList($('[data-owner-course-list]', root), state.courses, function (course) {
      return course.title + ' - ' + courseMeta(course) + ' - ' + course.status;
    });
    renderOwnerList($('[data-owner-area-list]', root), state.coveredAreas, function (area) {
      return area.name + ' - ' + area.country + (area.active === false ? ' - inactive' : '');
    });
    renderApplications(root, state.applications);
    renderPrivateRequests(root, state.privateRequests);
    renderOwnerList($('[data-owner-calendar-list]', root), state.events, function (event) {
      return event.eventType + ' - ' + event.title + ' - ' + dateRange(event);
    });
    renderOwnerList($('[data-owner-user-list]', root), state.users, function (user) {
      return (user.email || user.id) + ' - apps ' + user.applications + ', journals ' + user.journals + ', actions ' + user.actionItems;
    });
    renderJournalReview(root, state.entries);
    renderOwnerList($('[data-owner-action-list]', root), state.actionItems, function (item) {
      return item.status + ' - ' + item.title + ' - ' + item.userId;
    });
  }

  function renderOwnerList(node, items, labeler) {
    if (!node) return;
    node.innerHTML = '';
    if (!items || !items.length) {
      node.appendChild(el('p', { class: 'course-muted' }, 'No records yet.'));
      return;
    }
    items.forEach(function (item) {
      var row = el('article', { class: 'course-row' });
      row.appendChild(el('p', null, labeler(item)));
      node.appendChild(row);
    });
  }

  function renderApplications(root, applications) {
    var node = $('[data-owner-application-list]', root);
    if (!node) return;
    node.innerHTML = '';
    if (!applications.length) {
      node.appendChild(el('p', { class: 'course-muted' }, 'No applications yet.'));
      return;
    }
    applications.forEach(function (app) {
      var row = el('article', { class: 'course-row' });
      row.appendChild(statusPill(app.status));
      row.appendChild(el('h3', null, (app.userEmail || app.userId) + ' - ' + (app.course ? app.course.title : 'Course')));
      row.appendChild(el('p', null, app.goals || app.notes || app.ownerNote || 'No notes.'));
      ['approved', 'waitlisted', 'rejected'].forEach(function (status) {
        row.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-application': app.id, 'data-status': status }, status));
      });
      node.appendChild(row);
    });
  }

  function renderPrivateRequests(root, requests) {
    var node = $('[data-owner-private-list]', root);
    if (!node) return;
    node.innerHTML = '';
    if (!requests.length) {
      node.appendChild(el('p', { class: 'course-muted' }, 'No private requests yet.'));
      return;
    }
    requests.forEach(function (request) {
      var row = el('article', { class: 'course-row' });
      row.appendChild(statusPill(request.status));
      row.appendChild(el('h3', null, (request.userEmail || request.userId) + ' - ' + request.groupSize + ' person private class'));
      row.appendChild(el('p', null, request.goals || request.preferredDates || request.notes || 'No notes.'));
      var response = el('input', { name: 'ownerResponse', placeholder: 'Owner response', 'data-private-response': request.id });
      var start = el('input', { name: 'confirmedStartAt', type: 'datetime-local', 'data-private-start': request.id });
      var end = el('input', { name: 'confirmedEndAt', type: 'datetime-local', 'data-private-end': request.id });
      row.appendChild(response);
      row.appendChild(start);
      row.appendChild(end);
      ['proposed', 'confirmed', 'rejected'].forEach(function (status) {
        row.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-private': request.id, 'data-status': status }, status));
      });
      node.appendChild(row);
    });
  }

  function renderJournalReview(root, entries) {
    var node = $('[data-owner-journal-list]', root);
    if (!node) return;
    node.innerHTML = '';
    if (!entries.length) {
      node.appendChild(el('p', { class: 'course-muted' }, 'No journal entries yet.'));
      return;
    }
    entries.forEach(function (entry) {
      var row = el('article', { class: 'course-row course-row--journal' });
      row.appendChild(el('h3', null, (entry.userEmail || entry.userId) + ' - ' + new Date(entry.createdAt).toLocaleDateString()));
      row.appendChild(el('p', null, entry.body));
      var selected = el('input', { placeholder: 'Selected sentence', 'data-comment-selected': entry.id });
      var comment = el('textarea', { placeholder: 'Owner comment', 'data-comment-body': entry.id });
      row.appendChild(selected);
      row.appendChild(comment);
      row.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-comment': entry.id }, 'Comment'));
      row.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', 'data-owner-action-from-entry': entry.id, 'data-user-id': entry.userId }, 'Create action item'));
      node.appendChild(row);
    });
  }

  function loadOwner(root) {
    var state = { owner: false, courses: [], coveredAreas: [], applications: [], privateRequests: [], events: [], users: [], entries: [], actionItems: [] };
    return Promise.all([
      jsonFetch('/api/owner/courses/'),
      jsonFetch('/api/owner/applications/'),
      jsonFetch('/api/owner/private-requests/'),
      jsonFetch('/api/owner/calendar/'),
      jsonFetch('/api/owner/users/'),
      jsonFetch('/api/owner/journal-comments/'),
      jsonFetch('/api/owner/action-items/'),
    ]).then(function (parts) {
      state.owner = true;
      state.courses = parts[0].courses || [];
      state.coveredAreas = parts[0].coveredAreas || [];
      state.applications = parts[1].applications || [];
      state.privateRequests = parts[2].privateRequests || [];
      state.events = parts[3].events || [];
      state.users = parts[4].users || [];
      state.entries = parts[5].entries || [];
      state.actionItems = parts[6].actionItems || [];
      renderOwner(root, state);
    }).catch(function (err) {
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
    var blockForm = $('[data-owner-block-form]', root);
    if (blockForm) {
      blockForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        var data = formJson(blockForm);
        data.startAt = isoFromLocal(data.startAt);
        data.endAt = isoFromLocal(data.endAt);
        jsonFetch('/api/owner/calendar/', { method: 'POST', body: JSON.stringify(data) })
          .then(function () { blockForm.reset(); setDashboardMessage(root, 'Blocked time saved.', 'success'); return loadOwner(root); })
          .catch(function (err) { setDashboardMessage(root, err.message || 'Could not save blocked time.', 'error'); });
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
    window.addEventListener('iyogau:auth-state-changed', function () { loadOwner(root); });
    loadOwner(root);
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
