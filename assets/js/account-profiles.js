/* =====================================================================
 *  account-profiles.js
 *  ---------------------------------------------------------------------
 *  Google-account session UI + saved birth-profile manager.
 *
 *  Birth data is only sent to /api/profiles after explicit save consent.
 *  Chart calculation still flows through the existing natal form and APIs.
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

  function dispatchFormEvents(node) {
    if (!node) return;
    try {
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {}
  }

  function jsonFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({
      accept: 'application/json',
    }, options.headers || {});
    if (options.body && !options.headers['content-type']) {
      options.headers['content-type'] = 'application/json';
    }
    return fetch(url, Object.assign({ credentials: 'same-origin' }, options))
      .then(function (response) {
        return response.text().then(function (text) {
          var json = {};
          if (text) {
            try { json = JSON.parse(text); } catch (e) {}
          }
          if (!response.ok) {
            var err = new Error((json && json.error) || 'Request failed.');
            err.status = response.status;
            throw err;
          }
          return json;
        });
      });
  }

  function init(root) {
    var loginControls = $all('[data-account-login]');
    var logoutControls = $all('[data-account-logout]');
    var status = $('[data-account-status]', root);
    var globalStatus = $('[data-account-global-status]');
    var body = $('[data-account-body]', root);
    var activeBoxes = $all('[data-active-profile]');
    var manageButtons = $all('[data-profile-manage]');
    var selfList = $('[data-profile-list-self]', root);
    var othersList = $('[data-profile-list-others]', root);
    var message = $('[data-profile-message]', root);
    var saveBtn = $('[data-profile-save]', root);
    var updateBtn = $('[data-profile-update]', root);
    var duplicateBtn = $('[data-profile-duplicate]', root);
    var deleteBtn = $('[data-profile-delete]', root);
    var exportBtn = $('[data-profile-export]', root);
    var consent = $('[data-profile-save-consent]', root);
    var displayNameInput = $('[data-profile-display-name]', root);
    var profileTypeInput = $('[data-profile-type]', root);
    var notesInput = $('[data-profile-notes]', root);

    var state = {
      user: null,
      profiles: [],
      activeId: null,
      autoLoadedSelf: false,
      authConfig: {
        googleConfigured: true,
        localDevAuthAvailable: false,
      },
    };

    function setMessage(text, kind) {
      if (!message) return;
      message.textContent = text || '';
      if (kind) message.setAttribute('data-state', kind);
      else message.removeAttribute('data-state');
    }

    function profileById(id) {
      for (var i = 0; i < state.profiles.length; i += 1) {
        if (state.profiles[i].id === id) return state.profiles[i];
      }
      return null;
    }

    function selfProfile() {
      for (var i = 0; i < state.profiles.length; i += 1) {
        if (state.profiles[i].profileType === 'self') return state.profiles[i];
      }
      return null;
    }

    function accountLabel(user) {
      if (!user) return '';
      return user.name ? user.name + ' (' + user.email + ')' : user.email;
    }

    function setControlsHidden(controls, hidden) {
      controls.forEach(function (control) {
        control.hidden = hidden;
      });
    }

    function setGlobalStatus(text, title) {
      if (!globalStatus) return;
      globalStatus.textContent = text || '';
      globalStatus.title = title || text || '';
    }

    function setLoginControlText(control, fullText, compactText) {
      control.textContent = control.hasAttribute('data-account-login-compact')
        ? compactText
        : fullText;
      control.title = fullText;
      control.setAttribute('aria-label', fullText);
    }

    function configureLoginControl() {
      if (!state.authConfig.googleConfigured && state.authConfig.localDevAuthAvailable) {
        loginControls.forEach(function (control) {
          setLoginControlText(control, 'Use local test account', 'Sign in');
          control.href = '#';
          control.removeAttribute('aria-disabled');
        });
        setGlobalStatus('Not signed in', 'Google Sign-In is not configured locally; use the local test account for development.');
        if (status && !state.user) {
          status.textContent = 'Google Sign-In needs OAuth environment variables. This local build uses a test account when you sign in from the header.';
        }
        return;
      }
      if (!state.authConfig.googleConfigured) {
        loginControls.forEach(function (control) {
          setLoginControlText(control, 'Google Sign-In unavailable', 'Unavailable');
          control.href = '#';
          control.setAttribute('aria-disabled', 'true');
        });
        setGlobalStatus('Auth unavailable', 'Google Sign-In is not configured on this server.');
        if (status && !state.user) {
          status.textContent = 'Google Sign-In is not configured. Add Google OAuth environment variables before using account profiles.';
        }
        return;
      }
      var returnTo = location.pathname + location.search + location.hash;
      loginControls.forEach(function (control) {
        setLoginControlText(control, 'Sign in with Google', 'Sign in');
        control.href = '/api/auth/google/start/?returnTo=' + encodeURIComponent(returnTo || '/#natal-calc');
        control.removeAttribute('aria-disabled');
      });
      setGlobalStatus('Not signed in', 'Not signed in');
      if (status && !state.user) {
        status.textContent = 'Sign in from the header to save your birth data and profiles for friends.';
      }
    }

    function setSignedOut() {
      state.user = null;
      state.profiles = [];
      state.activeId = null;
      setControlsHidden(loginControls, false);
      setControlsHidden(logoutControls, true);
      if (body) body.hidden = true;
      renderProfiles();
      configureLoginControl();
    }

    function setSignedIn(user) {
      state.user = user;
      setControlsHidden(loginControls, true);
      setControlsHidden(logoutControls, false);
      if (body) body.hidden = false;
      setGlobalStatus('Signed in: ' + (user.name || user.email), accountLabel(user));
      if (status) {
        status.textContent = 'Signed in as ' + accountLabel(user) + '. Select which birth profile the chart should use.';
      }
    }

    function currentTimezone() {
      var useOffset = document.getElementById('home-nf-tz-offset-enable');
      var sign = document.getElementById('home-nf-tz-offset-sign');
      var hours = document.getElementById('home-nf-tz-offset-hours');
      var mins = document.getElementById('home-nf-tz-offset-minutes');
      var tz = document.getElementById('home-nf-tz-select');
      if (useOffset && useOffset.checked && sign && hours && mins) {
        var s = sign.value === '-' ? '-' : '+';
        var h = String(Math.max(0, Math.min(14, parseInt(hours.value, 10) || 0))).padStart(2, '0');
        var m = String(Math.max(0, Math.min(59, parseInt(mins.value, 10) || 0))).padStart(2, '0');
        return s + h + ':' + m;
      }
      return tz ? tz.value : '';
    }

    function collectProfilePayload(overrides) {
      var nameEl = document.getElementById('home-nf-name');
      var dateEl = document.getElementById('home-nf-date');
      var timeEl = document.getElementById('home-nf-time');
      var unknownEl = document.getElementById('home-nf-time-unknown');
      var placeEl = document.getElementById('home-nf-place');
      var latEl = document.getElementById('home-nf-lat');
      var lonEl = document.getElementById('home-nf-lon');
      var display = (displayNameInput && displayNameInput.value.trim())
        || (nameEl && nameEl.value.trim())
        || 'My birth profile';
      var unknownTime = !!(unknownEl && unknownEl.checked);
      var payload = {
        profileType: profileTypeInput ? profileTypeInput.value : 'other',
        displayName: display,
        birthDate: dateEl ? dateEl.value : '',
        birthTime: unknownTime ? '12:00' : (timeEl ? timeEl.value : ''),
        unknownTime: unknownTime,
        birthplaceName: placeEl ? placeEl.value.trim() : '',
        lat: latEl ? Number(latEl.value) : NaN,
        lon: lonEl ? Number(lonEl.value) : NaN,
        timezone: currentTimezone(),
        notes: notesInput ? notesInput.value.trim() : '',
      };
      if (overrides) {
        Object.keys(overrides).forEach(function (key) { payload[key] = overrides[key]; });
      }
      return payload;
    }

    function setTimezoneOnForm(tz) {
      var useOffset = document.getElementById('home-nf-tz-offset-enable');
      var row = document.querySelector('#natal-calc .tz-offset-input-row');
      var sign = document.getElementById('home-nf-tz-offset-sign');
      var hours = document.getElementById('home-nf-tz-offset-hours');
      var mins = document.getElementById('home-nf-tz-offset-minutes');
      var select = document.getElementById('home-nf-tz-select');
      var match = /^([+-])(\d{1,2}):(\d{2})$/.exec(tz || '');
      if (match && useOffset && sign && hours && mins) {
        sign.value = match[1];
        hours.value = String(parseInt(match[2], 10));
        mins.value = match[3];
        useOffset.checked = true;
        if (row) row.hidden = false;
        if (select) select.disabled = true;
        dispatchFormEvents(useOffset);
        [sign, hours, mins].forEach(dispatchFormEvents);
        return;
      }
      if (useOffset) {
        useOffset.checked = false;
        if (row) row.hidden = true;
        dispatchFormEvents(useOffset);
      }
      if (select) {
        select.disabled = false;
        var found = false;
        for (var i = 0; i < select.options.length; i += 1) {
          if (select.options[i].value === tz) found = true;
        }
        if (!found && tz) select.appendChild(el('option', { value: tz }, tz));
        select.value = tz || select.value;
        dispatchFormEvents(select);
      }
    }

    function applyProfile(profile, reason) {
      var nameEl = document.getElementById('home-nf-name');
      var dateEl = document.getElementById('home-nf-date');
      var timeEl = document.getElementById('home-nf-time');
      var unknownEl = document.getElementById('home-nf-time-unknown');
      var placeEl = document.getElementById('home-nf-place');
      var latEl = document.getElementById('home-nf-lat');
      var lonEl = document.getElementById('home-nf-lon');
      var locDetail = document.getElementById('home-nf-loc-detail');

      if (dateEl) dateEl.value = profile.birthDate || '';
      if (timeEl) {
        timeEl.value = profile.birthTime || '12:00';
        timeEl.disabled = !!profile.unknownTime;
      }
      if (unknownEl) unknownEl.checked = !!profile.unknownTime;
      if (placeEl) {
        placeEl.value = profile.birthplaceName || '';
        placeEl.setAttribute('data-resolved', '1');
      }
      if (latEl) latEl.value = String(profile.lat);
      if (lonEl) lonEl.value = String(profile.lon);
      if (locDetail) locDetail.hidden = false;
      setTimezoneOnForm(profile.timezone);
      [dateEl, timeEl, unknownEl, placeEl, latEl, lonEl].forEach(dispatchFormEvents);
      if (nameEl) {
        nameEl.value = profile.displayName || '';
        dispatchFormEvents(nameEl);
      }

      state.activeId = profile.id;
      if (displayNameInput) displayNameInput.value = profile.displayName || '';
      if (profileTypeInput) profileTypeInput.value = profile.profileType || 'other';
      if (notesInput) notesInput.value = profile.notes || '';
      renderProfiles();
      setMessage(reason === 'auto'
        ? 'Loaded your saved My Profile into the chart form.'
        : 'Profile loaded into the chart form.', null);
    }

    function renderCard(profile) {
      var card = el('article', { class: 'natal-profile-card' + (profile.id === state.activeId ? ' is-active' : '') });
      var top = el('div', { class: 'natal-profile-card__top' });
      top.appendChild(el('h5', { class: 'natal-profile-card__name' }, profile.displayName));
      top.appendChild(el('span', { class: 'natal-profile-card__type' }, profile.profileType));
      card.appendChild(top);
      card.appendChild(el('p', { class: 'natal-profile-card__meta' },
        profile.birthDate + ' ' + profile.birthTime + ' · ' + profile.birthplaceName + ' · ' + profile.timezone));
      var actions = el('div', { class: 'natal-profile-card__actions' });
      var selectBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Select');
      selectBtn.addEventListener('click', function () { applyProfile(profile); });
      actions.appendChild(selectBtn);
      card.appendChild(actions);
      return card;
    }

    function renderProfiles() {
      var active = profileById(state.activeId);
      var activeText = active
        ? 'Active birth profile: ' + active.displayName + ' (' + active.profileType + ')'
        : 'Active birth profile: current form (not saved)';
      activeBoxes.forEach(function (box) {
        box.textContent = activeText;
      });
      [updateBtn, duplicateBtn, deleteBtn, exportBtn].forEach(function (btn) {
        if (btn) btn.disabled = !state.activeId;
      });
      if (!selfList || !othersList) return;
      selfList.textContent = '';
      othersList.textContent = '';
      var self = selfProfile();
      if (self) selfList.appendChild(renderCard(self));
      else selfList.appendChild(el('p', { class: 'natal-profile-empty' },
        'No saved My Profile yet. Fill the birth form, keep profile type as My Profile, then save.'));
      var others = state.profiles.filter(function (p) { return p.profileType !== 'self'; });
      if (!others.length) {
        othersList.appendChild(el('p', { class: 'natal-profile-empty' },
          'No friend or other profiles saved yet.'));
      } else {
        others.forEach(function (profile) { othersList.appendChild(renderCard(profile)); });
      }
    }

    function refreshProfiles(autoLoadSelf) {
      return jsonFetch('/api/profiles/')
        .then(function (json) {
          state.profiles = Array.isArray(json.profiles) ? json.profiles : [];
          renderProfiles();
          var self = selfProfile();
          if (autoLoadSelf && self && !state.autoLoadedSelf) {
            state.autoLoadedSelf = true;
            applyProfile(self, 'auto');
          } else if (autoLoadSelf && !self) {
            setMessage('Create your My Profile to make it load automatically after sign-in.', null);
          }
        });
    }

    function requireSaveConsent() {
      if (consent && consent.checked) return true;
      setMessage('Please confirm consent before saving birth data.', 'error');
      return false;
    }

    function saveProfile(updateExisting, duplicateExisting) {
      if (!requireSaveConsent()) return;
      var active = profileById(state.activeId);
      var payload = duplicateExisting && active
        ? Object.assign({}, active, {
            id: undefined,
            displayName: active.displayName + ' copy',
            profileType: active.profileType === 'self' ? 'other' : active.profileType,
          })
        : collectProfilePayload();
      var self = selfProfile();
      var target = updateExisting && active ? active : null;
      if (!target && !duplicateExisting && payload.profileType === 'self' && self) {
        target = self;
      }
      var method = target ? 'PUT' : 'POST';
      var bodyPayload = method === 'PUT' ? { id: target.id, profile: payload } : payload;
      jsonFetch('/api/profiles/', {
        method: method,
        body: JSON.stringify(bodyPayload),
      })
        .then(function (json) {
          setMessage(method === 'PUT' ? 'Profile updated.' : 'Profile saved.', null);
          if (consent) consent.checked = false;
          state.activeId = json.profile && json.profile.id ? json.profile.id : state.activeId;
          return refreshProfiles(false);
        })
        .then(function () {
          var saved = profileById(state.activeId);
          if (saved) applyProfile(saved);
        })
        .catch(function (err) {
          setMessage(err.message || 'Could not save profile.', 'error');
        });
    }

    function deleteActive() {
      var active = profileById(state.activeId);
      if (!active) return;
      if (!window.confirm('Delete "' + active.displayName + '" from your saved birth profiles?')) return;
      jsonFetch('/api/profiles/', {
        method: 'DELETE',
        body: JSON.stringify({ id: active.id }),
      })
        .then(function () {
          state.activeId = null;
          setMessage('Profile deleted.', null);
          return refreshProfiles(false);
        })
        .catch(function (err) { setMessage(err.message || 'Could not delete profile.', 'error'); });
    }

    function exportActive() {
      var active = profileById(state.activeId);
      if (!active) return;
      var blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'iyogau-profile-' + active.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    }

    function initSession() {
      setSignedOut();
      jsonFetch('/api/auth/config/')
        .then(function (json) {
          state.authConfig = {
            googleConfigured: !!json.googleConfigured,
            localDevAuthAvailable: !!json.localDevAuthAvailable,
          };
          configureLoginControl();
          return jsonFetch('/api/auth/session/');
        })
        .then(function (json) {
          if (!json.authenticated) return;
          setSignedIn(json.user);
          return refreshProfiles(true);
        })
        .catch(function () {
          setSignedOut();
        });
    }

    loginControls.forEach(function (control) {
      control.addEventListener('click', function (evt) {
        if (!state.authConfig.googleConfigured && state.authConfig.localDevAuthAvailable) {
          evt.preventDefault();
          jsonFetch('/api/auth/dev-login/', { method: 'POST', body: '{}' })
            .then(function () {
              state.autoLoadedSelf = false;
              return initSession();
            })
            .catch(function (err) { setMessage(err.message || 'Could not start local test account.', 'error'); });
          return;
        }
        if (!state.authConfig.googleConfigured) {
          evt.preventDefault();
          setMessage('Google Sign-In is not configured on this server.', 'error');
        }
      });
    });
    logoutControls.forEach(function (control) {
      control.addEventListener('click', function () {
        jsonFetch('/api/auth/logout/', { method: 'POST', body: '{}' })
          .then(function () {
            setSignedOut();
            setMessage('', null);
          })
          .catch(function (err) { setMessage(err.message || 'Could not sign out.', 'error'); });
      });
    });
    manageButtons.forEach(function (control) {
      control.addEventListener('click', function () {
        var tab = document.getElementById('home-tab-input');
        if (tab) tab.click();
        setTimeout(function () {
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      });
    });
    if (saveBtn) saveBtn.addEventListener('click', function () { saveProfile(false, false); });
    if (updateBtn) updateBtn.addEventListener('click', function () { saveProfile(true, false); });
    if (duplicateBtn) duplicateBtn.addEventListener('click', function () { saveProfile(false, true); });
    if (deleteBtn) deleteBtn.addEventListener('click', deleteActive);
    if (exportBtn) exportBtn.addEventListener('click', exportActive);

    initSession();
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    $all('[data-account-profiles]').forEach(init);
  });
}());
