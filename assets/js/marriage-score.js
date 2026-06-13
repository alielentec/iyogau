/* =====================================================================
 *  marriage-score.js
 *  ---------------------------------------------------------------------
 *  Signed-in Marriage Score tool. Uses saved profile IDs only; the server
 *  resolves ownership and computes Ashtakoota / Guna Milan.
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
        else if (attrs[key] !== undefined && attrs[key] !== null) node.setAttribute(key, attrs[key]);
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
            var err = new Error((json && json.error) || 'Request failed.');
            err.status = response.status;
            throw err;
          }
          return json;
        });
      });
  }

  function profilePayload(profile) {
    return {
      date: profile.birthDate,
      time: profile.unknownTime ? '12:00' : profile.birthTime,
      tz: profile.timezone,
      lat: Number(profile.lat),
      lon: Number(profile.lon),
      tradition: 'sidereal',
      ayanamsa: 'true_chitrapaksha',
      unknownTime: !!profile.unknownTime,
    };
  }

  function init(root) {
    var selectA = $('[data-marriage-select="a"]', root);
    var selectB = $('[data-marriage-select="b"]', root);
    var calculateBtn = $('[data-marriage-calculate]', root);
    var resultEl = $('[data-marriage-result]', root);
    var profiles = [];

    function profileById(id) {
      return profiles.find(function (profile) { return profile.id === id; }) || null;
    }

    function renderProfile(side) {
      var select = side === 'a' ? selectA : selectB;
      var profile = profileById(select && select.value);
      var panel = $('[data-marriage-card-panel="' + side + ':data"]', root);
      var wheel = $('[data-marriage-wheel="' + side + '"]', root);
      if (panel) {
        panel.textContent = '';
        if (!profile) {
          panel.appendChild(el('p', { class: 'natal-empty' }, 'Select a saved profile.'));
        } else {
          var list = el('dl', { class: 'marriage-data' });
          [
            ['Name', profile.displayName],
            ['Type', profile.profileType],
            ['Birth date', profile.birthDate],
            ['Birth time', profile.unknownTime ? 'Unknown time' : profile.birthTime],
            ['Birthplace', profile.birthplaceName],
            ['Timezone', profile.timezone],
          ].forEach(function (row) {
            list.appendChild(el('dt', null, row[0]));
            list.appendChild(el('dd', null, row[1]));
          });
          panel.appendChild(list);
        }
      }
      if (wheel) wheel.textContent = '';
      if (!profile || !wheel || !window.NatalWheel) return;
      jsonFetch('/api/calculate-chart/', {
        method: 'POST',
        body: JSON.stringify(profilePayload(profile)),
      })
        .then(function (model) {
          try { window.NatalWheel.render(model, wheel, { showAspects: false, locale: 'en' }); } catch (err) {}
        })
        .catch(function () {
          if (wheel) wheel.appendChild(el('text', { x: '50%', y: '50%', 'text-anchor': 'middle' }, 'Chart unavailable'));
        });
    }

    function updateCalculateState() {
      var ready = !!(selectA && selectB && selectA.value && selectB.value && selectA.value !== selectB.value);
      if (calculateBtn) calculateBtn.disabled = !ready;
    }

    function populateSelectors() {
      [selectA, selectB].forEach(function (select, idx) {
        if (!select) return;
        var current = select.value;
        select.textContent = '';
        select.appendChild(el('option', { value: '' }, 'Select saved profile'));
        profiles.forEach(function (profile) {
          select.appendChild(el('option', { value: profile.id }, profile.displayName + ' · ' + profile.profileType));
        });
        if (current && profileById(current)) select.value = current;
        else if (profiles[idx]) select.value = profiles[idx].id;
      });
      renderProfile('a');
      renderProfile('b');
      updateCalculateState();
    }

    function refreshProfiles() {
      return jsonFetch('/api/auth/session/')
        .then(function (session) {
          if (!session.authenticated) {
            profiles = [];
            populateSelectors();
            if (resultEl) {
              resultEl.textContent = '';
              resultEl.appendChild(el('p', { class: 'natal-empty' }, 'Sign in to use saved profiles for marriage scoring.'));
            }
            return null;
          }
          return jsonFetch('/api/profiles/');
        })
        .then(function (json) {
          if (!json) return;
          profiles = Array.isArray(json.profiles) ? json.profiles : [];
          populateSelectors();
        })
        .catch(function (err) {
          if (resultEl) {
            resultEl.textContent = '';
            resultEl.appendChild(el('p', { class: 'natal-empty' },
              err.status === 401 ? 'Sign in to use saved profiles for marriage scoring.' : 'Could not load saved profiles.'));
          }
        });
    }

    function renderScore(payload) {
      if (!resultEl) return;
      var score = payload.score;
      resultEl.textContent = '';
      var summary = el('div', { class: 'marriage-result__summary' });
      summary.appendChild(el('strong', null, score.totalScore + ' / ' + score.maxScore));
      summary.appendChild(el('span', null, score.verdict));
      resultEl.appendChild(summary);

      var table = el('table', { class: 'natal-table marriage-factor-table' });
      var thead = el('thead');
      var headRow = el('tr');
      ['Factor', 'Score', 'Max', 'Detail'].forEach(function (heading) {
        headRow.appendChild(el('th', { scope: 'col' }, heading));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      score.factors.forEach(function (factor) {
        var row = el('tr');
        row.appendChild(el('th', { scope: 'row' }, factor.name));
        row.appendChild(el('td', null, factor.score));
        row.appendChild(el('td', null, factor.maxScore));
        row.appendChild(el('td', null, factor.detail));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      resultEl.appendChild(table);
    }

    function calculate() {
      if (!selectA || !selectB || !selectA.value || !selectB.value || selectA.value === selectB.value) return;
      if (resultEl) resultEl.textContent = 'Calculating...';
      jsonFetch('/api/marriage-score/', {
        method: 'POST',
        body: JSON.stringify({ profileAId: selectA.value, profileBId: selectB.value }),
      })
        .then(renderScore)
        .catch(function (err) {
          if (resultEl) resultEl.textContent = err.message || 'Could not calculate marriage score.';
        });
    }

    [selectA, selectB].forEach(function (select, idx) {
      if (!select) return;
      select.addEventListener('change', function () {
        renderProfile(idx === 0 ? 'a' : 'b');
        updateCalculateState();
      });
    });
    if (calculateBtn) calculateBtn.addEventListener('click', calculate);
    $all('[data-marriage-card-tab]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-marriage-card-tab');
        var side = key.split(':')[0];
        $all('[data-marriage-card-tab^="' + side + ':"]', root).forEach(function (tab) {
          tab.classList.toggle('is-active', tab === button);
        });
        $all('[data-marriage-card-panel^="' + side + ':"]', root).forEach(function (panel) {
          panel.hidden = panel.getAttribute('data-marriage-card-panel') !== key;
        });
      });
    });
    window.addEventListener('iyogau:profiles-updated', function (evt) {
      profiles = Array.isArray(evt.detail && evt.detail.profiles) ? evt.detail.profiles : profiles;
      populateSelectors();
    });
    refreshProfiles();
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    $all('[data-marriage-tool]').forEach(init);
  });
}());
