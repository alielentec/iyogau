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
 *  RENDER COMPOSITION (ported from ast/src/components/WorldMap.jsx)
 *  ---------------------------------------------------------------------
 *  Three SVG layers, stacked back→front:
 *
 *    1. Ocean background <rect> + graticule lines.
 *    2. Heat-matrix cells as plain <rect>s, ONE per (lat,lon) sample,
 *       clipped to land via <clipPath> built from continent polygons.
 *       This is the same vector-cell approach the React reference uses;
 *       we tried marching-squares contour bands and reverted because the
 *       cell mosaic reads more clearly at the 4° resolution our API ships.
 *    3. Continent borders drawn as a stroked <path> on top of the heat.
 *    4. Planet lines (MC/IC/AC/DC) as colored <path>s on top.
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
  //
  // Equirectangular projection (Plate carrée). Mathematically exact, fully
  // invertible. (x, y) in viewport pixels ↔ (lon, lat) in degrees.
  //
  // Forward:
  //   x = (lon + 180) / 360 * W
  //   y = (90 - lat) / 180 * H        (north-up; y=0 at lat=90, y=H at lat=-90)
  //
  // Inverse (used by the tooltip + hover-explain path):
  //   lon = x / W * 360 - 180
  //   lat = 90 - y / H * 180
  //
  // Round-trip: lonOfX(xOfLon(λ)) === λ to floating-point precision,
  // and likewise for lat. The tooltip + cell-lookup paths use the same
  // inverse to recover (lat, lon) from a mouse pointer — see showTooltipFor()
  // in renderMap() below.
  //
  // SVG viewBox is 800×400, so the per-axis scale is 800/360 = 400/180 =
  // 2.2222… — same factor on both axes, i.e. square pixels.
  var VIEW_W = 800;
  var VIEW_H = 400;
  function xOfLon(lon) { return (lon + 180) / 360 * VIEW_W; }
  function yOfLat(lat) { return (90 - lat) / 180 * VIEW_H; }
  function lonOfX(x)   { return x / VIEW_W * 360 - 180; }
  function latOfY(y)   { return 90 - y / VIEW_H * 180; }
  // Shorter aliases kept for the existing call sites in this file.
  var lon2x = xOfLon, lat2y = yOfLat, x2lon = lonOfX, y2lat = latOfY;

  // Runtime self-check of the round-trip projection identities. Gated on
  // ?astrocartoDebug=1 so production isn't polluted with console.assert.
  function runProjectionSelfCheck() {
    var ok = true;
    var maxDelta = 0;
    for (var i = -180; i <= 180; i += 30) {
      var d1 = Math.abs(lonOfX(xOfLon(i)) - i);
      console.assert(d1 < 1e-9, '[astrocarto] lon round-trip failed at ' + i + ' Δ=' + d1);
      if (d1 >= 1e-9) ok = false;
      if (d1 > maxDelta) maxDelta = d1;
    }
    for (var j = -90; j <= 90; j += 30) {
      var d2 = Math.abs(latOfY(yOfLat(j)) - j);
      console.assert(d2 < 1e-9, '[astrocarto] lat round-trip failed at ' + j + ' Δ=' + d2);
      if (d2 >= 1e-9) ok = false;
      if (d2 > maxDelta) maxDelta = d2;
    }
    if (window.console && console.info) {
      console.info('[astrocarto] projection self-check ' + (ok ? 'OK' : 'FAILED') +
        ' — max round-trip error: ' + maxDelta.toExponential(2) + '°');
    }
    return ok;
  }

  // ---------- Gaussian smoothing of the heat-matrix score field ----------
  //
  // After the heat matrix arrives from the API we apply a 2D Gaussian blur to
  // the raw scores. The smoothing is purely cosmetic — it makes the gradient
  // continuous instead of stair-stepped — and crucially DOES NOT invent
  // information:
  //
  //   - Each smoothed cell is a local weighted average of nearby cells.
  //   - σ is exposed in the UI ("Gaussian blur σ = N° latitude") so the
  //     user knows exactly how much smoothing was applied.
  //
  // σ = 1.5 cells ≈ 6° of lat/lon at the default 4° grid → ~660 km on Earth's
  // surface, comparable to the LINE_INFLUENCE_KM = 1100 km already used by
  // the scoring kernel in /api/_lib/astrocarto.js. The blur is therefore
  // consistent with the existing physical orb of influence — it does NOT
  // extend that influence beyond what the scoring already implies.
  //
  // Kernel: discrete 1D Gaussian, radius 3σ → clamp to a max of 5 cells
  // either side for performance. The convolution is separable: pass 1 blurs
  // each row (longitude axis, wrap-around because longitude is periodic);
  // pass 2 blurs each column (latitude axis, clamp at poles — the world
  // does not wrap N↔S).
  var GAUSSIAN_SIGMA_CELLS = 1.5;
  function gaussianKernel(sigma) {
    if (sigma <= 0) return [1];
    var r = Math.min(5, Math.ceil(3 * sigma));
    var k = new Array(2 * r + 1);
    var sum = 0;
    var twoSig2 = 2 * sigma * sigma;
    for (var i = -r; i <= r; i += 1) {
      var w = Math.exp(-(i * i) / twoSig2);
      k[i + r] = w;
      sum += w;
    }
    for (var j = 0; j < k.length; j += 1) k[j] /= sum;
    return k;
  }
  function gaussian1D(arr, kernel, wrap) {
    var n = arr.length;
    var r = (kernel.length - 1) >> 1;
    var out = new Array(n);
    for (var i = 0; i < n; i += 1) {
      var acc = 0;
      var wAcc = 0;
      for (var k = -r; k <= r; k += 1) {
        var idx = i + k;
        if (wrap) {
          // Periodic wrap (longitude): ((idx % n) + n) % n
          idx = ((idx % n) + n) % n;
        } else if (idx < 0 || idx >= n) {
          // Clamp-to-edge (latitude: poles do not wrap N↔S)
          idx = (idx < 0) ? 0 : (n - 1);
        }
        var v = arr[idx];
        if (v == null || !isFinite(v)) continue;
        var w = kernel[k + r];
        acc += v * w;
        wAcc += w;
      }
      out[i] = (wAcc > 0) ? (acc / wAcc) : arr[i];
    }
    return out;
  }
  function gaussianBlur2D(matrix, sigmaCells) {
    if (!matrix || !matrix.length || !matrix[0] || !matrix[0].length) return matrix;
    var kernel = gaussianKernel(sigmaCells);
    var h = matrix.length;
    var w = matrix[0].length;
    // Pass 1: blur each row (longitude axis, wrap-around)
    var rowBlurred = new Array(h);
    for (var r = 0; r < h; r += 1) {
      rowBlurred[r] = gaussian1D(matrix[r], kernel, true);
    }
    // Pass 2: blur each column (latitude axis, clamp at poles)
    var out = new Array(h);
    for (var r2 = 0; r2 < h; r2 += 1) out[r2] = new Array(w);
    for (var c = 0; c < w; c += 1) {
      var col = new Array(h);
      for (var rr = 0; rr < h; rr += 1) col[rr] = rowBlurred[rr][c];
      var blurredCol = gaussian1D(col, kernel, false);
      for (var rr2 = 0; rr2 < h; rr2 += 1) out[rr2][c] = blurredCol[rr2];
    }
    return out;
  }

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

  // ---------- Heat-matrix color (ast/ palette: deep blue → red) ----------
  //
  // The ast/ reference uses an 8-stop ramp that runs from the abyssal-blue
  // background through tropical cyan / lime / yellow into orange and red.
  // We mirror that ramp exactly so the iyogau map reads identically.
  var HEAT_STOPS = [
    { v: 0,   color: '#071331' },
    { v: 18,  color: '#073a98' },
    { v: 34,  color: '#008df8' },
    { v: 48,  color: '#00d8c7' },
    { v: 62,  color: '#55f03a' },
    { v: 76,  color: '#fff12b' },
    { v: 88,  color: '#ff8a00' },
    { v: 100, color: '#f01818' }
  ];
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
  function colorForValue(value) {
    var score = Math.max(0, Math.min(100, value));
    for (var i = 0; i < HEAT_STOPS.length - 1; i += 1) {
      var a = HEAT_STOPS[i];
      var b = HEAT_STOPS[i + 1];
      if (score >= a.v && score <= b.v) {
        var t = (score - a.v) / (b.v - a.v);
        var ra = parseColor(a.color);
        var rb = parseColor(b.color);
        var r = Math.round(ra[0] + (rb[0] - ra[0]) * t);
        var g = Math.round(ra[1] + (rb[1] - ra[1]) * t);
        var bv = Math.round(ra[2] + (rb[2] - ra[2]) * t);
        return 'rgb(' + r + ',' + g + ',' + bv + ')';
      }
    }
    return HEAT_STOPS[HEAT_STOPS.length - 1].color;
  }
  // Opacity ramp from ast/'s WorldMap.jsx (line 148): 0.54 + min(0.34, v/220).
  // Keeps low-value cells faint while letting hot zones ride bright; the
  // clip-to-land mask prevents the faint blue blocks from oversaturating
  // the ocean.
  function cellOpacity(value) {
    return 0.54 + Math.min(0.34, value / 220);
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

  // ---------- SVG continent path (continuous outline + clip-path source) -

  // Each continent in IYOGAU_WORLD_CONTINENTS contributes one closed subpath.
  // Returned string is shared by the visible outline and the <clipPath>.
  function continentsPathD(polygons) {
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
  //
  // Composition mirrors ast/src/components/WorldMap.jsx:
  //   1. Ocean rect.
  //   2. Faint graticule grid.
  //   3. <defs><clipPath> built from continent polygons.
  //   4. Heat-matrix cells as <rect>s, clip-pathed to land.
  //   5. Continent outlines on top (no fill, dark stroke).
  //   6. Planet lines colored per planet, dashed per line type.
  //   7. Transparent pointer-capture rect for tooltip.

  function renderMap(container, response, mode) {
    if (!container || !response) return;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    removeAllChildren(container);

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

    // ---- Graticule (30° grid) ----
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

    // ---- Continent CLIP MASK + outline path (shared `d`) ----
    // We need ONE unique clipPath id per panel so multiple maps on the page
    // (when running in dev test harnesses) don't collide.
    var continents = window.IYOGAU_WORLD_CONTINENTS || [];
    var landPathD = continents.length ? continentsPathD(continents) : '';
    var clipId = 'astrocarto-land-' + mode + '-' + Math.random().toString(36).slice(2, 8);
    if (landPathD) {
      var defs = svgEl('defs');
      var clip = svgEl('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      clip.appendChild(svgEl('path', { d: landPathD, 'fill-rule': 'nonzero' }));
      defs.appendChild(clip);
      svg.appendChild(defs);
    }

    // ---- Heat matrix → per-cell <rect>s, clipped to land ----
    // Response shape (from /api/astrocarto):
    //   heatMatrix.latitudes   = [lat_0, lat_1, ...]    (length R)
    //   heatMatrix.longitudes  = [lon_0, lon_1, ...]    (length C)
    //   heatMatrix.values      = R × C array of numbers 0..100
    //   heatMatrix.cellMeta    = R × C array of top-3 contributors
    var hm = response.heatMatrix || {};
    var latitudes = hm.latitudes || [];
    var longitudes = hm.longitudes || [];
    var rawValues = hm.values || [];
    var cellMeta = hm.cellMeta || [];
    var latStep = hm.latStep || (latitudes.length > 1 ? Math.abs(latitudes[1] - latitudes[0]) : 4);
    var lonStep = hm.lonStep || (longitudes.length > 1 ? Math.abs(longitudes[1] - longitudes[0]) : 4);

    // ---- Gaussian smoothing of the score field ----
    // We blur the score matrix (NOT the per-cell metadata) so the rendered
    // gradient looks continuous instead of stair-stepped. The tooltip still
    // reports the RAW per-cell value and contributing lines, so the user
    // sees honest data on hover even though the visual is smoothed.
    var sigmaCells = GAUSSIAN_SIGMA_CELLS;
    var values = gaussianBlur2D(rawValues, sigmaCells);
    var sigmaDegrees = sigmaCells * latStep;
    // Surface σ in the DOM so the legend caption and verification scripts
    // can read the exact smoothing amount applied to this render.
    container.setAttribute('data-astrocarto-sigma-cells', sigmaCells.toFixed(2));
    container.setAttribute('data-astrocarto-sigma-degrees', sigmaDegrees.toFixed(2));

    var heatG = svgEl('g', {
      class: 'astrocarto-heat',
      'aria-hidden': 'true'
    });
    if (landPathD) heatG.setAttribute('clip-path', 'url(#' + clipId + ')');

    if (latitudes.length && longitudes.length && values.length) {
      // Each cell spans (lat .. lat+latStep) × (lon .. lon+lonStep). We add
      // a tiny 0.8px overdraw on width/height (matching ast/'s WorldMap line
      // 136) so the cells abut without sub-pixel seams.
      var cellW = (VIEW_W / 360) * lonStep + 0.8;
      var cellH = (VIEW_H / 180) * latStep + 0.8;
      for (var r = 0; r < latitudes.length; r += 1) {
        var rowLat = latitudes[r];
        var rowVals = values[r];
        if (!rowVals) continue;
        // The matrix is stored south→north (latitudes[0] = south); SVG y
        // grows downward, so the rect's top-edge sits at lat2y(rowLat + step).
        var y = lat2y(rowLat + latStep);
        for (var c = 0; c < longitudes.length; c += 1) {
          var v = rowVals[c];
          if (v == null) continue;
          var x = lon2x(longitudes[c]);
          heatG.appendChild(svgEl('rect', {
            x: x.toFixed(2),
            y: y.toFixed(2),
            width: cellW.toFixed(2),
            height: cellH.toFixed(2),
            fill: colorForValue(v),
            'fill-opacity': cellOpacity(v).toFixed(3),
            class: 'astrocarto-cell'
          }));
        }
      }
    }
    svg.appendChild(heatG);

    // ---- Continent outlines (rendered ABOVE the heat cells, no fill) ----
    if (landPathD) {
      var land = svgEl('path', {
        d: landPathD,
        class: 'astrocarto-land',
        'aria-hidden': 'true',
        'fill-rule': 'nonzero'
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
      var dl = polylineToPathD(line.points);
      if (!dl) continue;
      var path = svgEl('path', {
        d: dl,
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
      var ri = Math.round((latP - lat0) / latStep);
      var ci = Math.round((lonP - lon0) / lonStep);
      if (ri < 0) ri = 0; else if (ri >= latitudes.length) ri = latitudes.length - 1;
      if (ci < 0) ci = 0; else if (ci >= longitudes.length) ci = longitudes.length - 1;
      // Tooltip reports the RAW per-cell score and contributing lines
      // (not the smoothed value), so the user sees honest data on hover even
      // though the visual gradient is Gaussian-smoothed for readability.
      var rowVRaw = rawValues[ri] || [];
      var rowVSmooth = values[ri] || [];
      var rowM = cellMeta[ri] || [];
      var match = {
        lat: latitudes[ri],
        lon: longitudes[ci],
        value: rowVRaw[ci],
        smoothed: rowVSmooth[ci],
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

    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      // Surface the render time in DOM so verification scripts can read it.
      container.setAttribute('data-render-ms', String(Math.round(t1 - t0)));
      if (window.console && console.debug) console.debug('[astrocarto] render', mode, (t1 - t0).toFixed(1) + 'ms');
    } catch (e) {}
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

    // Gaussian smoothing caption — exposes σ so the user knows exactly how
    // much the visual gradient was smoothed. The number is purely cosmetic
    // (the tooltip continues to report RAW per-cell scores), but it must be
    // visible so the smoothing isn't mistaken for new information.
    var hm = (response && response.heatMatrix) || {};
    var latStep = hm.latStep ||
      (hm.latitudes && hm.latitudes.length > 1 ? Math.abs(hm.latitudes[1] - hm.latitudes[0]) : 4);
    var sigmaDeg = (GAUSSIAN_SIGMA_CELLS * latStep).toFixed(1);
    var sigmaTemplate = tr(
      'natal.astrocarto.legend.smoothingCaption',
      'Heat field smoothed via Gaussian blur (σ = {sigma}° lat/lon).'
    );
    var smoothWrap = htmlEl('div', { class: 'astrocarto-legend__smoothing' });
    smoothWrap.appendChild(document.createTextNode(
      sigmaTemplate.replace('{sigma}', sigmaDeg)
    ));
    container.appendChild(smoothWrap);
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

  // Resolution tier: request `high` on desktop, `medium` on phones. The
  // viewport boundary matches the standard Tailwind / Bootstrap "sm" break,
  // which lines up with where the natal-chart UI shifts from single-column
  // (mobile) to two-column (desktop). A coarser grid on mobile keeps the
  // payload + render time within budget for slow networks and older phones.
  function pickResolution() {
    try {
      if (window.matchMedia && window.matchMedia('(min-width: 640px)').matches) {
        return 'high';
      }
    } catch (e) {}
    return 'medium';
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
    var resolution = pickResolution();
    // Cache key includes resolution so a resize from mobile→desktop doesn't
    // serve a stale low-res payload.
    var key = canonicalKey(src) + '|' + resolution;
    if (key !== lastSourceKey) {
      // Birth data or viewport changed — invalidate every cached response.
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
      resolution: resolution
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
        lastSourceKey = '';
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
    // Projection round-trip self-check (only when ?astrocartoDebug=1) — fails
    // loudly via console.assert if the equirectangular forward/inverse pair
    // ever drifts (e.g. somebody changes VIEW_W without updating the inverse).
    try {
      var qsInit = (window.location && window.location.search) ? window.location.search : '';
      if (qsInit.indexOf('astrocartoDebug=1') >= 0 || window.__astrocartoDebug === true) {
        runProjectionSelfCheck();
      }
    } catch (e) {}

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

    // Re-fetch when crossing the desktop/mobile breakpoint so the resolution
    // tier matches the new viewport. We invalidate the cache via setNatalSource
    // re-trigger — same path as the form submit.
    try {
      var widthMql = window.matchMedia && window.matchMedia('(min-width: 640px)');
      if (widthMql && widthMql.addEventListener) {
        widthMql.addEventListener('change', function () {
          // Force a cache miss next fetch by clearing the lastSourceKey.
          lastSourceKey = '';
          responseCache = {};
          pendingFetches = {};
          document.querySelectorAll('[data-astrocarto][data-astrocarto-loaded="1"]').forEach(function (p) {
            p.removeAttribute('data-astrocarto-loaded');
            if (!p.hidden) loadAndRenderInto(p);
          });
        });
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Verification hook: only exposed when the page URL carries ?astrocartoDebug=1
  // so the production bundle keeps a single closed entry point. The internal
  // renderMap / renderLegend are tested by /_test-astrocarto.html during the
  // local verification pass — see TODO/PLAN.md.
  try {
    var qs = (window.location && window.location.search) ? window.location.search : '';
    if (qs.indexOf('astrocartoDebug=1') >= 0 || (window.__astrocartoDebug === true)) {
      window.__debug_astrocarto_renderMap = renderMap;
      window.__debug_astrocarto_renderLegend = renderLegend;
      // Projection + smoothing helpers, exposed for the in-browser
      // verification pass. Read-only — callers can compose their own tests.
      window.__debug_astrocarto_projection = {
        xOfLon: xOfLon, yOfLat: yOfLat,
        lonOfX: lonOfX, latOfY: latOfY,
        VIEW_W: VIEW_W, VIEW_H: VIEW_H,
        runSelfCheck: runProjectionSelfCheck
      };
      window.__debug_astrocarto_smoothing = {
        sigmaCells: GAUSSIAN_SIGMA_CELLS,
        gaussianKernel: gaussianKernel,
        gaussian1D: gaussian1D,
        gaussianBlur2D: gaussianBlur2D
      };
    }
  } catch (e) {}
}());
