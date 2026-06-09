/* =====================================================================
 *  astrocarto.js
 *  ---------------------------------------------------------------------
 *  Client-side renderer for the astrocartography world maps shown in the
 *  three new natal-chart tabs (Relocation / Immigration / Soulmate).
 *
 *  Data flow:
 *
 *    homepage-natal-form bootstrap
 *        ▼
 *    POST /api/calculate-chart       (already wired)
 *        ▼
 *    window.__astrocarto.setNatalSource(payload)   <-- expose form payload
 *        ▼
 *    User clicks "Relocation"/"Immigration"/"Soulmate" tab
 *        ▼
 *    POST /api/astrocarto  {date,time,tz,mode}
 *        ▼
 *    renderMap(panelEl, response, mode)            <-- SVG world map
 *
 *  Each tab does its own fetch on FIRST activation, then caches the JSON
 *  for the rest of the session (the chart only changes when the user
 *  resubmits the form — at which point the cache is invalidated).
 *
 *  No dependencies. Uses inline SVG with the same theme tokens as the
 *  rest of the site:
 *    --planet-sun, --planet-moon, ...     (per-planet line colors)
 *    --heat-0 ... --heat-100              (heat-matrix gradient stops,
 *                                          defined in natal-chart.css)
 *
 *  i18n: reads from window.IYOGAU_I18N (populated by
 *  i18n.natal-chart.js); falls back to English source text if a key
 *  is missing.
 *
 *  Auto-mounts to every `[data-astrocarto]` element on DOMContentLoaded.
 * ===================================================================== */

(function () {
  'use strict';

  // ---------- Map projection geometry ----------

  // Equirectangular: x = (lon + 180) * SCALE_X, y = (90 - lat) * SCALE_Y.
  // We render at the SVG viewBox 800×400, so SCALE_X = 800/360 = 2.222,
  // SCALE_Y = 400/180 = 2.222 — same factor, square pixels.
  var VIEW_W = 800;
  var VIEW_H = 400;
  function lon2x(lon) { return (lon + 180) * (VIEW_W / 360); }
  function lat2y(lat) { return (90 - lat) * (VIEW_H / 180); }
  function x2lon(x) { return (x / (VIEW_W / 360)) - 180; }
  function y2lat(y) { return 90 - (y / (VIEW_H / 180)); }

  // ---------- i18n helper ----------

  function getLang() {
    var p; try { p = new URLSearchParams(window.location.search); } catch (e) {}
    if (p && p.get('lang')) return p.get('lang');
    var h = document.documentElement.getAttribute('lang') || 'en';
    if (h.indexOf('ko') === 0) return 'ko';
    if (h.indexOf('zh') === 0) return 'zh';
    return 'en';
  }
  function tr(path, fallback) {
    var dict = window.IYOGAU_I18N && window.IYOGAU_I18N[getLang()];
    if (!dict) return fallback;
    var parts = path.split('.');
    var node = dict;
    for (var i = 0; i < parts.length; i += 1) {
      if (node == null) return fallback;
      node = node[parts[i]];
    }
    return (typeof node === 'string' && node) ? node : fallback;
  }

  // ---------- DOM helpers (no innerHTML) ----------

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        n.setAttribute(k, attrs[k]);
      }
    }
    return n;
  }
  function htmlEl(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (k === 'class') n.className = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
    }
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function removeAllChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------- Heat-matrix color (5-stop gradient via CSS custom props) ----------

  // Maps a heat score 0..100 to a fill color. Reads the five named CSS
  // custom properties --heat-0, --heat-25, --heat-50, --heat-75, --heat-100
  // off :root and linearly interpolates in RGB space.
  function readHeatStops() {
    var root = getComputedStyle(document.documentElement);
    return [
      { v: 0,   color: (root.getPropertyValue('--heat-0')   || '#1b2538').trim() },
      { v: 25,  color: (root.getPropertyValue('--heat-25')  || '#2c4b67').trim() },
      { v: 50,  color: (root.getPropertyValue('--heat-50')  || '#7a8a6b').trim() },
      { v: 75,  color: (root.getPropertyValue('--heat-75')  || '#d6a352').trim() },
      { v: 100, color: (root.getPropertyValue('--heat-100') || '#c64c3d').trim() }
    ];
  }
  function parseColor(c) {
    // Accept #RGB, #RRGGBB.
    var s = c.charAt(0) === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16)
    ];
  }
  function colorForValue(value, stops) {
    if (value <= stops[0].v) return stops[0].color;
    if (value >= stops[stops.length - 1].v) return stops[stops.length - 1].color;
    for (var i = 0; i < stops.length - 1; i += 1) {
      var a = stops[i];
      var b = stops[i + 1];
      if (value >= a.v && value <= b.v) {
        var t = (value - a.v) / (b.v - a.v);
        var ra = parseColor(a.color);
        var rb = parseColor(b.color);
        var r = Math.round(ra[0] + (rb[0] - ra[0]) * t);
        var g = Math.round(ra[1] + (rb[1] - ra[1]) * t);
        var bv = Math.round(ra[2] + (rb[2] - ra[2]) * t);
        return 'rgb(' + r + ',' + g + ',' + bv + ')';
      }
    }
    return stops[stops.length - 1].color;
  }

  // ---------- Per-planet color (re-use existing --planet-* tokens) ----------

  function planetTokenColor(planet) {
    var root = getComputedStyle(document.documentElement);
    var key = '--planet-' + planet.toLowerCase();
    var c = (root.getPropertyValue(key) || '').trim();
    return c || '#8C6A1A';
  }

  // ---------- Line-type stroke pattern ----------

  // MC: solid     IC: long-dash (12 4)
  // AC: medium-dash (6 4)   DC: dotted (2 3)
  function strokeDashFor(type) {
    if (type === 'MC') return null;
    if (type === 'IC') return '12 4';
    if (type === 'AC') return '6 4';
    if (type === 'DC') return '2 3';
    return null;
  }

  // ---------- SVG continent outline ----------

  function continentsPathD(polygons) {
    // Compose one big "M lon lat L lon lat … Z M …" path string from the
    // continents-data module. Each polygon contributes one closed subpath.
    var parts = [];
    for (var i = 0; i < polygons.length; i += 1) {
      var p = polygons[i].poly;
      if (!p || p.length < 3) continue;
      var seg = 'M' + lon2x(p[0][0]).toFixed(1) + ' ' + lat2y(p[0][1]).toFixed(1);
      for (var j = 1; j < p.length; j += 1) {
        seg += ' L' + lon2x(p[j][0]).toFixed(1) + ' ' + lat2y(p[j][1]).toFixed(1);
      }
      seg += ' Z';
      parts.push(seg);
    }
    return parts.join(' ');
  }

  // ---------- Build the SVG ----------

  function renderMap(container, response, mode) {
    if (!container || !response) return;
    removeAllChildren(container);

    var heatStops = readHeatStops();

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H,
      role: 'img',
      'aria-label': tr('natal.astrocarto.tabs.' + mode, mode) + ' world map',
      class: 'astrocarto-svg',
      preserveAspectRatio: 'xMidYMid meet'
    });

    // ---- Background (ocean) ----
    var bg = svgEl('rect', {
      x: 0, y: 0, width: VIEW_W, height: VIEW_H,
      class: 'astrocarto-ocean'
    });
    svg.appendChild(bg);

    // ---- Graticule (10° grid) ----
    var grat = svgEl('g', { class: 'astrocarto-graticule', 'aria-hidden': 'true' });
    for (var lon = -180; lon <= 180; lon += 30) {
      grat.appendChild(svgEl('line', {
        x1: lon2x(lon), y1: 0, x2: lon2x(lon), y2: VIEW_H
      }));
    }
    for (var lat = -60; lat <= 60; lat += 30) {
      grat.appendChild(svgEl('line', {
        x1: 0, y1: lat2y(lat), x2: VIEW_W, y2: lat2y(lat)
      }));
    }
    // Equator emphasis
    var eq = svgEl('line', {
      x1: 0, y1: lat2y(0), x2: VIEW_W, y2: lat2y(0),
      class: 'astrocarto-equator'
    });
    grat.appendChild(eq);
    svg.appendChild(grat);

    // ---- Heat matrix cells ----
    // Response shape (from /api/astrocarto):
    //   heatMatrix.latitudes   = [lat_0, lat_1, ...]    (length R)
    //   heatMatrix.longitudes  = [lon_0, lon_1, ...]    (length C)
    //   heatMatrix.values      = R × C array of {value 0..100}
    //   heatMatrix.cellMeta    = R × C array of top-3 contributors
    //   heatMatrix.latStep, lonStep
    var hm = response.heatMatrix || {};
    var latitudes = hm.latitudes || [];
    var longitudes = hm.longitudes || [];
    var values = hm.values || [];
    var cellMeta = hm.cellMeta || [];
    var latStep = hm.latStep || (latitudes.length > 1 ? Math.abs(latitudes[1] - latitudes[0]) : 4);
    var lonStep = hm.lonStep || (longitudes.length > 1 ? Math.abs(longitudes[1] - longitudes[0]) : 4);
    var cellW = (VIEW_W / 360) * lonStep + 0.6; // +0.6px to mask seams
    var cellH = (VIEW_H / 180) * latStep + 0.6;

    var heatG = svgEl('g', { class: 'astrocarto-heat', 'aria-hidden': 'true' });
    for (var ri = 0; ri < latitudes.length; ri += 1) {
      var rowLat = latitudes[ri];
      var row = values[ri] || [];
      for (var ci = 0; ci < longitudes.length; ci += 1) {
        var cellLon = longitudes[ci];
        var v = row[ci];
        if (v == null) continue;
        var x = lon2x(cellLon);
        var y = lat2y(rowLat) - cellH; // cell anchors at lat; draw upward
        var fill = colorForValue(v, heatStops);
        var opacity = 0.08 + (v / 100) * 0.72; // 0.08 → 0.80
        // Skip near-zero cells entirely — they only add visual noise and
        // hide the continent outlines beneath.
        if (v < 5) continue;
        var rect = svgEl('rect', {
          x: x.toFixed(1), y: y.toFixed(1),
          width: cellW.toFixed(2), height: cellH.toFixed(2),
          fill: fill,
          'fill-opacity': opacity.toFixed(2),
          class: 'astrocarto-cell'
        });
        heatG.appendChild(rect);
      }
    }
    svg.appendChild(heatG);

    // ---- Continent outlines (rendered ABOVE the heat to give shape) ----
    var continents = window.IYOGAU_WORLD_CONTINENTS || [];
    if (continents.length) {
      var land = svgEl('path', {
        d: continentsPathD(continents),
        class: 'astrocarto-land',
        'aria-hidden': 'true',
        'fill-rule': 'evenodd'
      });
      svg.appendChild(land);
    }

    // ---- Planet lines ----
    var lines = response.lines || [];
    var linesG = svgEl('g', { class: 'astrocarto-lines', 'aria-hidden': 'true' });
    // Filter to top planets per mode to keep the map readable: ditch lines
    // whose mode weight < 0.5. For Sun/Jupiter/Venus etc this still shows
    // all major lines; it drops Ketu/Mars from soulmate, etc.
    // Source of truth is the API response (see /api/_lib/astrocarto.js#L485).
    var modeWeights = response.modeWeights || {};
    for (var li = 0; li < lines.length; li += 1) {
      var line = lines[li];
      if ((modeWeights[line.planet] || 0) < 0.5) continue;
      var color = planetTokenColor(line.planet);
      var dash = strokeDashFor(line.type);
      var d = polylineToPathD(line.points);
      if (!d) continue;
      var path = svgEl('path', {
        d: d,
        stroke: color,
        'stroke-width': 1.4,
        fill: 'none',
        class: 'astrocarto-line astrocarto-line--' + line.type.toLowerCase(),
        'data-planet': line.planet,
        'data-type': line.type
      });
      if (dash) path.setAttribute('stroke-dasharray', dash);
      linesG.appendChild(path);
    }
    svg.appendChild(linesG);

    // ---- Tooltip surface (transparent layer that captures pointer) ----
    var tipSurface = svgEl('rect', {
      x: 0, y: 0, width: VIEW_W, height: VIEW_H,
      fill: 'transparent',
      class: 'astrocarto-tip-surface'
    });
    svg.appendChild(tipSurface);

    container.appendChild(svg);

    // ---- Tooltip element (rendered as HTML, not SVG, so we get nice text wrap) ----
    var tooltip = htmlEl('div', { class: 'astrocarto-tooltip', role: 'status', 'aria-live': 'polite' });
    tooltip.hidden = true;
    container.appendChild(tooltip);

    // Hover/click handler — find the nearest cell in the matrix grid.
    function showTooltipFor(evt) {
      var rect = svg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) * (VIEW_W / rect.width);
      var py = (evt.clientY - rect.top) * (VIEW_H / rect.height);
      var lonP = x2lon(px);
      var latP = y2lat(py);
      // Map pointer (lat, lon) → nearest grid (row, col) using O(1) math.
      // `latitudes` is monotonic with step `latStep`; same for `longitudes`.
      if (!latitudes.length || !longitudes.length) { tooltip.hidden = true; return; }
      var lat0 = latitudes[0];
      var lon0 = longitudes[0];
      // Cells render with SW-corner anchor extending NORTH+EAST (see renderMap
      // around line 255: `y = lat2y(rowLat) - cellH`). Use floor — not round —
      // so a pointer inside a cell maps to that cell's index, not the neighbour.
      var ri = Math.floor((latP - lat0) / latStep);
      var ci = Math.floor((lonP - lon0) / lonStep);
      if (ri < 0) ri = 0; else if (ri >= latitudes.length) ri = latitudes.length - 1;
      if (ci < 0) ci = 0; else if (ci >= longitudes.length) ci = longitudes.length - 1;
      var rowV = values[ri] || [];
      var rowM = cellMeta[ri] || [];
      var match = {
        lat: latitudes[ri],
        lon: longitudes[ci],
        value: rowV[ci],
        top: rowM[ci] || []
      };
      if (match.value == null) { tooltip.hidden = true; return; }
      renderTooltip(tooltip, match, lonP, latP);
      // Position relative to container.
      var cRect = container.getBoundingClientRect();
      var tx = (evt.clientX - cRect.left) + 12;
      var ty = (evt.clientY - cRect.top) + 12;
      // Keep inside container.
      tooltip.style.left = Math.min(tx, cRect.width - 200) + 'px';
      tooltip.style.top  = Math.min(ty, cRect.height - 80) + 'px';
      tooltip.hidden = false;
    }
    tipSurface.addEventListener('mousemove', showTooltipFor);
    tipSurface.addEventListener('click',     showTooltipFor);
    tipSurface.addEventListener('mouseleave', function () { tooltip.hidden = true; });
  }

  function renderTooltip(tooltip, cell, lonExact, latExact) {
    removeAllChildren(tooltip);
    var head = htmlEl('div', { class: 'astrocarto-tip__head' });
    head.appendChild(htmlEl('strong', null,
      tr('natal.astrocarto.tooltip.score', 'Score') + ': ' + cell.value
    ));
    head.appendChild(htmlEl('span', { class: 'astrocarto-tip__coords' },
      ' · ' + formatLat(latExact) + ', ' + formatLon(lonExact)
    ));
    tooltip.appendChild(head);

    if (cell.top && cell.top.length) {
      var listHeading = htmlEl('div', { class: 'astrocarto-tip__listhead' },
        tr('natal.astrocarto.tooltip.topLines', 'Top contributing lines'));
      tooltip.appendChild(listHeading);
      var ul = htmlEl('ul', { class: 'astrocarto-tip__list' });
      for (var i = 0; i < cell.top.length; i += 1) {
        var c = cell.top[i];
        var planetLbl = tr('natal.planets.' + c.planet.toLowerCase(), c.planet);
        var typeLbl   = tr('natal.astrocarto.lineTypes.' + c.type.toLowerCase(), c.type);
        var li = htmlEl('li');
        var swatch = htmlEl('span', { class: 'astrocarto-tip__swatch' });
        swatch.style.background = planetTokenColor(c.planet);
        li.appendChild(swatch);
        li.appendChild(document.createTextNode(planetLbl + ' ' + typeLbl + ' — ' + c.distance + ' km'));
        ul.appendChild(li);
      }
      tooltip.appendChild(ul);
    } else {
      tooltip.appendChild(htmlEl('div', { class: 'astrocarto-tip__empty' },
        tr('natal.astrocarto.tooltip.noLines', 'No major lines nearby')));
    }
  }

  function formatLat(lat) {
    var n = Math.abs(lat).toFixed(1);
    return n + '° ' + (lat >= 0 ? 'N' : 'S');
  }
  function formatLon(lon) {
    var w = ((lon + 180) % 360 + 360) % 360 - 180;
    var n = Math.abs(w).toFixed(1);
    return n + '° ' + (w >= 0 ? 'E' : 'W');
  }

  // Convert [[lon, lat], ...] to an SVG path "M ... L ... L ..." string.
  // Splits where adjacent vertices wrap > 180° apart (antimeridian).
  function polylineToPathD(points) {
    if (!points || points.length < 2) return '';
    var d = '';
    var open = false;
    for (var i = 0; i < points.length; i += 1) {
      var pt = points[i];
      var prev = points[i - 1];
      var jump = (i > 0 && Math.abs(pt[0] - prev[0]) > 180);
      if (!open || jump) {
        d += (d ? ' ' : '') + 'M' + lon2x(pt[0]).toFixed(1) + ' ' + lat2y(pt[1]).toFixed(1);
        open = true;
      } else {
        d += ' L' + lon2x(pt[0]).toFixed(1) + ' ' + lat2y(pt[1]).toFixed(1);
      }
    }
    return d;
  }

  // Mode weights are no longer duplicated here — the API ships them in the
  // response (`response.modeWeights`, see /api/_lib/astrocarto.js#L485) and
  // the renderer / legend read from there. Single source of truth.

  // ---------- Legend ----------

  function renderLegend(container, mode, response) {
    if (!container) return;
    removeAllChildren(container);
    var weights = (response && response.modeWeights) || {};
    // Top 5 planets by weight.
    var ordered = Object.keys(weights)
      .map(function (k) { return { planet: k, weight: weights[k] }; })
      .filter(function (p) { return p.weight >= 0.5; })
      .sort(function (a, b) { return b.weight - a.weight; })
      .slice(0, 6);

    var planetsWrap = htmlEl('div', { class: 'astrocarto-legend__planets' });
    planetsWrap.appendChild(htmlEl('span', { class: 'astrocarto-legend__title' },
      tr('natal.astrocarto.legend.planets', 'Planets')));
    for (var i = 0; i < ordered.length; i += 1) {
      var p = ordered[i];
      var item = htmlEl('span', { class: 'astrocarto-legend__planet' });
      var swatch = htmlEl('span', { class: 'astrocarto-legend__swatch' });
      swatch.style.background = planetTokenColor(p.planet);
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(
        tr('natal.planets.' + p.planet.toLowerCase(), p.planet)
      ));
      planetsWrap.appendChild(item);
    }
    container.appendChild(planetsWrap);

    // Line types
    var typesWrap = htmlEl('div', { class: 'astrocarto-legend__types' });
    typesWrap.appendChild(htmlEl('span', { class: 'astrocarto-legend__title' },
      tr('natal.astrocarto.legend.lines', 'Lines')));
    var types = ['MC', 'IC', 'AC', 'DC'];
    for (var t = 0; t < types.length; t += 1) {
      var tp = types[t];
      var typeItem = htmlEl('span', { class: 'astrocarto-legend__type' });
      var sample = htmlEl('span', { class: 'astrocarto-legend__line astrocarto-legend__line--' + tp.toLowerCase() });
      typeItem.appendChild(sample);
      typeItem.appendChild(document.createTextNode(
        ' ' + tr('natal.astrocarto.lineTypes.' + tp.toLowerCase() + 'Long', tp)
      ));
      typesWrap.appendChild(typeItem);
    }
    container.appendChild(typesWrap);

    // Heat scale
    var heatWrap = htmlEl('div', { class: 'astrocarto-legend__heat' });
    heatWrap.appendChild(htmlEl('span', { class: 'astrocarto-legend__title' },
      tr('natal.astrocarto.legend.heat', 'Heat scale')));
    var bar = htmlEl('span', { class: 'astrocarto-legend__heatbar' });
    heatWrap.appendChild(bar);
    heatWrap.appendChild(htmlEl('span', { class: 'astrocarto-legend__heatlabels' },
      tr('natal.astrocarto.legend.heatLabels', 'Lower ▸ Higher')));
    container.appendChild(heatWrap);
  }

  // ---------- Tab-driven loader ----------

  // We expose a single global. The natal bootstrap calls setNatalSource()
  // each time it has a valid payload; the renderer caches per-mode responses
  // and clears the cache when the source payload changes.
  var lastSourceKey = '';
  var responseCache = {};   // mode → JSON
  var pendingFetches = {};  // mode → Promise

  function canonicalKey(payload) {
    // Stable key from the fields that affect astrocarto output.
    return [payload.date, payload.time, payload.tz, payload.lat, payload.lon].join('|');
  }

  function fetchAstrocarto(mode) {
    var src = window.__astrocarto && window.__astrocarto.payload;
    if (!src) return Promise.reject(new Error('no-natal-source'));
    // Astrocartography requires a known birth time — the four angular lines
    // pivot on GMST at the birth instant, and a 4-minute time uncertainty
    // shifts MC/IC lines ~1° (~110 km). Fail loudly so the panel surfaces a
    // helpful error rather than 400 from the API.
    if (src.unknownTime) {
      return Promise.reject(new Error('unknown-time'));
    }
    var key = canonicalKey(src);
    if (key !== lastSourceKey) {
      // Birth data changed — invalidate every cached response.
      responseCache = {};
      pendingFetches = {};
      lastSourceKey = key;
    }
    if (responseCache[mode]) return Promise.resolve(responseCache[mode]);
    if (pendingFetches[mode]) return pendingFetches[mode];

    // Only include `ayanamsa` when sidereal — the API validator rejects the
    // field for tropical charts (see /api/_lib/astrocarto.js schema).
    var tradition = src.tradition || 'sidereal';
    var body = {
      date: src.date,
      time: src.time,
      tz: src.tz,
      lat: src.lat,
      lon: src.lon,
      tradition: tradition,
      mode: mode,
      resolution: 'medium'
    };
    if (tradition === 'sidereal') {
      body.ayanamsa = src.ayanamsa || 'lahiri';
    }
    pendingFetches[mode] = fetch('/api/astrocarto/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (txt) { throw new Error('API ' + r.status + ': ' + txt.slice(0, 160)); });
        return r.json();
      })
      .then(function (json) {
        responseCache[mode] = json;
        delete pendingFetches[mode];
        return json;
      })
      .catch(function (err) {
        delete pendingFetches[mode];
        throw err;
      });
    return pendingFetches[mode];
  }

  function setBusy(panel, busy) {
    panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    var loader = panel.querySelector('[data-astrocarto-loader]');
    if (loader) loader.hidden = !busy;
    var err = panel.querySelector('[data-astrocarto-error]');
    if (err) err.hidden = true;
  }
  function setError(panel, message) {
    panel.setAttribute('aria-busy', 'false');
    var loader = panel.querySelector('[data-astrocarto-loader]');
    if (loader) loader.hidden = true;
    var err = panel.querySelector('[data-astrocarto-error]');
    if (err) {
      err.hidden = false;
      err.textContent = message || tr('natal.astrocarto.error',
        'Sorry — we could not load the astrocartography map. Please try again.');
    }
  }

  function loadAndRenderInto(panel) {
    var mode = panel.getAttribute('data-astrocarto');
    if (!mode) return;
    var mapEl = panel.querySelector('[data-astrocarto-map]');
    var legendEl = panel.querySelector('[data-astrocarto-legend]');
    if (!mapEl) return;
    setBusy(panel, true);
    fetchAstrocarto(mode)
      .then(function (json) {
        setBusy(panel, false);
        renderMap(mapEl, json, mode);
        if (legendEl) renderLegend(legendEl, mode, json);
        panel.setAttribute('data-astrocarto-loaded', '1');
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        if (window.console && console.warn) console.warn('[astrocarto] load', err);
        var msg = null;
        if (err && err.message === 'unknown-time') {
          msg = tr('natal.astrocarto.errorUnknownTime',
            'Astrocartography needs your birth time. Please enter your exact birth time above to see this map.');
        } else if (err && err.message === 'no-natal-source') {
          msg = tr('natal.astrocarto.errorNoSource',
            'Please calculate your natal chart first — the map needs your birth details.');
        }
        setError(panel, msg);
      });
  }

  // ---------- Public API ----------

  window.__astrocarto = window.__astrocarto || {
    payload: null,
    setNatalSource: function (payload) {
      if (!payload) return;
      var newKey = canonicalKey(payload);
      var oldKey = window.__astrocarto.payload ? canonicalKey(window.__astrocarto.payload) : '';
      window.__astrocarto.payload = payload;
      if (newKey !== oldKey) {
        // Source changed — invalidate caches and force any already-loaded
        // panels to refresh on next activation.
        responseCache = {};
        pendingFetches = {};
        lastSourceKey = newKey;
        document.querySelectorAll('[data-astrocarto][data-astrocarto-loaded="1"]').forEach(function (p) {
          p.removeAttribute('data-astrocarto-loaded');
          // Re-load eagerly only if the tab is currently visible.
          if (!p.hidden) loadAndRenderInto(p);
        });
      }
    }
  };

  // ---------- Auto-bind ----------

  function bindTab(tab) {
    var panelId = tab.getAttribute('aria-controls');
    if (!panelId) return;
    var panel = document.getElementById(panelId);
    if (!panel || !panel.hasAttribute('data-astrocarto')) return;

    function maybeLoad() {
      if (panel.getAttribute('data-astrocarto-loaded') === '1') return;
      if (tab.getAttribute('aria-selected') !== 'true') return;
      loadAndRenderInto(panel);
    }
    // Tab clicks
    tab.addEventListener('click', function () {
      // The tablist behavior toggles aria-selected synchronously before our
      // listener fires (we added click after the binder); read after a tick.
      setTimeout(maybeLoad, 0);
    });
    // Keyboard activation (ArrowKeys + auto-activate via tablist)
    tab.addEventListener('keyup', function () { setTimeout(maybeLoad, 0); });
    // If a tab is the default-active on load and is an astrocarto panel,
    // load on init.
    if (tab.getAttribute('aria-selected') === 'true') {
      setTimeout(maybeLoad, 0);
    }
  }

  function init() {
    // The natal bootstrap may have already rendered the default chart
    // before this deferred script attached. It stashes the chart's input
    // payload on window.__astrocartoPending; pick it up so the first tab
    // activation has a source to fetch.
    if (window.__astrocartoPending) {
      try { window.__astrocarto.setNatalSource(window.__astrocartoPending); } catch (e) {}
      delete window.__astrocartoPending;
    }

    var tabs = document.querySelectorAll('[role="tab"][aria-controls]');
    for (var i = 0; i < tabs.length; i += 1) bindTab(tabs[i]);

    // Defensive: re-render the active astrocarto panel on viewport theme
    // changes so the heat colors update (--heat-* tokens may shift if the
    // user switches themes).
    var mql;
    try { mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', function () {
        document.querySelectorAll('[data-astrocarto][data-astrocarto-loaded="1"]').forEach(function (p) {
          if (!p.hidden) loadAndRenderInto(p);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
