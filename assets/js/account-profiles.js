/* =====================================================================
 *  account-profiles.js
 *  ---------------------------------------------------------------------
 *  Google-account session UI + saved birth-profile manager.
 *
 *  Birth data is only sent to /api/profiles from explicit save/update actions.
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

  function dispatchChange(node) {
    if (!node) return;
    try {
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
    var loginActionControls = loginControls.filter(function (control) {
      return control.hasAttribute('data-account-login-action');
    });
    var loginChromeControls = loginControls.filter(function (control) {
      return !control.hasAttribute('data-account-login-action');
    });
    var logoutControls = $all('[data-account-logout]');
    var status = $('[data-account-status]', root);
    var globalStatus = $('[data-account-global-status]');
    var accountShell = $('[data-account-menu-shell]');
    var accountToggle = $('[data-account-menu-toggle]');
    var accountMenu = $('[data-account-menu]');
    var providerMenu = $('[data-account-provider-menu]');
    var accountAvatar = $('[data-account-avatar]');
    var accountNameEls = $all('[data-account-menu-name]');
    var accountEmailEls = $all('[data-account-menu-email]');
    var accountMenuLinks = $all('[data-account-menu-link]');
    var exportAllBtns = $all('[data-account-export-all]');
    var deleteAllBtns = $all('[data-account-delete-all]');
    var body = $('[data-account-body]', root);
    var activeBoxes = $all('[data-active-profile]');
    var manageButtons = $all('[data-profile-manage]');
    var allList = $('[data-profile-list-all]', root);
    var selfList = $('[data-profile-list-self]', root);
    var othersList = $('[data-profile-list-others]', root);
    var profileSearch = $('[data-profile-search]', root);
    var message = $('[data-profile-message]', root);
    var saveBtn = $('[data-profile-save]', root);
    var updateBtn = $('[data-profile-update]', root);
    var deleteBtn = $('[data-profile-delete]', root);
    var exportBtn = $('[data-profile-export]', root);
    var newBtn = $('[data-profile-new]', root);
    var displayNameInput = $('[data-profile-display-name]', root);
    var profileTypeInput = $('[data-profile-type]', root);
    var selfToggle = $('[data-profile-self]', root);
    var notesInput = $('[data-profile-notes]', root);
    var headerOnly = root.hasAttribute('data-account-header-only');

    var state = {
      user: null,
      profiles: [],
      activeId: null,
      autoLoadedSelf: false,
      pendingDefaultId: null,
      authConfig: {
        googleConfigured: false,
        localDevAuthAvailable: false,
        providers: [],
        passwordAuthAvailable: false,
        loading: true,
      },
    };

    var signInDialog = null;
    var signInDialogMode = 'login';
    var signInLastFocus = null;

    function setMessage(text, kind) {
      if (!message) return;
      message.textContent = text || '';
      if (kind) message.setAttribute('data-state', kind);
      else message.removeAttribute('data-state');
      message.hidden = !text;
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

    function isSelfChecked() {
      if (selfToggle) return !!selfToggle.checked;
      return !!(profileTypeInput && profileTypeInput.value === 'self');
    }

    function syncProfileTypeControl() {
      if (profileTypeInput) profileTypeInput.value = isSelfChecked() ? 'self' : (profileTypeInput.value === 'friend' ? 'friend' : 'other');
    }

    function accountLabel(user) {
      if (!user) return '';
      return user.name ? user.name + ' (' + user.email + ')' : user.email;
    }

    function accountInitials(user) {
      var source = (user && (user.name || user.email)) || 'Account';
      var parts = source.replace(/@.*$/, '').split(/\s+|[._-]+/).filter(Boolean);
      var initials = parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
      return initials || 'AC';
    }

    function activeLang() {
      var html = document.documentElement.getAttribute('lang') || 'en';
      if (html.indexOf('ko') === 0) return 'ko';
      if (html.indexOf('zh') === 0) return 'zh';
      return 'en';
    }

    function i18nText(key, fallback) {
      var dict = window.I18N && window.I18N[activeLang()];
      return (dict && typeof dict[key] === 'string') ? dict[key] : fallback;
    }

    function setMenuOpen(open) {
      if (!accountToggle || !accountMenu) return;
      accountToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      accountMenu.hidden = !open;
    }

    function closeMenu() {
      setMenuOpen(false);
    }

    function setProviderMenuOpen(open) {
      if (!providerMenu) return;
      providerMenu.hidden = !open;
      loginControls.forEach(function (control) {
        control.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    function closeProviderMenu() {
      setProviderMenuOpen(false);
    }

    function configuredProviders() {
      return (state.authConfig.providers || []).filter(function (provider) {
        return provider && provider.configured;
      });
    }

    function providerStartUrl(provider) {
      var returnTo = location.pathname + location.search + location.hash;
      var base = provider && provider.startUrl ? provider.startUrl : '/api/auth/google/start/';
      return base + '?returnTo=' + encodeURIComponent(returnTo || '/#natal-calc');
    }

    function renderProviderMenu(providers) {
      if (!providerMenu) return;
      providerMenu.innerHTML = '';
      providers.forEach(function (provider) {
        var link = el('a', { href: providerStartUrl(provider), role: 'menuitem' }, 'Continue with ' + provider.label);
        providerMenu.appendChild(link);
      });
      providerMenu.hidden = true;
    }

    function authAvailable() {
      return configuredProviders().length > 0 || !!state.authConfig.passwordAuthAvailable;
    }

    function ensureSignInDialog() {
      if (signInDialog) return signInDialog;
      var overlay = el('div', { class: 'site-auth-modal', 'data-auth-modal': '', hidden: '' });
      overlay.innerHTML = [
        '<div class="site-auth-modal__panel" role="dialog" aria-modal="true" aria-labelledby="site-auth-title">',
        '  <button class="site-auth-modal__close" type="button" data-auth-close aria-label="Close sign-in panel">&times;</button>',
        '  <h2 id="site-auth-title">Sign in</h2>',
        '  <p class="site-auth-modal__intro">Choose a secure sign-in method for saved birth profiles and private chart work.</p>',
        '  <div class="site-auth-modal__providers" data-auth-provider-list></div>',
        '  <div class="site-auth-modal__divider"><span>or use email</span></div>',
        '  <div class="site-auth-modal__tabs" role="tablist" aria-label="Email account mode">',
        '    <button type="button" role="tab" aria-selected="true" data-auth-mode="login" class="is-active">Sign in</button>',
        '    <button type="button" role="tab" aria-selected="false" data-auth-mode="signup">Create account</button>',
        '  </div>',
        '  <form class="site-auth-form" data-auth-password-form novalidate>',
        '    <label data-auth-name-wrap hidden>Name<input name="name" type="text" autocomplete="name" maxlength="80" /></label>',
        '    <label>Email<input name="email" type="email" autocomplete="email" required /></label>',
        '    <label>Password<input name="password" type="password" autocomplete="current-password" minlength="10" required /></label>',
        '    <label class="site-auth-form__inline"><input type="checkbox" data-auth-show-password /> Show password</label>',
        '    <button type="submit" class="btn btn-primary" data-auth-submit>Sign in</button>',
        '  </form>',
        '  <p class="site-auth-modal__note">Use a password with at least 10 characters. Birth data remains tied only to this signed-in account.</p>',
        '  <p class="site-auth-modal__message" data-auth-message role="status" hidden></p>',
        '</div>',
      ].join('');
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (evt) {
        if (evt.target === overlay) closeSignInDialog();
      });
      overlay.addEventListener('keydown', handleSignInDialogKeydown);
      $('[data-auth-close]', overlay).addEventListener('click', closeSignInDialog);
      $all('[data-auth-mode]', overlay).forEach(function (btn) {
        btn.addEventListener('click', function () {
          setSignInDialogMode(btn.getAttribute('data-auth-mode') || 'login');
        });
      });
      $('[data-auth-password-form]', overlay).addEventListener('submit', submitPasswordAuth);
      $('[data-auth-show-password]', overlay).addEventListener('change', function (evt) {
        var password = $('[name="password"]', overlay);
        if (password) password.type = evt.currentTarget.checked ? 'text' : 'password';
      });
      signInDialog = overlay;
      return signInDialog;
    }

    function setSignInDialogMode(mode) {
      signInDialogMode = mode === 'signup' ? 'signup' : 'login';
      var dialog = ensureSignInDialog();
      $all('[data-auth-mode]', dialog).forEach(function (btn) {
        var selected = btn.getAttribute('data-auth-mode') === signInDialogMode;
        btn.classList.toggle('is-active', selected);
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.setAttribute('tabindex', selected ? '0' : '-1');
      });
      var nameWrap = $('[data-auth-name-wrap]', dialog);
      var password = $('[name="password"]', dialog);
      var submit = $('[data-auth-submit]', dialog);
      if (nameWrap) nameWrap.hidden = signInDialogMode !== 'signup';
      if (password) password.autocomplete = signInDialogMode === 'signup' ? 'new-password' : 'current-password';
      if (submit) submit.textContent = signInDialogMode === 'signup' ? 'Create account' : 'Sign in';
      setAuthDialogMessage('');
    }

    function renderSignInDialog() {
      var dialog = ensureSignInDialog();
      var providerList = $('[data-auth-provider-list]', dialog);
      var providers = configuredProviders();
      providerList.innerHTML = '';
      if (providers.length) {
        providers.forEach(function (provider) {
          var link = el('a', { href: providerStartUrl(provider), class: 'site-auth-provider', role: 'menuitem' }, 'Sign in with ' + provider.label);
          providerList.appendChild(link);
        });
      } else {
        providerList.appendChild(el('p', { class: 'site-auth-modal__empty' }, 'No social sign-in provider is configured on this server.'));
      }
      var passwordForm = $('[data-auth-password-form]', dialog);
      if (passwordForm) passwordForm.hidden = !state.authConfig.passwordAuthAvailable;
      var divider = $('.site-auth-modal__divider', dialog);
      var tabs = $('.site-auth-modal__tabs', dialog);
      if (divider) divider.hidden = !state.authConfig.passwordAuthAvailable;
      if (tabs) tabs.hidden = !state.authConfig.passwordAuthAvailable;
      setSignInDialogMode(signInDialogMode);
    }

    function openSignInDialog() {
      renderSignInDialog();
      var dialog = ensureSignInDialog();
      signInLastFocus = document.activeElement;
      dialog.hidden = false;
      loginControls.forEach(function (control) { control.setAttribute('aria-expanded', 'true'); });
      closeMenu();
      closeProviderMenu();
      focusFirstDialogControl(dialog);
    }

    function closeSignInDialog() {
      if (signInDialog) signInDialog.hidden = true;
      loginControls.forEach(function (control) { control.setAttribute('aria-expanded', 'false'); });
      if (signInLastFocus && typeof signInLastFocus.focus === 'function') {
        try { signInLastFocus.focus(); } catch (err) {}
      }
      signInLastFocus = null;
    }

    function dialogFocusables(dialog) {
      return $all('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog)
        .filter(function (node) {
          return !node.hidden && node.offsetParent !== null;
        });
    }

    function focusFirstDialogControl(dialog) {
      var focusables = dialogFocusables(dialog);
      if (focusables[0]) focusables[0].focus();
    }

    function handleSignInDialogKeydown(evt) {
      if (evt.key === 'Escape') {
        closeSignInDialog();
        return;
      }
      if (evt.key !== 'Tab') return;
      var focusables = dialogFocusables(evt.currentTarget);
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (evt.shiftKey && document.activeElement === first) {
        evt.preventDefault();
        last.focus();
      } else if (!evt.shiftKey && document.activeElement === last) {
        evt.preventDefault();
        first.focus();
      }
    }

    function setAuthDialogMessage(text, kind) {
      var dialog = ensureSignInDialog();
      var node = $('[data-auth-message]', dialog);
      if (!node) return;
      node.textContent = text || '';
      node.hidden = !text;
      if (kind) node.setAttribute('data-state', kind);
      else node.removeAttribute('data-state');
    }

    function submitPasswordAuth(evt) {
      evt.preventDefault();
      var form = evt.currentTarget;
      var fields = form.elements;
      var payload = {
        email: fields.email.value,
        password: fields.password.value,
      };
      if (signInDialogMode === 'signup') payload.name = fields.name.value;
      setAuthDialogMessage(signInDialogMode === 'signup' ? 'Creating account...' : 'Signing in...');
      jsonFetch('/api/auth/password/' + (signInDialogMode === 'signup' ? 'signup' : 'login') + '/', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
        .then(function () {
          closeSignInDialog();
          state.autoLoadedSelf = false;
          return initSession();
        })
        .catch(function (err) {
          setAuthDialogMessage(err.message || 'Could not sign in.', 'error');
        });
    }

    function setAccountIdentity(user) {
      var name = user && user.name ? user.name : 'Account';
      var email = user && user.email ? user.email : '';
      accountNameEls.forEach(function (node) { node.textContent = name; });
      accountEmailEls.forEach(function (node) { node.textContent = email; });
      if (accountAvatar) accountAvatar.textContent = accountInitials(user);
      if (accountToggle) accountToggle.setAttribute('aria-label', 'Account menu for ' + accountLabel(user));
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

    function broadcastProfilesUpdated() {
      try {
        window.dispatchEvent(new CustomEvent('iyogau:profiles-updated', {
          detail: { profiles: state.profiles.slice(), authenticated: !!state.user },
        }));
      } catch (err) {}
    }

    function broadcastAuthState(authenticated, reason) {
      try {
        window.dispatchEvent(new CustomEvent('iyogau:auth-state-changed', {
          detail: {
            authenticated: !!authenticated,
            reason: reason || (authenticated ? 'signed-in' : 'signed-out'),
          },
        }));
      } catch (err) {}
    }

    function setLoginControlText(control, fullText, compactText) {
      if (!control.getAttribute('data-account-login-initial-text')) {
        control.setAttribute('data-account-login-initial-text', control.textContent.trim());
      }
      var preserveActionLabel = control.hasAttribute('data-account-login-action') && fullText === 'Choose sign-in method';
      var text = preserveActionLabel
        ? (control.getAttribute('data-account-login-initial-text') || fullText)
        : (control.hasAttribute('data-account-login-compact')
        ? compactText
        : fullText);
      control.textContent = text;
      control.title = preserveActionLabel ? text : fullText;
      control.setAttribute('aria-label', text);
    }

    function configureSignedInActionControls() {
      loginActionControls.forEach(function (control) {
        control.hidden = false;
        control.href = '/natal-chart/#natal-calc';
        control.removeAttribute('aria-disabled');
        control.removeAttribute('aria-haspopup');
        control.setAttribute('aria-expanded', 'false');
        control.textContent = i18nText('natal.public.ctaWorkspace', 'Open astrology workspace');
        control.title = i18nText('natal.public.ctaWorkspace', 'Open astrology workspace');
        control.setAttribute('aria-label', i18nText('natal.public.ctaWorkspace', 'Open astrology workspace'));
      });
    }

    function configureLoginControl() {
      var providers = configuredProviders();
      if (state.authConfig.loading) {
        loginControls.forEach(function (control) {
          setLoginControlText(control, 'Checking sign-in availability', 'Checking...');
          control.href = '#';
          control.setAttribute('aria-disabled', 'true');
          control.removeAttribute('aria-haspopup');
          control.setAttribute('aria-expanded', 'false');
        });
        renderProviderMenu([]);
        setGlobalStatus('Checking sign-in', 'Checking sign-in availability.');
        if (status && !state.user) {
          status.textContent = 'Checking sign-in availability...';
        }
        return;
      }
      if (!state.authConfig.googleConfigured && state.authConfig.localDevAuthAvailable) {
        loginControls.forEach(function (control) {
          setLoginControlText(control, 'Use development test account', 'Dev sign in');
          control.href = '#';
          control.removeAttribute('aria-disabled');
          control.removeAttribute('aria-haspopup');
          control.setAttribute('aria-expanded', 'false');
        });
        renderProviderMenu([]);
        setGlobalStatus('Not signed in', 'Google Sign-In is not configured locally; use the local test account for development.');
        if (status && !state.user) {
          status.textContent = 'Google Sign-In needs OAuth environment variables. This local build uses a test account when you sign in from the header.';
        }
        return;
      }
      if (!authAvailable()) {
        loginControls.forEach(function (control) {
          setLoginControlText(control, 'Sign-In unavailable', 'Unavailable');
          control.href = '#';
          control.setAttribute('aria-disabled', 'true');
          control.removeAttribute('aria-haspopup');
          control.setAttribute('aria-expanded', 'false');
        });
        renderProviderMenu([]);
        setGlobalStatus('Auth unavailable', 'No sign-in provider is configured on this server.');
        if (status && !state.user) {
          status.textContent = 'Sign-In is not configured. Add OAuth environment variables before using account profiles.';
        }
        return;
      }
      renderProviderMenu(providers);
      loginControls.forEach(function (control) {
        setLoginControlText(control, 'Choose sign-in method', 'Sign in');
        control.href = '#';
        control.setAttribute('aria-haspopup', 'dialog');
        control.setAttribute('aria-expanded', 'false');
        control.removeAttribute('aria-disabled');
      });
      setGlobalStatus('Not signed in', 'Not signed in');
      if (status && !state.user) {
        status.textContent = 'Sign in from the header to save your birth data and profiles for friends.';
      }
    }

    function setSignedOut(options) {
      options = options || {};
      state.user = null;
      state.profiles = [];
      state.activeId = null;
      setControlsHidden(loginControls, false);
      setControlsHidden(logoutControls, true);
      if (accountShell) accountShell.hidden = true;
      closeMenu();
      closeProviderMenu();
      if (body) body.hidden = true;
      renderProfiles();
      configureLoginControl();
      if (options.broadcast !== false) {
        broadcastProfilesUpdated();
        broadcastAuthState(false, options.reason || 'signed-out');
      }
    }

    function setSignedIn(user, options) {
      options = options || {};
      state.user = user;
      setControlsHidden(loginChromeControls, true);
      configureSignedInActionControls();
      setControlsHidden(logoutControls, false);
      if (accountShell) accountShell.hidden = false;
      closeProviderMenu();
      setAccountIdentity(user);
      closeMenu();
      if (body) body.hidden = false;
      setGlobalStatus('Signed in: ' + (user.name || user.email), accountLabel(user));
      if (status) {
        status.textContent = 'Signed in as ' + accountLabel(user) + '. Select which birth profile the chart should use.';
      }
      if (options.broadcast !== false) {
        broadcastAuthState(true, options.reason || 'signed-in');
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

    function isUsableCoordinatePair(lat, lon) {
      return Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -66.563 &&
        lat <= 66.563 &&
        lon >= -180 &&
        lon <= 180 &&
        !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001);
    }

    function unresolvedCoordinateMessage() {
      return 'This saved profile has unresolved coordinates. Select a birthplace or enter accurate latitude/longitude before calculating.';
    }

    function profilePayloadProblem(payload) {
      if (!payload.displayName) return 'Enter a profile name before saving.';
      if (!payload.birthDate) return 'Enter a birth date before saving.';
      if (!payload.unknownTime && !payload.birthTime) return 'Enter a birth time or mark it unknown before saving.';
      if (!payload.birthplaceName) return 'Select a birthplace before saving.';
      if (!isUsableCoordinatePair(payload.lat, payload.lon)) {
        return 'Select a resolved birthplace or enter accurate latitude/longitude before saving.';
      }
      if (!payload.timezone) return 'Select a timezone or UTC offset before saving.';
      return '';
    }

    function storedProfilePayload(profile, overrides) {
      var payload = {
        profileType: profile.profileType || 'other',
        displayName: profile.displayName || '',
        birthDate: profile.birthDate || '',
        birthTime: profile.unknownTime ? '12:00' : (profile.birthTime || ''),
        unknownTime: !!profile.unknownTime,
        birthplaceName: profile.birthplaceName || '',
        lat: Number(profile.lat),
        lon: Number(profile.lon),
        timezone: profile.timezone || '',
        notes: profile.notes || '',
      };
      if (overrides) {
        Object.keys(overrides).forEach(function (key) { payload[key] = overrides[key]; });
      }
      return payload;
    }

    function shouldAnimateProfileList() {
      if (typeof window === 'undefined') return false;
      if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      return typeof window.setTimeout === 'function';
    }

    function scheduleProfileListAnimation(fn) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(fn);
        });
        return;
      }
      window.setTimeout(fn, 32);
    }

    function captureProfileCardPositions(list) {
      if (!list || !shouldAnimateProfileList()) return null;
      var positions = {};
      $all('[data-profile-card-id]', list).forEach(function (card) {
        positions[card.getAttribute('data-profile-card-id')] = card.getBoundingClientRect();
      });
      return positions;
    }

    function animateProfileCardPositions(list, previousPositions) {
      if (!list || !previousPositions || !shouldAnimateProfileList()) return;
      $all('[data-profile-card-id]', list).forEach(function (card) {
        var previous = previousPositions[card.getAttribute('data-profile-card-id')];
        if (!previous) return;
        var current = card.getBoundingClientRect();
        var deltaX = previous.left - current.left;
        var deltaY = previous.top - current.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
        card.classList.add('is-reordering');
        card.style.transition = 'none';
        card.style.transform = 'translate(' + deltaX + 'px, ' + deltaY + 'px)';
        card.getBoundingClientRect();
        var cleaned = false;
        function cleanup() {
          if (cleaned) return;
          cleaned = true;
          card.style.transition = '';
          card.style.transform = '';
          card.classList.remove('is-reordering');
        }
        card.addEventListener('transitionend', cleanup, { once: true });
        window.setTimeout(cleanup, 420);
        scheduleProfileListAnimation(function () {
          card.style.transition = 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';
          card.style.transform = 'translate(0, 0)';
        });
      });
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
      var active = profileById(state.activeId);
      var nonSelfType = active && active.profileType !== 'self' ? active.profileType : 'other';
      var profileType = isSelfChecked() ? 'self' : nonSelfType;
      if (profileTypeInput) profileTypeInput.value = profileType;
      var payload = {
        profileType: profileType,
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
      [dateEl, timeEl, unknownEl, latEl, lonEl].forEach(dispatchFormEvents);
      dispatchChange(placeEl);
      if (nameEl) {
        nameEl.value = profile.displayName || '';
        dispatchFormEvents(nameEl);
      }

      state.activeId = profile.id;
      if (displayNameInput) displayNameInput.value = profile.displayName || '';
      if (profileTypeInput) profileTypeInput.value = profile.profileType || 'other';
      if (selfToggle) selfToggle.checked = profile.profileType === 'self';
      if (notesInput) notesInput.value = profile.notes || '';
      renderProfiles();
      if (!isUsableCoordinatePair(Number(profile.lat), Number(profile.lon))) {
        setMessage(unresolvedCoordinateMessage(), 'error');
      } else {
        setMessage('', null);
      }
    }

    function setDefaultProfile(profile) {
      if (!profile) return;
      if (state.pendingDefaultId) return;
      if (profile.profileType === 'self') {
        setMessage(profile.displayName + ' is already the default profile.', null);
        return;
      }
      if (!isUsableCoordinatePair(Number(profile.lat), Number(profile.lon))) {
        setMessage('Fix this profile coordinates before making it the default chart.', 'error');
        renderProfiles();
        return;
      }
      state.pendingDefaultId = profile.id;
      setMessage('Updating default profile...', null);
      jsonFetch('/api/profiles/', {
        method: 'PUT',
        body: JSON.stringify({
          id: profile.id,
          profile: storedProfilePayload(profile, { profileType: 'self' }),
        }),
      })
        .then(function (json) {
          state.activeId = json.profile && json.profile.id ? json.profile.id : profile.id;
          return refreshProfiles(false);
        })
        .then(function () {
          var saved = profileById(state.activeId);
          if (saved) applyProfile(saved);
          setMessage('Default profile updated to ' + (saved ? saved.displayName : profile.displayName) + '.', null);
        })
        .catch(function (err) {
          setMessage(err.message || 'Could not update default profile.', 'error');
          renderProfiles();
        })
        .then(function () {
          state.pendingDefaultId = null;
          renderProfiles();
        });
    }

    function renderCard(profile) {
      var isSelf = profile.profileType === 'self';
      var hasUsableCoordinates = isUsableCoordinatePair(Number(profile.lat), Number(profile.lon));
      var card = el('article', {
        class: 'natal-profile-card' + (profile.id === state.activeId ? ' is-active' : ''),
        role: 'button',
        tabindex: '0',
        'data-profile-card-id': profile.id,
        'aria-pressed': profile.id === state.activeId ? 'true' : 'false',
      });
      card.addEventListener('click', function (evt) {
        if (evt.target && evt.target.closest && evt.target.closest('button, a, input, label')) return;
        applyProfile(profile);
      });
      card.addEventListener('keydown', function (evt) {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        applyProfile(profile);
      });
      var top = el('div', { class: 'natal-profile-card__top' });
      var title = el('div', { class: 'natal-profile-card__title' });
      title.appendChild(el('h5', { class: 'natal-profile-card__name' }, profile.displayName));
      title.appendChild(el('span', { class: 'natal-profile-card__type' }, isSelf ? 'Default profile' : 'Saved person'));
      top.appendChild(title);
      var status = el('div', { class: 'natal-profile-card__status' });
      if (profile.id === state.activeId) status.appendChild(el('span', { class: 'natal-profile-card__active' }, 'Active'));
      var defaultLabel = el('label', {
        class: 'natal-profile-card__default' + (isSelf ? ' is-default' : '') + (!hasUsableCoordinates ? ' is-disabled' : ''),
        title: hasUsableCoordinates ? 'Make default chart' : 'Fix coordinates before making this default',
      });
      var defaultRadio = el('input', {
        type: 'radio',
        name: 'iyogau-default-profile',
        value: profile.id,
        'data-profile-default-radio': profile.id,
        'aria-label': 'Make ' + profile.displayName + ' the default profile',
      });
      defaultRadio.checked = isSelf;
      defaultRadio.disabled = !hasUsableCoordinates || !!state.pendingDefaultId;
      defaultRadio.addEventListener('click', function (evt) {
        evt.stopPropagation();
      });
      defaultRadio.addEventListener('change', function (evt) {
        evt.stopPropagation();
        if (defaultRadio.checked) setDefaultProfile(profile);
      });
      defaultLabel.addEventListener('click', function (evt) {
        evt.stopPropagation();
        if (!hasUsableCoordinates) {
          evt.preventDefault();
          setMessage('Fix this profile coordinates before making it the default chart.', 'error');
          return;
        }
        if (isSelf) {
          evt.preventDefault();
          setMessage(profile.displayName + ' is already the default profile.', null);
          return;
        }
        evt.preventDefault();
        defaultRadio.checked = true;
        setDefaultProfile(profile);
      });
      defaultLabel.addEventListener('keydown', function (evt) {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        if (!hasUsableCoordinates || isSelf) {
          evt.preventDefault();
          if (!hasUsableCoordinates) {
            setMessage('Fix this profile coordinates before making it the default chart.', 'error');
          } else {
            setMessage(profile.displayName + ' is already the default profile.', null);
          }
          return;
        }
        evt.preventDefault();
        defaultRadio.checked = true;
        setDefaultProfile(profile);
      });
      defaultLabel.appendChild(defaultRadio);
      defaultLabel.appendChild(el('span', null, isSelf ? 'Default' : 'Set default'));
      status.appendChild(defaultLabel);
      top.appendChild(status);
      card.appendChild(top);
      card.appendChild(el('p', { class: 'natal-profile-card__meta' },
        profile.birthDate + ' · ' + (profile.unknownTime ? 'Unknown time' : profile.birthTime) + ' · ' + profile.birthplaceName + ' · ' + profile.timezone));
      return card;
    }

    function renderProfiles() {
      var active = profileById(state.activeId);
      var activeText = active
        ? 'Active: ' + active.displayName + (active.profileType === 'self' ? ' · default profile' : '')
        : 'Active: current form, not saved';
      activeBoxes.forEach(function (box) {
        box.textContent = activeText;
      });
      [exportAllBtns, deleteAllBtns].forEach(function (controls) {
        controls.forEach(function (btn) {
          btn.disabled = !state.profiles.length;
        });
      });
      [updateBtn, deleteBtn, exportBtn].forEach(function (btn) {
        if (btn) btn.disabled = !state.activeId;
      });
      if (allList) {
        var previousPositions = captureProfileCardPositions(allList);
        var query = profileSearch ? profileSearch.value.trim().toLowerCase() : '';
        var visibleProfiles = state.profiles.filter(function (profile) {
          if (!query) return true;
          return [
            profile.displayName,
            profile.birthplaceName,
            profile.birthDate,
            profile.timezone,
          ].join(' ').toLowerCase().indexOf(query) !== -1;
        });
        allList.textContent = '';
        if (!state.profiles.length) {
          var empty = el('div', { class: 'natal-profile-empty natal-profile-empty--action' });
          empty.appendChild(el('strong', null, 'No saved profiles yet'));
          empty.appendChild(el('span', null, 'Enter birth details in this form, then save the first profile.'));
          var startBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Use this form');
          startBtn.addEventListener('click', startNewDraft);
          empty.appendChild(startBtn);
          allList.appendChild(empty);
        } else if (!visibleProfiles.length) {
          allList.appendChild(el('p', { class: 'natal-profile-empty' },
            'No profiles match this search.'));
        } else {
          visibleProfiles.forEach(function (profile) { allList.appendChild(renderCard(profile)); });
        }
        animateProfileCardPositions(allList, previousPositions);
      }
      if (selfList && othersList) {
        selfList.textContent = '';
        othersList.textContent = '';
        var self = selfProfile();
        if (self) selfList.appendChild(renderCard(self));
        else selfList.appendChild(el('p', { class: 'natal-profile-empty' },
          'No saved My Profile yet. Fill the birth form, mark it as your profile, then save.'));
        var others = state.profiles.filter(function (p) { return p.profileType !== 'self'; });
        if (!others.length) {
          othersList.appendChild(el('p', { class: 'natal-profile-empty' },
            'No additional profiles saved yet.'));
        } else {
          others.forEach(function (profile) { othersList.appendChild(renderCard(profile)); });
        }
      }
    }

    function refreshProfiles(autoLoadSelf) {
      return jsonFetch('/api/profiles/')
        .then(function (json) {
          state.profiles = Array.isArray(json.profiles) ? json.profiles : [];
          renderProfiles();
          broadcastProfilesUpdated();
          var self = selfProfile();
          if (!headerOnly && autoLoadSelf && self && !state.autoLoadedSelf) {
            state.autoLoadedSelf = true;
            applyProfile(self, 'auto');
          } else if (!headerOnly && autoLoadSelf && !self) {
            setMessage('Create your My Profile to make it load automatically after sign-in.', null);
          }
        });
    }

    function deleteProfile(profile) {
      if (!profile) return;
      if (!window.confirm('Delete "' + profile.displayName + '" from your saved birth profiles?')) return;
      jsonFetch('/api/profiles/', {
        method: 'DELETE',
        body: JSON.stringify({ id: profile.id }),
      })
        .then(function () {
          if (state.activeId === profile.id) state.activeId = null;
          setMessage('Profile deleted.', null);
          return refreshProfiles(false);
        })
        .catch(function (err) { setMessage(err.message || 'Could not delete profile.', 'error'); });
    }

    function startNewDraft() {
      state.activeId = null;
      if (displayNameInput) displayNameInput.value = '';
      if (profileTypeInput) profileTypeInput.value = 'other';
      if (selfToggle) selfToggle.checked = false;
      if (notesInput) notesInput.value = '';
      renderProfiles();
      setMessage('Editing a new unsaved profile. Save it when the birth details are ready.', null);
      var nameEl = document.getElementById('home-nf-name');
      if (nameEl) nameEl.focus();
      else if (displayNameInput) displayNameInput.focus();
    }

    function saveProfile(updateExisting) {
      var active = profileById(state.activeId);
      var payload = collectProfilePayload();
      var target = updateExisting && active ? active : null;
      var method = target ? 'PUT' : 'POST';
      if (method === 'POST') {
        payload.profileType = state.profiles.length ? 'other' : 'self';
        if (profileTypeInput) profileTypeInput.value = payload.profileType;
      }
      var bodyPayload = method === 'PUT' ? { id: target.id, profile: payload } : payload;
      var problem = profilePayloadProblem(payload);
      if (problem) {
        setMessage(problem, 'error');
        return;
      }
      jsonFetch('/api/profiles/', {
        method: method,
        body: JSON.stringify(bodyPayload),
      })
        .then(function (json) {
          setMessage(method === 'PUT' ? 'Profile updated.' : 'Profile saved.', null);
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
      deleteProfile(active);
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

    function downloadJson(filename, payload) {
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    }

    function exportAllProfiles() {
      closeMenu();
      if (!state.profiles.length) {
        setMessage('No saved birth profiles to export.', 'error');
        return;
      }
      downloadJson('iyogau-birth-profiles.json', {
        exportedAt: new Date().toISOString(),
        profileCount: state.profiles.length,
        profiles: state.profiles,
      });
      setMessage('Exported saved birth profiles from this account.', null);
    }

    function deleteAllProfiles() {
      closeMenu();
      if (!state.profiles.length) {
        setMessage('No saved birth profiles to delete.', 'error');
        return;
      }
      if (!window.confirm('Delete all saved birth profiles for this signed-in account? This cannot be undone.')) return;
      var ids = state.profiles.map(function (profile) { return profile.id; });
      ids.reduce(function (chain, id) {
        return chain.then(function () {
          return jsonFetch('/api/profiles/', {
            method: 'DELETE',
            body: JSON.stringify({ id: id }),
          });
        });
      }, Promise.resolve())
        .then(function () {
          state.activeId = null;
          return refreshProfiles(false);
        })
        .then(function () {
          setMessage('Deleted all saved birth profiles for this account.', null);
        })
        .catch(function (err) {
          setMessage(err.message || 'Could not delete saved birth profiles.', 'error');
        });
    }

    function initSession() {
      state.authConfig.loading = true;
      setSignedOut({ broadcast: false, reason: 'loading' });
      jsonFetch('/api/auth/config/')
        .then(function (json) {
          state.authConfig = {
            googleConfigured: !!json.googleConfigured,
            localDevAuthAvailable: !!json.localDevAuthAvailable,
            providers: Array.isArray(json.providers) ? json.providers : [],
            passwordAuthAvailable: !!json.passwordAuthAvailable,
            loading: false,
          };
          configureLoginControl();
          return jsonFetch('/api/auth/session/');
        })
        .then(function (json) {
          if (!json.authenticated) {
            setSignedOut({ reason: 'session-signed-out' });
            return;
          }
          setSignedIn(json.user, { reason: 'session-signed-in' });
          if (headerOnly) return;
          return refreshProfiles(true);
        })
        .catch(function () {
          state.authConfig = {
            googleConfigured: false,
            localDevAuthAvailable: false,
            providers: [],
            passwordAuthAvailable: false,
            loading: false,
          };
          setSignedOut({ reason: 'session-error' });
        });
    }

    loginControls.forEach(function (control) {
      control.addEventListener('click', function (evt) {
        if (state.user && control.hasAttribute('data-account-login-action')) {
          closeSignInDialog();
          closeProviderMenu();
          closeMenu();
          return;
        }
        if (state.authConfig.loading) {
          evt.preventDefault();
          setMessage('Still checking sign-in availability. Try again in a moment.', 'error');
          return;
        }
        if (authAvailable()) {
          evt.preventDefault();
          evt.stopPropagation();
          openSignInDialog();
          return;
        }
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
        if (!authAvailable()) {
          evt.preventDefault();
          setMessage('Sign-In is not configured on this server.', 'error');
        }
      });
    });
    logoutControls.forEach(function (control) {
      control.addEventListener('click', function () {
        closeMenu();
        jsonFetch('/api/auth/logout/', { method: 'POST', body: '{}' })
          .then(function () {
            setSignedOut({ reason: 'logout' });
            setMessage('', null);
          })
          .catch(function (err) { setMessage(err.message || 'Could not sign out.', 'error'); });
      });
    });
    manageButtons.forEach(function (control) {
      control.addEventListener('click', function () {
        closeMenu();
        var tab = document.getElementById('home-tab-input');
        if (tab) tab.click();
        setTimeout(function () {
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      });
    });
    if (accountToggle) {
      accountToggle.addEventListener('click', function (evt) {
        evt.stopPropagation();
        setMenuOpen(accountToggle.getAttribute('aria-expanded') !== 'true');
      });
    }
    if (accountMenu) {
      accountMenu.addEventListener('click', function (evt) {
        evt.stopPropagation();
      });
    }
    if (providerMenu) {
      providerMenu.addEventListener('click', function (evt) {
        evt.stopPropagation();
      });
    }
    accountMenuLinks.forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
    exportAllBtns.forEach(function (btn) {
      btn.addEventListener('click', exportAllProfiles);
    });
    deleteAllBtns.forEach(function (btn) {
      btn.addEventListener('click', deleteAllProfiles);
    });
    document.addEventListener('click', function () {
      closeMenu();
      closeProviderMenu();
    });
    document.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') {
        closeMenu();
        closeProviderMenu();
        closeSignInDialog();
      }
    });
    if (saveBtn) saveBtn.addEventListener('click', function () { saveProfile(false); });
    if (updateBtn) updateBtn.addEventListener('click', function () { saveProfile(true); });
    if (deleteBtn) deleteBtn.addEventListener('click', deleteActive);
    if (exportBtn) exportBtn.addEventListener('click', exportActive);
    if (newBtn) newBtn.addEventListener('click', startNewDraft);
    if (profileSearch) profileSearch.addEventListener('input', renderProfiles);
    if (selfToggle) selfToggle.addEventListener('change', function () {
      syncProfileTypeControl();
      if (selfToggle.checked) {
        setMessage('This profile will load by default after you save or update it.', null);
      } else {
        var active = profileById(state.activeId);
        if (active && !isUsableCoordinatePair(Number(active.lat), Number(active.lon))) {
          setMessage(unresolvedCoordinateMessage(), 'error');
        } else {
          setMessage('This profile will be saved as a non-default profile unless you mark it as mine.', null);
        }
      }
    });

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
