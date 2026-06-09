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
 *  No external dependencies. Inline Marching Squares (~150 lines) extracts
 *  iso-contour polygons from the heat matrix; each contour band is rendered
 *  as a single SVG <path> filled with the matching --heat-N gradient stop.
 *  A continent <clipPath> derived from /assets/data/world-continents.js
 *  masks the bands to land only — oceans stay clean for visual orientation.
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

  // Contour band thresholds — 7 iso-levels yields 8 visual bands. We pick
  // breakpoints that match the perceptual "low / mid / high" buckets users
  // care about for a relocation map: anything < 10 reads as background, and
  // anything >= 92 marks the absolute hot-spots.
  var BAND_THRESHOLDS = [10, 25, 40, 55, 70, 82, 92];

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

  // =====================================================================
  //   MARCHING SQUARES — inline, no dependency
  // ---------------------------------------------------------------------
  //   For a uniform grid of scalar values, extract the iso-contour at a
  //   given threshold as a list of closed polygons (and possibly open
  //   polylines that hit the grid edge). The algorithm:
  //
  //     1.  Scan every 2×2 quad of cells. Each of the 4 corners is either
  //         BELOW threshold (0) or AT-OR-ABOVE (1). The 4-bit corner mask
  //         (TL, TR, BR, BL) gives one of 16 cases (0..15).
  //
  //     2.  Each case emits 0, 1 or 2 line segments. The segment endpoints
  //         lie on the cell edges, linearly interpolated to where the
  //         threshold crosses (so the contour is smooth, not stair-stepped).
  //
  //     3.  We accumulate all (start, end) segments, then walk them by
  //         endpoint adjacency (using a hashed lookup) to chain them into
  //         polygons. Saddle cases 5 and 10 are disambiguated by sampling
  //         the cell center value — this matches d3-contour's behaviour.
  //
  //     4.  The final closed polygons enclose the region {v >= threshold}.
  //         Render lowest threshold first (largest area) and overpaint with
  //         each higher band — z-order naturally creates filled bands.
  //
  //   Output is in (lon, lat) coordinates so the renderer can transform
  //   uniformly with lon2x / lat2y.
  // =====================================================================

  // Marching-squares edge endpoints per case. Edges numbered:
  //   0 = top    (between TL-TR)
  //   1 = right  (between TR-BR)
  //   2 = bottom (between BR-BL)
  //   3 = left   (between BL-TL)
  // For each of 16 corner-masks, return up to two segments. Each segment is
  // [enterEdge, exitEdge] with the convention that the "inside" (v >= t)
  // is to the RIGHT of the traversal direction — this gives consistent
  // polygon winding for fill-rule.
  var MS_EDGES = [
    [],                       // 0000 — all out
    [[3, 2]],                 // 0001 — BL in
    [[2, 1]],                 // 0010 — BR in
    [[3, 1]],                 // 0011 — bottom row in
    [[1, 0]],                 // 0100 — TR in
    [[3, 0], [1, 2]],         // 0101 — saddle (TR+BL in)
    [[2, 0]],                 // 0110 — right col in
    [[3, 0]],                 // 0111 — TL out only
    [[0, 3]],                 // 1000 — TL in
    [[0, 2]],                 // 1001 — left col in
    [[0, 1], [2, 3]],         // 1010 — saddle (TL+BR in)
    [[0, 1]],                 // 1011 — TR out only
    [[1, 3]],                 // 1100 — top row in
    [[1, 2]],                 // 1101 — BR out only
    [[2, 3]],                 // 1110 — BL out only
    []                        // 1111 — all in
  ];

  // Linear interpolation along an edge: given the two corner values and the
  // threshold, return t ∈ [0, 1] at which v = threshold.
  function lerpT(a, b, t) {
    var d = b - a;
    if (Math.abs(d) < 1e-9) return 0.5;
    var v = (t - a) / d;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // Given a cell (col, row), corner values [TL, TR, BR, BL] and a threshold,
  // return the (lon, lat) point on the requested edge.
  function edgePoint(edge, col, row, vals, thresh, lons, lats) {
    var lon0 = lons[col],     lon1 = lons[col + 1];
    var lat0 = lats[row],     lat1 = lats[row + 1];
    var t;
    switch (edge) {
      case 0: // top edge — TL→TR — vary lon
        t = lerpT(vals[0], vals[1], thresh);
        return [lon0 + (lon1 - lon0) * t, lat0];
      case 1: // right edge — TR→BR — vary lat
        t = lerpT(vals[1], vals[2], thresh);
        return [lon1, lat0 + (lat1 - lat0) * t];
      case 2: // bottom edge — BR→BL — vary lon (reverse)
        t = lerpT(vals[3], vals[2], thresh);
        return [lon0 + (lon1 - lon0) * t, lat1];
      case 3: // left edge — BL→TL — vary lat (reverse)
        t = lerpT(vals[0], vals[3], thresh);
        return [lon0, lat0 + (lat1 - lat0) * t];
    }
    return [lon0, lat0];
  }

  // Run marching squares on `grid` (rowMajor, lats[0..R-1] × lons[0..C-1])
  // at the given threshold. Returns an array of polylines (each is a list
  // of [lon, lat] points). Polylines may be open (hit grid edge) or closed
  // (loop back); the caller closes them with the bounding rectangle.
  function marchingSquares(grid, lats, lons, thresh) {
    var R = lats.length;
    var C = lons.length;
    var segments = [];

    for (var r = 0; r < R - 1; r += 1) {
      var row0 = grid[r];
      var row1 = grid[r + 1];
      if (!row0 || !row1) continue;
      for (var c = 0; c < C - 1; c += 1) {
        var TL = row0[c],     TR = row0[c + 1];
        var BL = row1[c],     BR = row1[c + 1];
        if (TL == null || TR == null || BL == null || BR == null) continue;

        var mask = 0;
        if (TL >= thresh) mask |= 8;
        if (TR >= thresh) mask |= 4;
        if (BR >= thresh) mask |= 2;
        if (BL >= thresh) mask |= 1;
        if (mask === 0 || mask === 15) continue;

        var cases = MS_EDGES[mask];
        // Saddle disambiguation (cases 5 + 10) — average corner value
        // approximates the cell-centre value; pick connection so the
        // contour matches the centre's side of the threshold.
        if (mask === 5 || mask === 10) {
          var centre = (TL + TR + BR + BL) * 0.25;
          if ((mask === 5 && centre < thresh) || (mask === 10 && centre >= thresh)) {
            // swap connection
            cases = (mask === 5)
              ? [[3, 2], [1, 0]]
              : [[0, 3], [2, 1]];
          }
        }

        var corners = [TL, TR, BR, BL];
        for (var s = 0; s < cases.length; s += 1) {
          var pair = cases[s];
          var a = edgePoint(pair[0], c, r, corners, thresh, lons, lats);
          var b = edgePoint(pair[1], c, r, corners, thresh, lons, lats);
          segments.push([a, b]);
        }
      }
    }
    return chainSegments(segments);
  }

  // Chain unordered segments into polylines by endpoint match. Use a hash
  // map keyed by quantised start-point (~1e-4 degree ≈ 11 m tolerance) to
  // find the unique next segment in O(1). Total cost: O(N) for N segments.
  function chainSegments(segments) {
    if (!segments.length) return [];
    var Q = 1e4; // quantise to 1e-4 degree — segments end at exact edge
                 // intersections so an exact match is normally fine, but
                 // quantising avoids floating-point drift misses.
    function key(p) {
      return Math.round(p[0] * Q) + ',' + Math.round(p[1] * Q);
    }
    var N = segments.length;
    // For each start-point key, store the list of segment INDICES that begin
    // there. Storing indices (not refs) lets the consumer flag them used in
    // O(1) without an additional indexOf.
    var byStart = Object.create(null);
    for (var i = 0; i < N; i += 1) {
      var k = key(segments[i][0]);
      (byStart[k] || (byStart[k] = [])).push(i);
    }
    var used = new Uint8Array(N);
    var lines = [];
    for (var i2 = 0; i2 < N; i2 += 1) {
      if (used[i2]) continue;
      used[i2] = 1;
      var seg2 = segments[i2];
      var line = [seg2[0], seg2[1]];
      var startKey = key(seg2[0]);
      var endKey = key(seg2[1]);
      // walk forward
      while (true) {
        var candidates = byStart[endKey];
        if (!candidates || !candidates.length) break;
        var nextIdx = -1;
        for (var j = 0; j < candidates.length; j += 1) {
          var idx = candidates[j];
          if (!used[idx]) { nextIdx = idx; break; }
        }
        if (nextIdx < 0) break;
        used[nextIdx] = 1;
        var nextSeg = segments[nextIdx];
        line.push(nextSeg[1]);
        endKey = key(nextSeg[1]);
        // closed loop?
        if (endKey === startKey) break;
      }
      lines.push(line);
    }
    return lines;
  }

  // ---------- Douglas-Peucker simplification (in lon/lat space) ----------
  //
  // Reduces the number of vertices in each polyline by recursively dropping
  // points that lie within `epsilon` of the chord between their neighbours.
  // Operates on a copy; original points untouched. epsilon is in degrees —
  // for our 4° / 3° grid, 0.35° (~40 km) preserves shape without ringing.
  function simplify(points, epsilon) {
    if (!points || points.length < 3) return points || [];
    function sqSegDist(p, a, b) {
      var x = a[0], y = a[1];
      var dx = b[0] - x, dy = b[1] - y;
      if (dx !== 0 || dy !== 0) {
        var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; }
        else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p[0] - x; dy = p[1] - y;
      return dx * dx + dy * dy;
    }
    var sqEps = epsilon * epsilon;
    var n = points.length;
    var keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var range = stack.pop();
      var first = range[0], last = range[1];
      var maxDist = 0, index = -1;
      for (var i = first + 1; i < last; i += 1) {
        var d = sqSegDist(points[i], points[first], points[last]);
        if (d > maxDist) { maxDist = d; index = i; }
      }
      if (maxDist > sqEps && index >= 0) {
        keep[index] = 1;
        stack.push([first, index]);
        stack.push([index, last]);
      }
    }
    var out = [];
    for (var k = 0; k < n; k += 1) if (keep[k]) out.push(points[k]);
    return out;
  }

  // Convert polylines (lon, lat) to a single SVG `d` string. Closed polygons
  // get a trailing 'Z'; open ones (hit the grid edge) stay open — they'll be
  // clipped by the continent <clipPath> anyway.
  function polylinesToPathD(lines) {
    var parts = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line || line.length < 2) continue;
      var first = line[0];
      var last = line[line.length - 1];
      var closed = (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6);
      var seg = 'M' + lon2x(first[0]).toFixed(1) + ' ' + lat2y(first[1]).toFixed(1);
      for (var j = 1; j < line.length; j += 1) {
        seg += ' L' + lon2x(line[j][0]).toFixed(1) + ' ' + lat2y(line[j][1]).toFixed(1);
      }
      if (closed) seg += ' Z';
      parts.push(seg);
    }
    return parts.join(' ');
  }

  // =====================================================================
  //   BAND COLOR RAMP
  // ---------------------------------------------------------------------
  //   Each iso-band's fill is the interpolated heat color at the band's
  //   LOWER threshold (so adjacent bands share a stop boundary). Opacity
  //   ramps with the band index to give the warmest bands more presence.
  // =====================================================================
  function bandFill(threshold, stops) {
    return colorForValue(threshold, stops);
  }
  function bandOpacity(idx, total) {
    // Bottom band ~0.18, top band ~0.78 — a perceptual ramp that keeps low
    // areas readable as 'flat' while the apex bands ride bright.
    return 0.18 + (idx / Math.max(1, total - 1)) * 0.6;
  }

  // ---------- Build the SVG ----------

  function renderMap(container, response, mode) {
    if (!container || !response) return;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
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

    // ---- Continent CLIP MASK + outline path (shared `d`) ----
    // We need ONE unique clipPath id per panel so multiple maps on the page
    // (when running in dev test harnesses) don't collide.
    var continents = window.IYOGAU_WORLD_CONTINENTS || [];
    var landPathD = continents.length ? continentsPathD(continents) : '';
    var clipId = 'astrocarto-land-' + mode + '-' + Math.random().toString(36).slice(2, 8);
    if (landPathD) {
      var defs = svgEl('defs');
      var clip = svgEl('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      clip.appendChild(svgEl('path', { d: landPathD, 'fill-rule': 'evenodd' }));
      defs.appendChild(clip);
      svg.appendChild(defs);
    }

    // ---- Heat matrix → contour bands ----
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

    var bandsG = svgEl('g', {
      class: 'astrocarto-bands',
      'aria-hidden': 'true'
    });
    if (landPathD) bandsG.setAttribute('clip-path', 'url(#' + clipId + ')');

    if (latitudes.length && longitudes.length && values.length) {
      // (1) Extend longitudes so the matrix wraps continuously around the
      //     world (otherwise the last column never gets a contour back to
      //     lon = −180).
      // (2) Pad the matrix with a guard row of zeros above and below the
      //     real data, so any iso-contour that would otherwise dangle off
      //     the top or bottom edge closes cleanly. Without this, the
      //     evenodd fill-rule paints unrelated screen regions where the
      //     polyline straight-line closes back to its start.
      var lonsExt = longitudes.slice();
      var lastLon = longitudes[longitudes.length - 1];
      lonsExt.push(lastLon + lonStep);

      var firstLat = latitudes[0];
      var lastLat = latitudes[latitudes.length - 1];
      var latsExt = [firstLat - latStep].concat(latitudes).concat([lastLat + latStep]);

      var paddedCols = lonsExt.length;
      var zeroRow = new Array(paddedCols);
      for (var z = 0; z < paddedCols; z += 1) zeroRow[z] = 0;
      var valuesExt = new Array(latitudes.length + 2);
      valuesExt[0] = zeroRow;
      for (var r = 0; r < values.length; r += 1) {
        var row = values[r] || [];
        var extRow = row.slice();
        extRow.push(row[0]); // wrap east → west match
        valuesExt[r + 1] = extRow;
      }
      valuesExt[valuesExt.length - 1] = zeroRow;

      // Simplification epsilon scales with cell step — finer grids tolerate
      // tighter simplification before they look polygonal.
      var simplifyEps = Math.max(0.15, latStep * 0.12);

      for (var bi = 0; bi < BAND_THRESHOLDS.length; bi += 1) {
        var thresh = BAND_THRESHOLDS[bi];
        var polylines = marchingSquares(valuesExt, latsExt, lonsExt, thresh);
        if (!polylines.length) continue;
        var simplified = [];
        for (var pi = 0; pi < polylines.length; pi += 1) {
          simplified.push(simplify(polylines[pi], simplifyEps));
        }
        var d = polylinesToPathD(simplified);
        if (!d) continue;

        var fill = bandFill(thresh, heatStops);
        var op = bandOpacity(bi, BAND_THRESHOLDS.length);
        var bandPath = svgEl('path', {
          d: d,
          fill: fill,
          'fill-opacity': op.toFixed(2),
          'fill-rule': 'evenodd',
          stroke: 'none',
          class: 'astrocarto-band astrocarto-band--' + bi,
          'data-threshold': String(thresh)
        });
        bandsG.appendChild(bandPath);
      }
    }
    svg.appendChild(bandsG);

    // ---- Continent outlines (rendered ABOVE the bands, no fill) ----
    if (landPathD) {
      var land = svgEl('path', {
        d: landPathD,
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
    }
  } catch (e) {}
}());
