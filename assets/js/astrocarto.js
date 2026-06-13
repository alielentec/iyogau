/* =====================================================================
 *  astrocarto.js
 *  ---------------------------------------------------------------------
 *  Client-side renderer for the astrocartography world maps shown in the
 *  natal-chart astrocartography tabs (Relocation / Immigration / Soulmate
 *  plus the date-slider Soulmate Timing layer).
 *
 *  Data flow:
 *
 *    homepage-natal-form bootstrap
 *        ▼
 *    POST /api/calculate-chart       (already wired)
 *        ▼
 *    window.__astrocarto.setNatalSource(payload)   <-- expose form payload
 *        ▼
 *    User clicks an astrocartography tab
 *        ▼
 *    POST /api/astrocarto  {date,time,tz,mode,targetDate?}
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
 *       we tried marching-squares contour bands and reverted because exact
 *       center-sampled cells make lat/lon alignment directly inspectable.
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function validLonLat(point) {
    return Array.isArray(point) &&
      point.length >= 2 &&
      typeof point[0] === 'number' &&
      typeof point[1] === 'number' &&
      isFinite(point[0]) &&
      isFinite(point[1]);
  }

  function antimeridianCrossing(a, b) {
    var delta = b[0] - a[0];
    if (Math.abs(delta) <= 180) return null;

    var edgeFrom;
    var edgeTo;
    var bLonUnwrapped;
    if (delta > 180) {
      // Example: -179 → +179 is a short westward crossing through -180.
      bLonUnwrapped = b[0] - 360;
      edgeFrom = -180;
      edgeTo = 180;
    } else {
      // Example: +179 → -179 is a short eastward crossing through +180.
      bLonUnwrapped = b[0] + 360;
      edgeFrom = 180;
      edgeTo = -180;
    }

    var denom = bLonUnwrapped - a[0];
    var t = Math.abs(denom) < 1e-12 ? 0 : (edgeFrom - a[0]) / denom;
    t = clamp(t, 0, 1);
    var lat = a[1] + (b[1] - a[1]) * t;
    return {
      from: [edgeFrom, lat],
      to: [edgeTo, lat]
    };
  }

  function svgCoord(value) {
    var n = Number(value);
    if (Math.abs(n) < 0.0000005) n = 0;
    return n.toFixed(6);
  }

  function appendMove(path, point) {
    return path + (path ? ' ' : '') + 'M' + svgCoord(lon2x(point[0])) + ' ' + svgCoord(lat2y(point[1]));
  }

  function appendLine(path, point) {
    return path + ' L' + svgCoord(lon2x(point[0])) + ' ' + svgCoord(lat2y(point[1]));
  }

  function lonLatPathD(points, opts) {
    if (!points || points.length < 2) return '';
    var closed = !!(opts && opts.closed);
    var closeSubpaths = !!(opts && opts.closeSubpaths);
    var d = '';
    var open = false;
    var subpathPoints = 0;
    var first = null;
    var subpathStart = null;
    var currentPoint = null;
    var prev = null;

    function polarClosureLatitude(a, b) {
      var crossesWholeMap = Math.abs(lon2x(a[0]) - lon2x(b[0])) > VIEW_W / 2;
      if (!crossesWholeMap) return null;
      var bothAtEdges = Math.abs(Math.abs(a[0]) - 180) < 1e-9 && Math.abs(Math.abs(b[0]) - 180) < 1e-9;
      if (!bothAtEdges) return null;
      if (a[1] < -80 && b[1] < -80) return -90;
      if (a[1] > 80 && b[1] > 80) return 90;
      return null;
    }

    function closeCurrent() {
      if (open && closeSubpaths && subpathPoints >= 3) {
        var poleLat = subpathStart && currentPoint ? polarClosureLatitude(currentPoint, subpathStart) : null;
        if (poleLat !== null) {
          d = appendLine(d, [currentPoint[0], poleLat]);
          d = appendLine(d, [subpathStart[0], poleLat]);
          d = appendLine(d, subpathStart);
        }
        d += ' Z';
      }
      open = false;
      subpathPoints = 0;
      subpathStart = null;
      currentPoint = null;
    }
    function moveTo(point) {
      d = appendMove(d, point);
      open = true;
      subpathPoints = 1;
      subpathStart = point;
      currentPoint = point;
    }
    function lineTo(point) {
      if (!open) moveTo(point);
      else {
        d = appendLine(d, point);
        subpathPoints += 1;
        currentPoint = point;
      }
    }
    function segmentTo(point) {
      if (!prev) {
        moveTo(point);
        first = point;
        prev = point;
        return;
      }
      var crossing = antimeridianCrossing(prev, point);
      if (crossing) {
        lineTo(crossing.from);
        closeCurrent();
        moveTo(crossing.to);
        lineTo(point);
      } else {
        lineTo(point);
      }
      prev = point;
    }

    for (var i = 0; i < points.length; i += 1) {
      if (!validLonLat(points[i])) continue;
      segmentTo(points[i]);
    }
    if (closed && first && prev) {
      var closing = antimeridianCrossing(prev, first);
      if (closing) {
        lineTo(closing.from);
        closeCurrent();
        moveTo(closing.to);
        lineTo(first);
      } else if (prev[0] !== first[0] || prev[1] !== first[1]) {
        lineTo(first);
      }
    }
    closeCurrent();
    return d;
  }

  // ---------- Optional heat-matrix smoothing helper ----------
  //
  // Accuracy-first default: sigma is zero, so the rendered heat map uses the
  // raw equation score for each lat/lon cell. The Gaussian helper stays here
  // for explicit debug experiments only; production rendering must not
  // visually shift or average the API output.
  var GAUSSIAN_SIGMA_CELLS = 0;
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

  // Each continent in IYOGAU_WORLD_CONTINENTS contributes one projected
  // path. Rings that cross the antimeridian are split at ±180° so SVG never
  // draws a false horizontal chord across the whole map. That split is
  // critical because the heat clip, continent outline, and planet curves all
  // sit on the same equirectangular lat/lon grid.
  function continentsPathD(polygons, opts) {
    var parts = [];
    for (var i = 0; i < polygons.length; i += 1) {
      var poly = polygons[i];
      var rings = [];
      if (poly && poly.poly) rings.push(poly.poly);
      if (poly && Array.isArray(poly.holes)) {
        for (var h = 0; h < poly.holes.length; h += 1) rings.push(poly.holes[h]);
      }
      for (var r = 0; r < rings.length; r += 1) {
        var p = rings[r];
        if (!p || p.length < 3) continue;
        var seg = lonLatPathD(p, {
          closed: true,
          closeSubpaths: !!(opts && opts.closeSubpaths)
        });
        parts.push(seg);
      }
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
    // Clip paths must be closed for fill. The only allowed map-wide closure
    // is Antarctica's polar-cap ring at the bottom edge; render tests enforce
    // that no non-polar seam chord enters the hidden heat mask.
    var landClipPathD = continents.length ? continentsPathD(continents, { closeSubpaths: true }) : '';
    var landOutlinePathD = continents.length ? continentsPathD(continents, { closeSubpaths: false }) : '';
    var clipId = 'astrocarto-land-' + mode + '-' + Math.random().toString(36).slice(2, 8);
    if (landClipPathD) {
      var defs = svgEl('defs');
      var clip = svgEl('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      clip.appendChild(svgEl('path', { d: landClipPathD, 'fill-rule': 'evenodd' }));
      defs.appendChild(clip);
      svg.appendChild(defs);
    }

    // ---- Heat matrix → per-cell <rect>s, clipped to land ----
    // Response shape (from /api/astrocarto):
    //   heatMatrix.latitudes   = center latitudes [lat_0, ...]    (length R)
    //   heatMatrix.longitudes  = center longitudes [lon_0, ...]   (length C)
    //   heatMatrix.xCoordinates/yCoordinates = matching SVG center coords
    //   heatMatrix.values      = R × C array of numbers 0..100
    //   heatMatrix.cellMeta    = R × C array of top-3 contributors
    var hm = response.heatMatrix || {};
    var latitudes = hm.latitudes || [];
    var longitudes = hm.longitudes || [];
    var xCoordinates = hm.xCoordinates || [];
    var yCoordinates = hm.yCoordinates || [];
    var rawValues = hm.values || [];
    var cellMeta = hm.cellMeta || [];
    var latStep = hm.latStep || (latitudes.length > 1 ? Math.abs(latitudes[1] - latitudes[0]) : 4);
    var lonStep = hm.lonStep || (longitudes.length > 1 ? Math.abs(longitudes[1] - longitudes[0]) : 4);
    var coordinateRole = hm.coordinateRole || 'cell-center';

    // ---- Raw equation score field ----
    // Default sigma is zero, so `values` is the raw API matrix. If a developer
    // deliberately changes GAUSSIAN_SIGMA_CELLS for a debug pass, the DOM
    // exposes the exact sigma and the tooltip still reports raw per-cell data.
    var sigmaCells = GAUSSIAN_SIGMA_CELLS;
    var values = gaussianBlur2D(rawValues, sigmaCells);
    var sigmaDegrees = sigmaCells * latStep;
    // Surface sigma in the DOM for verification. The production value is
    // 0.00, which means no browser-side smoothing is applied.
    container.setAttribute('data-astrocarto-sigma-cells', sigmaCells.toFixed(2));
    container.setAttribute('data-astrocarto-sigma-degrees', sigmaDegrees.toFixed(2));

    var heatG = svgEl('g', {
      class: 'astrocarto-heat',
      'aria-hidden': 'true'
    });
    if (landClipPathD) heatG.setAttribute('clip-path', 'url(#' + clipId + ')');

    if (latitudes.length && longitudes.length && values.length) {
      // Server v1.1 emits center-sampled cells: the same center lat/lon is
      // used for equation input and SVG placement. Older edge-based payloads
      // are still rendered for local cache/backward compatibility.
      var baseCellW = (VIEW_W / 360) * lonStep;
      var baseCellH = (VIEW_H / 180) * latStep;
      var cellW = baseCellW;
      var cellH = baseCellH;
      for (var r = 0; r < latitudes.length; r += 1) {
        var rowLat = latitudes[r];
        var rowVals = values[r];
        if (!rowVals) continue;
        var centerY = (typeof yCoordinates[r] === 'number') ? yCoordinates[r] : lat2y(rowLat);
        var y = coordinateRole === 'cell-center'
          ? centerY - baseCellH / 2
          : lat2y(rowLat + latStep);
        for (var c = 0; c < longitudes.length; c += 1) {
          var v = rowVals[c];
          if (v == null) continue;
          var centerX = (typeof xCoordinates[c] === 'number') ? xCoordinates[c] : lon2x(longitudes[c]);
          var x = coordinateRole === 'cell-center'
            ? centerX - baseCellW / 2
            : lon2x(longitudes[c]);
          heatG.appendChild(svgEl('rect', {
            x: svgCoord(x),
            y: svgCoord(y),
            width: svgCoord(cellW),
            height: svgCoord(cellH),
            fill: colorForValue(v),
            'fill-opacity': cellOpacity(v).toFixed(3),
            class: 'astrocarto-cell'
          }));
        }
      }
    }
    svg.appendChild(heatG);

    // ---- Continent outlines (rendered ABOVE the heat cells, no fill) ----
    if (landOutlinePathD) {
      var land = svgEl('path', {
        d: landOutlinePathD,
        class: 'astrocarto-land',
        'aria-hidden': 'true',
        fill: 'none'
      });
      svg.appendChild(land);
    }

    // ---- Planet lines ----
    var lines = response.lines || [];
    var linesG = svgEl('g', { class: 'astrocarto-lines', 'aria-hidden': 'true' });
    // Render every line that contributes to the heat field. Hiding low-weight
    // contributors makes hot cells look misaligned with the displayed curves.
    // Source of truth is the API response (see /api/_lib/astrocarto.js).
    var modeWeights = response.modeWeights || {};
    for (var li = 0; li < lines.length; li += 1) {
      var line = lines[li];
      if ((modeWeights[line.planet] || 0) <= 0) continue;
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
    var timing = response.timing || null;
    var timingLines = timing && timing.lines ? timing.lines : [];
    var transitWeights = timing && timing.transitWeights ? timing.transitWeights : {};
    for (var ti = 0; ti < timingLines.length; ti += 1) {
      var tLine = timingLines[ti];
      if ((transitWeights[tLine.planet] || 0) <= 0) continue;
      var tPathD = polylineToPathD(tLine.points);
      if (!tPathD) continue;
      var tPath = svgEl('path', {
        d: tPathD,
        stroke: planetTokenColor(tLine.planet),
        'stroke-width': 1.05,
        fill: 'none',
        class: 'astrocarto-line astrocarto-line--timing astrocarto-line--' + tLine.type.toLowerCase(),
        'data-planet': tLine.planet,
        'data-type': tLine.type,
        'data-source': 'transit'
      });
      tPath.setAttribute('stroke-dasharray', '2.4 3.2');
      linesG.appendChild(tPath);
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
      // Tooltip reports the raw per-cell score and contributing lines.
      var rowVRaw = rawValues[ri] || [];
      var rowM = cellMeta[ri] || [];
      var match = {
        lat: latitudes[ri],
        lon: longitudes[ci],
        value: rowVRaw[ci],
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
        var sourceLbl = c.source === 'transit'
          ? tr('natal.astrocarto.tooltip.transitPrefix', 'Transit') + ' '
          : '';
        li.appendChild(document.createTextNode(sourceLbl + planetLbl + ' ' + typeLbl + ' — ' + c.distance + ' km'));
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
  // Splits where adjacent vertices wrap > 180° apart (antimeridian) and
  // inserts edge points at ±180° so curves touch the map edge accurately
  // instead of stopping short or drawing a false chord.
  function polylineToPathD(points) {
    return lonLatPathD(points, { closed: false, closeSubpaths: false });
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
      .filter(function (p) { return p.weight > 0; })
      .sort(function (a, b) { return b.weight - a.weight; });

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

    var rawWrap = htmlEl('div', { class: 'astrocarto-legend__note' });
    rawWrap.appendChild(document.createTextNode(
      tr('natal.astrocarto.legend.rawHeatCaption',
        'Heat cells show raw equation scores; no browser smoothing is applied.')
    ));
    container.appendChild(rawWrap);

    var provenance = (response && response.provenance) || {};
    var timing = (response && response.timing) || null;
    if (mode === 'soulmate_timing' && timing && timing.targetDate) {
      var timingWrap = htmlEl('div', { class: 'astrocarto-legend__note' });
      timingWrap.appendChild(document.createTextNode(
        tr('natal.astrocarto.legend.timingCaption',
          'Timing overlay for {date}: natal soulmate potential plus noon-UTC transit angular activation.')
          .replace('{date}', timing.targetDate)
      ));
      container.appendChild(timingWrap);
    }
    if (mode === 'immigration' && provenance.immigrationDistanceBasis === 'omitted') {
      var immigrationWrap = htmlEl('div', { class: 'astrocarto-legend__note' });
      immigrationWrap.appendChild(document.createTextNode(
        tr('natal.astrocarto.legend.immigrationResidenceOmitted',
          'Immigration distance-from-current-residence adjustment is omitted because no current residence was supplied.')
      ));
      container.appendChild(immigrationWrap);
    }
  }

  // ---------- Tab-driven loader ----------

  // We expose a single global. The natal bootstrap calls setNatalSource()
  // each time it has a valid payload; the renderer caches per-mode responses
  // and clears the cache when the source payload changes.
  var lastSourceKey = '';
  var responseCache = {};   // mode → JSON
  var pendingFetches = {};  // mode → Promise

  function currentResidenceKey(payload) {
    var r = payload && payload.currentResidence;
    if (!r) return '';
    return [r.lat, r.lon, r.city || '', r.country || ''].join(',');
  }

  function canonicalKey(payload) {
    // Stable key from the fields that affect astrocarto output.
    return [
      payload.date,
      payload.time,
      payload.tz,
      payload.lat,
      payload.lon,
      payload.tradition || 'sidereal',
      payload.ayanamsa || '',
      currentResidenceKey(payload)
    ].join('|');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function parseDateUTC(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))) return null;
    var parts = dateString.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    if (d.getUTCFullYear() !== parts[0] || d.getUTCMonth() !== parts[1] - 1 || d.getUTCDate() !== parts[2]) return null;
    return d;
  }

  function dateStringUTC(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function daysInUTCMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function addYearsClampedUTC(dateUTC, years) {
    var year = dateUTC.getUTCFullYear() + years;
    var month = dateUTC.getUTCMonth();
    var day = Math.min(dateUTC.getUTCDate(), daysInUTCMonth(year, month));
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  function addDaysUTC(dateUTC, days) {
    return new Date(Date.UTC(
      dateUTC.getUTCFullYear(),
      dateUTC.getUTCMonth(),
      dateUTC.getUTCDate() + days,
      12,
      0,
      0
    ));
  }

  function daysBetweenUTC(startUTC, endUTC) {
    var start = Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), startUTC.getUTCDate());
    var end = Date.UTC(endUTC.getUTCFullYear(), endUTC.getUTCMonth(), endUTC.getUTCDate());
    return Math.round((end - start) / 86400000);
  }

  function ageYearsForOffset(offsetDays) {
    return Math.round((Number(offsetDays) || 0) / 365.2425 * 100) / 100;
  }

  function timelineBoundsForSource(src) {
    var start = parseDateUTC(src && src.date);
    if (!start) return null;
    var end = addYearsClampedUTC(start, 50);
    var todayRaw = new Date();
    var today = new Date(Date.UTC(todayRaw.getFullYear(), todayRaw.getMonth(), todayRaw.getDate(), 12, 0, 0));
    var totalDays = daysBetweenUTC(start, end);
    var defaultOffset = clamp(daysBetweenUTC(start, today), 0, totalDays);
    return {
      sourceDate: src.date,
      start: start,
      end: end,
      startDate: dateStringUTC(start),
      endDate: dateStringUTC(end),
      totalDays: totalDays,
      defaultOffset: defaultOffset
    };
  }

  function dateStringFromTimelineOffset(bounds, offsetDays) {
    return dateStringUTC(addDaysUTC(bounds.start, clamp(Math.round(Number(offsetDays) || 0), 0, bounds.totalDays)));
  }

  function timingTargetDateForPanel(panel) {
    if (!panel || panel.getAttribute('data-astrocarto') !== 'soulmate_timing') return null;
    var src = window.__astrocarto && window.__astrocarto.payload;
    var bounds = timelineBoundsForSource(src);
    if (!bounds) return null;
    var slider = panel.querySelector('[data-astrocarto-date-slider]');
    var offset = slider ? Number(slider.value) : bounds.defaultOffset;
    if (slider) {
      var existingKey = slider.getAttribute('data-astrocarto-timeline-source');
      if (existingKey !== bounds.sourceDate) {
        slider.setAttribute('min', '0');
        slider.setAttribute('max', String(bounds.totalDays));
        slider.setAttribute('step', '7');
        slider.value = String(bounds.defaultOffset);
        slider.setAttribute('data-astrocarto-timeline-source', bounds.sourceDate);
        offset = bounds.defaultOffset;
      } else if (offset < 0 || offset > bounds.totalDays) {
        offset = clamp(offset, 0, bounds.totalDays);
        slider.value = String(offset);
      }
    }
    var date = dateStringFromTimelineOffset(bounds, offset);
    panel.setAttribute('data-astrocarto-target-date', date);
    panel.setAttribute('data-astrocarto-timeline-start', bounds.startDate);
    panel.setAttribute('data-astrocarto-timeline-end', bounds.endDate);
    var label = panel.querySelector('[data-astrocarto-date-label]');
    if (label) {
      label.textContent = tr('natal.astrocarto.timing.dateLabel', '{date} · age {age}')
        .replace('{date}', date)
        .replace('{age}', ageYearsForOffset(offset).toFixed(2));
    }
    return date;
  }

  // Accuracy-first resolution policy: request the same high-resolution
  // full-world grid on every viewport. The map is used as an analytical
  // surface, so mobile must not silently compute a coarser field than desktop.
  function pickResolution() {
    return 'high';
  }

  function fetchAstrocarto(mode, options) {
    var src = window.__astrocarto && window.__astrocarto.payload;
    if (!src) return Promise.reject(new Error('no-natal-source'));
    // Astrocartography requires a known birth time — the four angular lines
    // pivot on apparent sidereal time at the birth instant, and a 4-minute time uncertainty
    // shifts MC/IC lines ~1° (~110 km). Fail loudly so the panel surfaces a
    // helpful error rather than 400 from the API.
    if (src.unknownTime) {
      return Promise.reject(new Error('unknown-time'));
    }
    var resolution = pickResolution();
    var targetDate = options && options.targetDate ? options.targetDate : null;
    var targetLocation = options && options.targetLocation ? options.targetLocation : null;
    var includeHeat = !(options && options.includeHeat === false);
    // Cache key includes resolution so a resize from mobile→desktop doesn't
    // serve a stale low-res payload.
    var key = canonicalKey(src) + '|' + resolution;
    if (key !== lastSourceKey) {
      // Birth data or viewport changed — invalidate every cached response.
      responseCache = {};
      pendingFetches = {};
      lastSourceKey = key;
    }
    var targetLocationKey = targetLocation
      ? ['loc', targetLocation.lat, targetLocation.lon, targetLocation.city || '', targetLocation.country || ''].join(',')
      : '';
    var responseKey = mode + (targetDate ? '|' + targetDate : '') + (includeHeat ? '' : '|noheat') + (targetLocationKey ? '|' + targetLocationKey : '');
    if (responseCache[responseKey]) return Promise.resolve(responseCache[responseKey]);
    if (pendingFetches[responseKey]) return pendingFetches[responseKey];

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
      body.ayanamsa = src.ayanamsa || 'true_chitrapaksha';
    }
    if (mode === 'immigration' && src.currentResidence) {
      body.currentResidence = src.currentResidence;
    }
    if (mode === 'soulmate_timing' && targetDate) {
      body.targetDate = targetDate;
    }
    if (!includeHeat) {
      body.includeHeat = false;
    }
    if (mode === 'soulmate_timing' && targetLocation) {
      body.targetLocation = {
        lat: targetLocation.lat,
        lon: targetLocation.lon
      };
      if (targetLocation.city) body.targetLocation.city = targetLocation.city;
      if (targetLocation.country) body.targetLocation.country = targetLocation.country;
    }
    pendingFetches[responseKey] = fetch('/api/astrocarto/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (txt) { throw new Error('API ' + r.status + ': ' + txt.slice(0, 160)); });
        return r.json();
      })
      .then(function (json) {
        responseCache[responseKey] = json;
        delete pendingFetches[responseKey];
        return json;
      })
      .catch(function (err) {
        delete pendingFetches[responseKey];
        throw err;
      });
    return pendingFetches[responseKey];
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

  function messageFromApiError(err) {
    if (!err || !err.message) return null;
    var text = String(err.message);
    var match = text.match(/^API\s+(\d+):\s*(.*)$/);
    if (!match) return null;
    var status = Number(match[1]);
    var bodyText = match[2] || '';
    var apiMessage = bodyText;
    try {
      var parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed.error === 'string') apiMessage = parsed.error;
    } catch (e) {}
    if (status === 429) {
      return apiMessage || 'Rate limit exceeded. Please wait and try again.';
    }
    if (status >= 400 && status < 500) {
      return apiMessage || 'The map request was rejected. Please check the birth details and try again.';
    }
    if (status >= 500) {
      return 'The map calculation failed on the server. Please try again.';
    }
    return apiMessage || null;
  }

  var timingCitiesLoaded = false;
  var timingCitiesLoading = null;

  function loadTimingCities() {
    if (window.__natalCities && Array.isArray(window.__natalCities)) {
      timingCitiesLoaded = true;
      return Promise.resolve(window.__natalCities);
    }
    if (timingCitiesLoaded) return Promise.resolve(window.__natalCities || []);
    if (timingCitiesLoading) return timingCitiesLoading;
    timingCitiesLoading = fetch('/assets/data/cities.json', {
      headers: { 'accept': 'application/json' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('cities http ' + r.status);
        return r.json();
      })
      .then(function (data) {
        window.__natalCities = data;
        timingCitiesLoaded = true;
        return data;
      })
      .catch(function (err) {
        timingCitiesLoading = null;
        throw err;
      });
    return timingCitiesLoading;
  }

  function normaliseTimingQuery(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9,\s.-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cityDisplayName(city) {
    if (!city) return '';
    var name = city.name || city.city || '';
    if (!city.country && isFinite(Number(city.lat)) && isFinite(Number(city.lon))) {
      return name + ' (' + Number(city.lat).toFixed(4) + ', ' + Number(city.lon).toFixed(4) + ')';
    }
    return city.country ? name + ', ' + city.country : name;
  }

  function parseCoordinateQuery(query) {
    var m = String(query || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = Number(m[1]);
    var lon = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return {
      city: tr('natal.astrocarto.timing.customLocation', 'Custom location'),
      country: '',
      lat: lat,
      lon: lon
    };
  }

  function timingCityMatches(query, limit) {
    var cities = window.__natalCities || [];
    var nq = normaliseTimingQuery(query);
    if (!nq) return [];
    var scored = [];
    for (var i = 0; i < cities.length; i += 1) {
      var city = cities[i];
      var name = normaliseTimingQuery(city.name);
      var label = normaliseTimingQuery(cityDisplayName(city));
      var score = 0;
      if (label === nq) score = 100;
      else if (name === nq) score = 90;
      else if (label.indexOf(nq) === 0) score = 80;
      else if (name.indexOf(nq) === 0) score = 70;
      else if (label.indexOf(nq) >= 0) score = 50;
      else if (name.indexOf(nq) >= 0) score = 40;
      if (score > 0) scored.push({ city: city, score: score, index: i });
    }
    return scored
      .sort(function (a, b) { return b.score - a.score || a.index - b.index; })
      .slice(0, limit || 8)
      .map(function (item) { return item.city; });
  }

  function populateTimingCityList(panel, query) {
    var list = panel.querySelector('[data-astrocarto-city-list]');
    if (!list) return;
    removeAllChildren(list);
    if (!query || String(query).trim().length < 2) return;
    var matches = timingCityMatches(query, 8);
    for (var i = 0; i < matches.length; i += 1) {
      var opt = htmlEl('option', { value: cityDisplayName(matches[i]) });
      list.appendChild(opt);
    }
  }

  function resolveTimingLocation(query) {
    var parsed = parseCoordinateQuery(query);
    if (parsed) return Promise.resolve(parsed);
    return loadTimingCities().then(function () {
      var matches = timingCityMatches(query, 1);
      if (!matches.length) return null;
      return {
        city: matches[0].name,
        country: matches[0].country,
        lat: matches[0].lat,
        lon: matches[0].lon
      };
    });
  }

  function setCityTimingStatus(panel, message, state) {
    var status = panel.querySelector('[data-astrocarto-city-status]');
    if (!status) return;
    status.textContent = message || '';
    if (state) status.setAttribute('data-state', state);
    else status.removeAttribute('data-state');
  }

  function clearCityTimingResults(panel) {
    var results = panel.querySelector('[data-astrocarto-city-results]');
    if (results) removeAllChildren(results);
    setCityTimingStatus(panel, '', null);
  }

  function renderCityTimingResults(panel, response, location) {
    var results = panel.querySelector('[data-astrocarto-city-results]');
    if (!results) return;
    removeAllChildren(results);
    var cityTiming = response && response.cityTiming;
    var windows = cityTiming && cityTiming.windows ? cityTiming.windows : [];
    var label = cityDisplayName(location);
    if (!windows.length) {
      setCityTimingStatus(panel, tr('natal.astrocarto.timing.cityNoWindows',
        'No activation window was returned for this location.'), 'error');
      return;
    }
    setCityTimingStatus(panel, tr('natal.astrocarto.timing.cityFound',
      'Best soulmate activation windows for {city}.').replace('{city}', label), null);
    for (var i = 0; i < windows.length; i += 1) {
      var w = windows[i];
      var li = htmlEl('li');
      var wrap = htmlEl('div', { class: 'astrocarto-city-timing__window' });
      wrap.appendChild(htmlEl('strong', null, tr('natal.astrocarto.timing.cityWindow',
        '{start} to {end}').replace('{start}', w.startDate).replace('{end}', w.endDate)));
      var meta = [
        tr('natal.astrocarto.timing.cityPeak', 'Peak {date}').replace('{date}', w.peakDate),
        tr('natal.astrocarto.timing.cityAge', 'age {age}').replace('{age}', Number(w.peakAgeYears).toFixed(2)),
        tr('natal.astrocarto.timing.cityScore', 'score {score}').replace('{score}', w.peakScore)
      ].join(' · ');
      wrap.appendChild(htmlEl('span', { class: 'astrocarto-city-timing__meta' }, meta));
      li.appendChild(wrap);
      results.appendChild(li);
    }
  }

  function loadAndRenderInto(panel) {
    var mode = panel.getAttribute('data-astrocarto');
    if (!mode) return;
    var mapEl = panel.querySelector('[data-astrocarto-map]');
    var legendEl = panel.querySelector('[data-astrocarto-legend]');
    if (!mapEl) return;
    var targetDate = timingTargetDateForPanel(panel);
    setBusy(panel, true);
    fetchAstrocarto(mode, { targetDate: targetDate })
      .then(function (json) {
        if (mode === 'soulmate_timing' && timingTargetDateForPanel(panel) !== targetDate) {
          return;
        }
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
        } else {
          msg = messageFromApiError(err);
        }
        setError(panel, msg);
      });
  }

  function bindTimingControls(panel) {
    if (!panel || panel.getAttribute('data-astrocarto') !== 'soulmate_timing') return;
    var slider = panel.querySelector('[data-astrocarto-date-slider]');
    if (!slider || slider.getAttribute('data-astrocarto-bound') === '1') return;
    slider.setAttribute('data-astrocarto-bound', '1');
    timingTargetDateForPanel(panel);
    var timer = 0;
    function scheduleReload() {
      timingTargetDateForPanel(panel);
      panel.removeAttribute('data-astrocarto-loaded');
      if (!panel.hidden) setBusy(panel, true);
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!panel.hidden) loadAndRenderInto(panel);
      }, 320);
    }
    slider.addEventListener('input', scheduleReload);
    slider.addEventListener('change', scheduleReload);
  }

  function bindCityTimingControls(panel) {
    if (!panel || panel.getAttribute('data-astrocarto') !== 'soulmate_timing') return;
    var form = panel.querySelector('[data-astrocarto-city-form]');
    var input = panel.querySelector('[data-astrocarto-city-input]');
    if (!form || !input || form.getAttribute('data-astrocarto-bound') === '1') return;
    form.setAttribute('data-astrocarto-bound', '1');
    input.addEventListener('focus', function () {
      loadTimingCities()
        .then(function () { populateTimingCityList(panel, input.value); })
        .catch(function () {});
    });
    input.addEventListener('input', function () {
      loadTimingCities()
        .then(function () { populateTimingCityList(panel, input.value); })
        .catch(function () {});
    });
    form.addEventListener('submit', function (evt) {
      evt.preventDefault();
      clearCityTimingResults(panel);
      var query = input.value.trim();
      if (!query) return;
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      resolveTimingLocation(query)
        .then(function (location) {
          if (!location) {
            setCityTimingStatus(panel, tr('natal.astrocarto.timing.cityNoMatch',
              'No city match. Enter a larger nearby city or exact coordinates as lat, lon.'), 'error');
            return null;
          }
          var label = cityDisplayName(location);
          input.value = label;
          setCityTimingStatus(panel, tr('natal.astrocarto.timing.cityLoading',
            'Scanning birth-to-age-50 timing for {city}…').replace('{city}', label), null);
          return fetchAstrocarto('soulmate_timing', {
            targetDate: timingTargetDateForPanel(panel),
            targetLocation: location,
            includeHeat: false
          }).then(function (json) {
            renderCityTimingResults(panel, json, location);
          });
        })
        .catch(function (err) {
          if (window.console && console.warn) console.warn('[astrocarto] city timing', err);
          setCityTimingStatus(panel, messageFromApiError(err) || tr('natal.astrocarto.error',
            'Sorry — we could not load the astrocartography map. Please try again.'), 'error');
        })
        .then(function () {
          if (button) button.disabled = false;
        });
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
        document.querySelectorAll('[data-astrocarto]').forEach(function (p) {
          p.removeAttribute('data-astrocarto-loaded');
          clearCityTimingResults(p);
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
    bindTimingControls(panel);
    bindCityTimingControls(panel);

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
      window.__debug_astrocarto_pickResolution = pickResolution;
      // Projection + optional smoothing helpers, exposed for the in-browser
      // verification pass. Read-only — callers can compose their own tests.
      window.__debug_astrocarto_projection = {
        xOfLon: xOfLon, yOfLat: yOfLat,
        lonOfX: lonOfX, latOfY: latOfY,
        VIEW_W: VIEW_W, VIEW_H: VIEW_H,
        runSelfCheck: runProjectionSelfCheck
      };
      window.__debug_astrocarto_pathing = {
        antimeridianCrossing: antimeridianCrossing,
        lonLatPathD: lonLatPathD,
        polylineToPathD: polylineToPathD,
        continentsPathD: continentsPathD
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
