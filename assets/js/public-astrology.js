/* =====================================================================
 *  public-astrology.js
 *  ---------------------------------------------------------------------
 *  Read-only public astrology picker for the homepage.
 *
 *  Personal birth data is not collected here. The page only calculates
 *  charts from published preset snapshots in natal-presets.js. Ali stays
 *  available in the data module for calibration/private workflows, but is
 *  intentionally filtered out of the public homepage card list.
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

  function activeLang() {
    var html = document.documentElement.getAttribute('lang') || 'en';
    if (html.indexOf('ko') === 0) return 'ko';
    if (html.indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  function getNested(obj, path) {
    var node = obj;
    for (var i = 0; i < path.length; i += 1) {
      if (node == null) return null;
      node = node[path[i]];
    }
    return node;
  }

  function localizedPreset(preset) {
    var dict = window.IYOGAU_I18N && window.IYOGAU_I18N[activeLang()];
    var info = getNested(dict, ['natal', 'presets', preset.id]) || {};
    return {
      id: preset.id,
      name: info.name || preset.name,
      placeLabel: info.placeLabel || preset.placeLabel,
      blurb: info.blurb || preset.blurb,
      source: preset.source || '',
    };
  }

  function initials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join('') || 'P';
  }

  function presetPayload(preset) {
    return {
      date: preset.birthDate,
      time: preset.birthTime || '12:00',
      tz: preset.tz,
      lat: Number(preset.lat),
      lon: Number(preset.lon),
      tradition: 'sidereal',
      ayanamsa: 'true_chitrapaksha',
      unknownTime: false,
    };
  }

  function ayanamsaLabel(value) {
    if (value === 'true_chitrapaksha' || value === 'jhora') return 'True Chitrapaksha/JHora';
    if (value === 'lahiri') return 'Lahiri';
    return value || '';
  }

  function formatPresetCaption(preset, info) {
    return info.name + ' - ' + preset.birthDate + ' - ' + info.placeLabel;
  }

  function publishAstrocartoSource(preset) {
    var payload = presetPayload(preset);
    try {
      if (window.__astrocarto && typeof window.__astrocarto.setNatalSource === 'function') {
        window.__astrocarto.setNatalSource(payload);
      } else {
        window.__astrocartoPending = payload;
      }
    } catch (err) {}
  }

  function updateMapCaptions(preset, info) {
    var caption = formatPresetCaption(preset, info);
    var relocation = $('#home-public-relocation-caption');
    var soulmate = $('#home-public-soulmate-caption');
    if (relocation) relocation.textContent = 'Relocation heat map for ' + caption + '.';
    if (soulmate) soulmate.textContent = 'Soulmate heat map for ' + caption + '.';
  }

  function renderModel(model, preset) {
    var info = localizedPreset(preset);
    var title = $('#home-public-chart-title');
    var caption = $('#home-public-chart-caption');
    var source = $('#home-public-chart-source');
    var meta = $('#home-public-chart-meta');
    var wheel = $('#home-public-chart-wheel');

    if (title) title.textContent = info.name;
    if (caption) caption.textContent = formatPresetCaption(preset, info);
    if (source) source.textContent = info.name + ' birth data: ' + info.source;
    updateMapCaptions(preset, info);

    if (wheel && window.NatalWheel && typeof window.NatalWheel.render === 'function') {
      window.NatalWheel.render(model, wheel, { showAspects: false, locale: activeLang() });
    }

    if (meta) {
      var pieces = [];
      if (model.tradition === 'sidereal') pieces.push('Sidereal Vedic');
      if (model.ayanamsa) {
        pieces.push('Ayanamsa: ' + ayanamsaLabel(model.ayanamsa) +
          (typeof model.ayanamsaValue === 'number' ? ' (' + model.ayanamsaValue.toFixed(2) + '\u00b0)' : ''));
      }
      if (model.houseSystem) pieces.push('Houses: ' + model.houseSystem);
      meta.textContent = pieces.join(' - ');
    }

    publishAstrocartoSource(preset);
  }

  var state = {
    presets: [],
    activeId: '',
    requestId: 0,
    cache: {},
  };

  function setStatus(text, kind) {
    var status = $('#home-public-chart-status');
    if (!status) return;
    status.textContent = text || '';
    status.hidden = !text;
    if (kind) status.setAttribute('data-state', kind);
    else status.removeAttribute('data-state');
  }

  function updateActiveCard() {
    $all('[data-public-preset-id]').forEach(function (card) {
      var active = card.getAttribute('data-public-preset-id') === state.activeId;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function calculatePreset(preset) {
    state.activeId = preset.id;
    updateActiveCard();
    publishAstrocartoSource(preset);
    updateMapCaptions(preset, localizedPreset(preset));
    var currentRequest = state.requestId + 1;
    state.requestId = currentRequest;
    var cached = state.cache[preset.id];
    if (cached) {
      renderModel(cached, preset);
      setStatus('', null);
      return Promise.resolve(cached);
    }
    setStatus('Calculating public chart...', null);
    var results = $('#home-public-chart-results');
    if (results) results.setAttribute('aria-busy', 'true');
    return fetch('/api/calculate-chart/', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(presetPayload(preset)),
    })
      .then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            throw new Error('API ' + response.status + ': ' + text.slice(0, 160));
          });
        }
        return response.json();
      })
      .then(function (model) {
        if (state.requestId !== currentRequest) return model;
        state.cache[preset.id] = model;
        renderModel(model, preset);
        setStatus('', null);
        return model;
      })
      .catch(function (err) {
        if (state.requestId === currentRequest) {
          setStatus('Could not calculate this public chart. Please try another person.', 'error');
        }
        if (window.console && console.warn) console.warn('[public-astrology]', err);
      })
      .then(function (model) {
        if (results) results.setAttribute('aria-busy', 'false');
        return model;
      });
  }

  function renderCards() {
    var list = $('#home-public-preset-cards');
    if (!list) return;
    list.textContent = '';
    var frag = document.createDocumentFragment();
    state.presets.forEach(function (preset) {
      var info = localizedPreset(preset);
      var card = el('button', {
        type: 'button',
        class: 'natal-public-card',
        'data-public-preset-id': preset.id,
        'aria-pressed': 'false',
      });
      var media = el('span', { class: 'natal-public-card__media' });
      if (preset.image) {
        var img = el('img', { src: preset.image, alt: preset.imageAlt || info.name, loading: 'lazy' });
        media.appendChild(img);
      } else {
        media.appendChild(el('span', { class: 'natal-public-card__initials' }, initials(info.name)));
      }
      var body = el('span', { class: 'natal-public-card__body' });
      body.appendChild(el('strong', null, info.name));
      body.appendChild(el('span', null, preset.birthDate + ' - ' + info.placeLabel));
      body.appendChild(el('span', null, info.blurb));
      card.appendChild(media);
      card.appendChild(body);
      card.addEventListener('click', function () { calculatePreset(preset); });
      frag.appendChild(card);
    });
    list.appendChild(frag);
    updateActiveCard();
  }

  function init() {
    var root = $('#natal-calc');
    if (!root || !$('#home-public-preset-cards', root)) return;
    state.presets = (window.IYOGAU_NATAL_PRESETS || []).filter(function (preset) {
      return preset && preset.publicCard && preset.id !== 'ali';
    });
    renderCards();
    if (state.presets.length) calculatePreset(state.presets[0]);
    window.addEventListener('iyogau:lang-changed', function () {
      renderCards();
      updateActiveCard();
      var active = state.presets.filter(function (preset) { return preset.id === state.activeId; })[0];
      if (active && state.cache[active.id]) renderModel(state.cache[active.id], active);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
