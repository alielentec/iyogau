/* =====================================================================
 *  natal-chart-form.js
 *  ---------------------------------------------------------------------
 *  Binds the natal-chart form: validation, city autocomplete, timezone
 *  resolution, API call to POST /api/calculate-chart, results render.
 *
 *  Hard rules:
 *    - The user-entered name is NEVER sent to the server.
 *    - Cities gazetteer is lazy-loaded (on first focus of #nf-place)
 *      and cached at window.__natalCities.
 *    - Consent must be checked or the form will not submit.
 *    - DOM is built with createElement + textContent — never innerHTML
 *      with interpolated content (XSS-safe by construction).
 *
 *  Depends on: window.NatalWheel (natal-chart-wheel.js).
 * ===================================================================== */

(function () {
  'use strict';

  // ---------- elements ----------

  var form = document.getElementById('natal-form');
  if (!form) return; // not on this page

  var nameEl      = document.getElementById('nf-name');
  var dateEl      = document.getElementById('nf-date');
  var timeEl      = document.getElementById('nf-time');
  var timeUnk     = document.getElementById('nf-time-unknown');
  var placeEl     = document.getElementById('nf-place');
  var listboxEl   = document.getElementById('nf-place-listbox');
  var emptyEl     = document.getElementById('nf-place-empty');
  var latEl       = document.getElementById('nf-lat');
  var lonEl       = document.getElementById('nf-lon');
  var tzDisplay   = document.getElementById('nf-tz-display');
  var tzAdjust    = document.getElementById('nf-tz-adjust');
  var tzSelect    = document.getElementById('nf-tz-select');
  var consentEl   = document.getElementById('nf-consent');
  var submitBtn   = document.getElementById('nf-submit');
  var errorEl     = document.getElementById('nf-error');
  var resultsEl   = document.getElementById('natal-results');
  var wheelEl     = document.getElementById('natal-wheel');
  var tablesEl    = document.getElementById('natal-tables');
  var metaEl      = document.getElementById('natal-meta');
  var privacyLink = document.getElementById('nf-privacy-link');

  // ---------- date defaults ----------

  if (dateEl) {
    var iso = new Date().toISOString().slice(0, 10);
    dateEl.setAttribute('max', iso);
  }

  // ---------- DOM helpers ----------

  function elt(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'dataset') {
        for (var dk in attrs[k]) n.dataset[dk] = attrs[k][dk];
      } else if (attrs[k] !== undefined && attrs[k] !== null) {
        n.setAttribute(k, attrs[k]);
      }
    }
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // ---------- privacy link per language ----------

  function getLang() {
    try {
      var p = new URLSearchParams(location.search);
      if (p.get('lang')) return p.get('lang');
    } catch (e) {}
    var html = document.documentElement.getAttribute('lang') || 'en';
    if (html.indexOf('ko') === 0) return 'ko';
    if (html.indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  function updatePrivacyLink() {
    if (!privacyLink) return;
    var lang = getLang();
    var region = (lang === 'ko') ? 'korea'
              : (lang === 'zh') ? 'china'
              : 'california';
    privacyLink.setAttribute('href', '/privacy/' + region + '/#sensitive');
  }
  updatePrivacyLink();
  window.addEventListener('iyogau:lang-changed', updatePrivacyLink);

  // ---------- i18n string helper ----------

  function t(key, fallback) {
    try {
      var lang = getLang();
      var dict = window.IYOGAU_I18N && window.IYOGAU_I18N[lang];
      if (!dict) return fallback;
      var node = dict;
      var parts = key.split('.');
      for (var i = 0; i < parts.length; i++) {
        if (node == null) return fallback;
        node = node[parts[i]];
      }
      return (typeof node === 'string' && node) ? node : fallback;
    } catch (e) { return fallback; }
  }

  // ---------- "time unknown" checkbox ----------

  if (timeUnk && timeEl) {
    timeUnk.addEventListener('change', function () {
      if (timeUnk.checked) {
        timeEl.value = '12:00';
        timeEl.setAttribute('disabled', 'disabled');
        timeEl.removeAttribute('required');
      } else {
        timeEl.removeAttribute('disabled');
        timeEl.setAttribute('required', 'required');
      }
      revalidate();
    });
  }

  // ---------- cities: lazy load ----------

  var citiesLoaded = false;
  var citiesLoading = null;

  function loadCities() {
    if (citiesLoaded) return Promise.resolve(window.__natalCities);
    if (citiesLoading) return citiesLoading;
    citiesLoading = fetch('/assets/data/cities.json', {
      headers: { 'accept': 'application/json' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('cities http ' + r.status);
        return r.json();
      })
      .then(function (data) {
        window.__natalCities = data;
        citiesLoaded = true;
        return data;
      })
      .catch(function (err) {
        citiesLoading = null;
        throw err;
      });
    return citiesLoading;
  }

  placeEl.addEventListener('focus', function once() {
    placeEl.removeEventListener('focus', once);
    loadCities().catch(function () {
      showError(t('natal.form.error.api', 'Could not load city list. Please refresh.'));
    });
  });

  // ---------- city autocomplete ----------

  var activeIndex = -1;
  var currentMatches = [];

  function normaliseQuery(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim();
  }

  function search(q) {
    if (!window.__natalCities || !q) return [];
    var nq = normaliseQuery(q);
    if (nq.length < 1) return [];
    var out = [];
    var cities = window.__natalCities;
    for (var i = 0; i < cities.length && out.length < 10; i++) {
      var c = cities[i];
      if (normaliseQuery(c.name).indexOf(nq) === 0) out.push(c);
    }
    if (out.length === 0) {
      for (var j = 0; j < cities.length && out.length < 10; j++) {
        var cj = cities[j];
        if (normaliseQuery(cj.name).indexOf(nq) !== -1) out.push(cj);
      }
    }
    return out;
  }

  function renderListbox(matches) {
    listboxEl.textContent = '';
    activeIndex = -1;
    if (!matches.length) {
      listboxEl.hidden = true;
      placeEl.setAttribute('aria-expanded', 'false');
      placeEl.setAttribute('aria-activedescendant', '');
      if (placeEl.value.trim().length >= 2 && citiesLoaded) {
        emptyEl.hidden = false;
      }
      return;
    }
    emptyEl.hidden = true;
    matches.forEach(function (c, i) {
      var li = elt('li', {
        id: 'nf-place-opt-' + i,
        role: 'option',
        'aria-selected': 'false',
        'class': 'combo-option'
      });
      li.appendChild(elt('span', { 'class': 'combo-option__name' }, c.name));
      li.appendChild(elt('span', { 'class': 'combo-option__country' }, c.country));
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selectCity(c);
      });
      listboxEl.appendChild(li);
    });
    listboxEl.hidden = false;
    placeEl.setAttribute('aria-expanded', 'true');
  }

  function highlightActive() {
    var opts = listboxEl.querySelectorAll('.combo-option');
    for (var i = 0; i < opts.length; i++) {
      var on = (i === activeIndex);
      opts[i].setAttribute('aria-selected', on ? 'true' : 'false');
      opts[i].classList.toggle('is-active', on);
    }
    placeEl.setAttribute('aria-activedescendant',
      activeIndex >= 0 ? 'nf-place-opt-' + activeIndex : '');
  }

  function selectCity(c) {
    placeEl.value = c.name + ', ' + c.country;
    placeEl.dataset.resolved = '1';
    latEl.value = c.lat;
    lonEl.value = c.lon;
    setTimezone(c.tz);
    listboxEl.hidden = true;
    placeEl.setAttribute('aria-expanded', 'false');
    revalidate();
  }

  placeEl.addEventListener('input', function () {
    placeEl.dataset.resolved = '';
    latEl.value = '';
    lonEl.value = '';
    var q = placeEl.value;
    if (!citiesLoaded) {
      loadCities().then(function () {
        currentMatches = search(q);
        renderListbox(currentMatches);
      }).catch(function () {});
      return;
    }
    currentMatches = search(q);
    renderListbox(currentMatches);
    revalidate();
  });

  placeEl.addEventListener('keydown', function (e) {
    if (listboxEl.hidden && (e.key === 'ArrowDown' || e.key === 'Down')) {
      currentMatches = search(placeEl.value);
      renderListbox(currentMatches);
      if (currentMatches.length) { activeIndex = 0; highlightActive(); }
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'Down') {
      if (currentMatches.length) {
        activeIndex = (activeIndex + 1) % currentMatches.length;
        highlightActive();
        e.preventDefault();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'Up') {
      if (currentMatches.length) {
        activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
        highlightActive();
        e.preventDefault();
      }
    } else if (e.key === 'Enter') {
      if (!listboxEl.hidden && activeIndex >= 0) {
        e.preventDefault();
        selectCity(currentMatches[activeIndex]);
      }
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      listboxEl.hidden = true;
      placeEl.setAttribute('aria-expanded', 'false');
    }
  });

  placeEl.addEventListener('blur', function () {
    setTimeout(function () {
      listboxEl.hidden = true;
      placeEl.setAttribute('aria-expanded', 'false');
    }, 100);
  });

  // ---------- timezone selector (manual override) ----------

  function populateTzSelect() {
    if (!tzSelect || tzSelect.options.length > 0) return;
    var zones = [];
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
        zones = Intl.supportedValuesOf('timeZone');
      }
    } catch (e) {}
    if (!zones.length) {
      zones = [
        'UTC',
        'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
        'America/Sao_Paulo',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
        'Africa/Cairo', 'Africa/Johannesburg',
        'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
        'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Seoul', 'Asia/Tokyo',
        'Australia/Sydney', 'Pacific/Auckland'
      ];
    }
    var frag = document.createDocumentFragment();
    zones.forEach(function (z) {
      frag.appendChild(elt('option', { value: z }, z));
    });
    tzSelect.appendChild(frag);
  }

  function setTimezone(tz) {
    if (!tz) return;
    populateTzSelect();
    if (tzSelect) {
      // If the resolved IANA zone isn't already in our option list
      // (rare — only happens when Intl.supportedValuesOf is missing AND
      // the fallback list doesn't include this zone), inject it so the
      // select's value setter will take.
      var found = false;
      for (var i = 0; i < tzSelect.options.length; i++) {
        if (tzSelect.options[i].value === tz) { found = true; break; }
      }
      if (!found) tzSelect.appendChild(elt('option', { value: tz }, tz));
      tzSelect.value = tz;
    }
    if (tzDisplay) tzDisplay.textContent = tz;
    revalidate();
  }

  if (tzAdjust) {
    tzAdjust.addEventListener('click', function () {
      populateTzSelect();
      tzSelect.hidden = false;
      tzSelect.focus();
    });
  }
  if (tzSelect) {
    tzSelect.addEventListener('change', function () {
      tzDisplay.textContent = tzSelect.value;
    });
  }

  // ---------- validation ----------

  function isValid() {
    if (!dateEl.value) return false;
    if (!timeUnk.checked && !timeEl.value) return false;
    if (!placeEl.dataset.resolved) return false;
    if (!latEl.value || !lonEl.value) return false;
    var tz = (tzSelect && tzSelect.value) || tzDisplay.textContent;
    if (!tz || !/[A-Za-z]+\/[A-Za-z_]+/.test(tz)) return false;
    if (!consentEl.checked) return false;
    return true;
  }

  function revalidate() { submitBtn.disabled = !isValid(); }

  [dateEl, timeEl, placeEl, consentEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', revalidate);
    el.addEventListener('change', revalidate);
  });

  // ---------- errors ----------

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
  function clearError()   { errorEl.textContent = '';  errorEl.hidden = true;  }

  // ---------- submit ----------

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    if (!consentEl.checked || !isValid()) {
      showError(t('natal.form.error.required',
        'Please complete every required field, including consent.'));
      return;
    }

    var tz = (tzSelect && tzSelect.value) || tzDisplay.textContent;
    var payload = {
      date: dateEl.value,
      time: timeUnk.checked ? '12:00' : timeEl.value,
      tz: tz,
      lat: parseFloat(latEl.value),
      lon: parseFloat(lonEl.value),
      tradition: 'sidereal',
      ayanamsa: 'lahiri',
      unknownTime: !!timeUnk.checked
    };
    // Note: payload deliberately omits the user-entered name.

    var submitLabel = submitBtn.querySelector('[data-i18n="natal.form.submit"]') || submitBtn;
    var originalText = submitLabel.textContent;
    submitLabel.textContent = t('natal.form.submitting', 'Calculating…');
    submitBtn.disabled = true;
    resultsEl.setAttribute('aria-busy', 'true');

    fetch('/api/calculate-chart', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (txt) {
          throw new Error('API ' + r.status + ': ' + txt.slice(0, 200));
        });
        return r.json();
      })
      .then(function (model) {
        renderResults(model);
      })
      .catch(function (err) {
        showError(t('natal.form.error.api',
          'Sorry — we could not compute your chart. Please check your details and try again.'));
        if (window.console && console.warn) console.warn('[natal] api error', err);
      })
      .then(function () {
        submitLabel.textContent = originalText;
        revalidate();
        resultsEl.setAttribute('aria-busy', 'false');
      });
  });

  // ---------- results render ----------

  function degMin(p) {
    var d = (p.degree != null) ? p.degree : 0;
    var m = (p.minute != null) ? p.minute : 0;
    return d + '°' + (m < 10 ? '0' + m : m) + '′';
  }

  function signLabel(signName) {
    if (!signName) return '—';
    return t('natal.signs.' + signName.toLowerCase(), signName);
  }

  function planetLabel(name, retrograde) {
    var base = t('natal.planets.' + name.toLowerCase(), name);
    return retrograde ? base + ' ℞' : base;
  }

  function appendTable(parent, headings, rows) {
    var table = elt('table', { 'class': 'natal-table' });
    var thead = elt('thead');
    var trh = elt('tr');
    headings.forEach(function (h) {
      trh.appendChild(elt('th', { scope: 'col' }, h));
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = elt('tbody');
    rows.forEach(function (cells) {
      var tr = elt('tr');
      cells.forEach(function (cell, idx) {
        var node = elt(idx === 0 ? 'th' : 'td', idx === 0 ? { scope: 'row' } : null, cell);
        tr.appendChild(node);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    parent.appendChild(table);
    return table;
  }

  function renderResults(model) {
    if (!resultsEl) return;

    // Wheel
    if (window.NatalWheel && wheelEl) {
      try {
        window.NatalWheel.render(model, wheelEl, {
          showAspects: true,
          locale: getLang()
        });
      } catch (err) {
        if (window.console && console.error) console.error('[natal] wheel error', err);
      }
    }

    // Meta line
    metaEl.textContent = '';
    var pieces = [];
    if (model.tradition) {
      pieces.push(model.tradition === 'sidereal'
        ? t('natal.results.siderealLabel', 'Sidereal (Vedic)')
        : model.tradition);
    }
    if (model.ayanamsa) {
      var ayan = t('natal.results.ayanamsaLabel', 'Ayanamsa') + ': ' + model.ayanamsa;
      if (typeof model.ayanamsaValue === 'number') {
        ayan += ' (' + model.ayanamsaValue.toFixed(2) + '°)';
      }
      pieces.push(ayan);
    }
    if (model.houseSystem) {
      pieces.push(t('natal.results.housesLabel', 'Houses') + ': ' + model.houseSystem);
    }
    metaEl.appendChild(elt('p', { 'class': 'natal-meta__line' }, pieces.join(' · ')));

    // Tables
    tablesEl.textContent = '';

    // Asc / MC summary
    if (model.ascendant || model.midheaven) {
      var axesP = elt('p', { 'class': 'natal-axes-summary' });
      if (model.ascendant) {
        axesP.appendChild(elt('strong', null, t('natal.results.ascendant', 'Ascendant') + ': '));
        axesP.appendChild(document.createTextNode(
          signLabel(model.ascendant.sign) + ' ' + degMin(model.ascendant)
        ));
      }
      if (model.ascendant && model.midheaven) {
        axesP.appendChild(document.createTextNode('  ·  '));
      }
      if (model.midheaven) {
        axesP.appendChild(elt('strong', null, t('natal.results.midheaven', 'Midheaven') + ': '));
        axesP.appendChild(document.createTextNode(
          signLabel(model.midheaven.sign) + ' ' + degMin(model.midheaven)
        ));
      }
      tablesEl.appendChild(axesP);
    }

    // Planets table
    tablesEl.appendChild(elt('h3', null, t('natal.results.planets', 'Planet positions')));
    var planetRows = (model.planets || []).map(function (p) {
      return [
        planetLabel(p.name, p.retrograde),
        signLabel(p.sign),
        degMin(p),
        (p.house != null ? String(p.house) : '—')
      ];
    });
    appendTable(tablesEl, [
      t('natal.results.planetCol', 'Planet'),
      t('natal.results.signCol', 'Sign'),
      t('natal.results.degreeCol', 'Degree'),
      t('natal.results.houseCol', 'House')
    ], planetRows);

    // Aspects
    if (Array.isArray(model.aspects) && model.aspects.length) {
      tablesEl.appendChild(elt('h3', null, t('natal.results.aspects', 'Major aspects')));
      var aspectRows = model.aspects.map(function (a) {
        return [
          planetLabel(a.from, false),
          t('natal.aspects.' + a.type, a.type),
          planetLabel(a.to, false),
          (a.orb != null ? a.orb.toFixed(1) + '°' : '—')
        ];
      });
      appendTable(tablesEl, [
        t('natal.results.aspectFrom', 'From'),
        t('natal.results.aspectType', 'Aspect'),
        t('natal.results.aspectTo', 'To'),
        t('natal.results.aspectOrb', 'Orb')
      ], aspectRows);
    }

    // Reveal & focus
    resultsEl.hidden = false;
    resultsEl.setAttribute('aria-busy', 'false');
    var raf = (typeof window.requestAnimationFrame === 'function')
      ? window.requestAnimationFrame
      : function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      if (typeof resultsEl.scrollIntoView === 'function') {
        try { resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      }
      var heading = document.getElementById('natal-results-heading');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        try { heading.focus({ preventScroll: true }); } catch (e) {}
      }
    });
  }

  // Initial state
  revalidate();
}());
