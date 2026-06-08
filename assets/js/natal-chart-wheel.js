/* =====================================================================
 *  natal-chart-wheel.js
 *  ---------------------------------------------------------------------
 *  Renders an astrology chart wheel as SVG.
 *
 *  Exports (via the global IIFE) a single function:
 *      window.NatalWheel.render(model, svgElement, options)
 *
 *  - `model`       JSON returned by POST /api/calculate-chart (see brief).
 *  - `svgElement`  An existing <svg> node in the DOM. Its viewBox should
 *                  be "0 0 800 800"; the renderer assumes this canvas.
 *  - `options`     { showAspects?: boolean, locale?: string }
 *
 *  Coordinate convention:
 *    longitude 0° (Aries 0°) renders at the 9 o'clock position (left),
 *    increasing counter-clockwise. The whole wheel is rotated so that
 *    the ascendant longitude sits at exactly 9 o'clock — the conventional
 *    "house 1 on the left" layout.
 *
 *    Mapping (after rotation):
 *      a = (longitude - ascendantLongitude) degrees
 *      x = cx + r * cos(π - a·π/180)
 *      y = cy - r * sin(π - a·π/180)   // SVG y axis is flipped
 *
 *  No dependencies. Pure DOM / SVG.
 * ===================================================================== */

(function (global) {
  'use strict';

  // ---------- constants ----------

  var CX = 400, CY = 400;            // SVG centre
  var R_OUTER = 380;                 // outer ring
  var R_SIGN_GLYPH = 350;            // sign glyph radius
  var R_SIGN_NAME  = 322;            // sign name radius (just inside glyph)
  var R_INNER_RING = 300;            // boundary between sign band and house band
  var R_HOUSE_INNER = 200;           // inner edge of house band
  var R_HOUSE_LABEL = 250;           // house number radius
  var R_PLANET_GLYPH = 240;          // planet glyph radius
  var R_PLANET_LABEL = 268;          // planet degree text radius (below glyph)
  var R_ASPECT = R_HOUSE_INNER;      // aspect chords sit at inner-ring edge

  var SIGN_GLYPHS = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];

  // Internal sign keys map to i18n keys (natal.signs.<key>)
  var SIGN_KEYS = [
    'aries','taurus','gemini','cancer','leo','virgo',
    'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
  ];

  // Planet name → unicode glyph + i18n key
  var PLANET_META = {
    Sun:     { glyph: '☉', key: 'sun'     },
    Moon:    { glyph: '☽', key: 'moon'    },
    Mercury: { glyph: '☿', key: 'mercury' },
    Venus:   { glyph: '♀', key: 'venus'   },
    Mars:    { glyph: '♂', key: 'mars'    },
    Jupiter: { glyph: '♃', key: 'jupiter' },
    Saturn:  { glyph: '♄', key: 'saturn'  },
    Uranus:  { glyph: '♅', key: 'uranus'  },
    Neptune: { glyph: '♆', key: 'neptune' },
    Pluto:   { glyph: '♇', key: 'pluto'   }
  };

  var ASPECT_STYLE = {
    sextile:     { stroke: 'var(--gold)',       width: 1,   dash: ''     },
    square:      { stroke: 'var(--gold-hover)', width: 1.5, dash: '4 3'  },
    trine:       { stroke: 'var(--primary)',    width: 1.5, dash: ''     },
    opposition:  { stroke: 'var(--gold-hover)', width: 2,   dash: ''     }
    // conjunction: deliberately omitted (planets too close — would clutter)
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- helpers ----------

  /** Make an SVG element with the given attributes. */
  function el(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (attrs[k] !== undefined && attrs[k] !== null) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /**
   * Longitude → Cartesian point, with the wheel rotated so that
   * `ascLon` lands at the 9 o'clock position (180° in SVG screen space).
   */
  function lonToXY(lonDeg, ascLonDeg, radius) {
    var rel = ((lonDeg - ascLonDeg) % 360 + 360) % 360;
    var rad = Math.PI - (rel * Math.PI) / 180;
    return {
      x: CX + radius * Math.cos(rad),
      y: CY - radius * Math.sin(rad)
    };
  }

  /** Build the "d" attribute for a pie/wedge from (a1deg, a2deg) at given radius. */
  function wedgePath(a1, a2, ascLon, rOuter, rInner) {
    var p1o = lonToXY(a1, ascLon, rOuter);
    var p2o = lonToXY(a2, ascLon, rOuter);
    // a2 > a1, so the sweep is 30°: choose large-arc=0, sweep=0 (CCW in SVG screen)
    var arcOuter = ['A', rOuter, rOuter, 0, 0, 0, p2o.x, p2o.y].join(' ');
    if (rInner === undefined) {
      return ['M', CX, CY, 'L', p1o.x, p1o.y, arcOuter, 'Z'].join(' ');
    }
    var p1i = lonToXY(a1, ascLon, rInner);
    var p2i = lonToXY(a2, ascLon, rInner);
    var arcInner = ['A', rInner, rInner, 0, 0, 1, p1i.x, p1i.y].join(' ');
    return [
      'M', p1o.x, p1o.y, arcOuter,
      'L', p2i.x, p2i.y, arcInner, 'Z'
    ].join(' ');
  }

  /** Localised sign / planet / aspect name lookups (with safe fallbacks). */
  function i18nLookup(locale, dictPath, fallback) {
    try {
      var dict = global.IYOGAU_I18N && global.IYOGAU_I18N[locale];
      if (!dict) return fallback;
      var parts = dictPath.split('.');
      var node = dict;
      for (var i = 0; i < parts.length; i++) {
        if (node == null) return fallback;
        node = node[parts[i]];
      }
      return (typeof node === 'string' && node) ? node : fallback;
    } catch (e) { return fallback; }
  }

  /** "5°14′" formatted degree-minute string from a planet record. */
  function dmStr(p) {
    var d = (p.degree != null) ? p.degree : 0;
    var m = (p.minute != null) ? p.minute : 0;
    return d + '°' + (m < 10 ? '0' + m : m) + '′';
  }

  // ---------- main render ----------

  /**
   * Render the wheel.
   * Returns nothing; mutates svgElement (clears children first).
   */
  function render(model, svgElement, options) {
    if (!model || !svgElement) return;
    options = options || {};
    var locale = options.locale || 'en';
    var showAspects = options.showAspects !== false;

    var ascLon = (model.ascendant && typeof model.ascendant.longitude === 'number')
      ? model.ascendant.longitude
      : 0;

    // Clear (preserve <title>/<desc> for a11y)
    var preserve = [];
    Array.prototype.forEach.call(svgElement.childNodes, function (n) {
      if (n.nodeType === 1 && (n.tagName === 'title' || n.tagName === 'desc')) {
        preserve.push(n);
      }
    });
    svgElement.textContent = '';
    preserve.forEach(function (n) { svgElement.appendChild(n); });

    // ---- Layer 1: outer ring background ----
    svgElement.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_OUTER,
      fill: 'var(--surface-2)'
    }));

    // ---- Layer 2: zodiac sector backgrounds (alternating tints) ----
    var sectorGroup = el('g', { 'class': 'wheel-sectors' });
    for (var s = 0; s < 12; s++) {
      var a1 = s * 30;
      var a2 = (s + 1) * 30;
      var fill = (s % 2 === 0) ? 'var(--primary-faint)' : 'var(--surface-2)';
      sectorGroup.appendChild(el('path', {
        d: wedgePath(a1, a2, ascLon, R_OUTER, R_INNER_RING),
        fill: fill,
        'fill-opacity': 0.4,
        stroke: 'none'
      }));
    }
    svgElement.appendChild(sectorGroup);

    // ---- Layer 3: sign glyph + name at each 30° midpoint ----
    var signGroup = el('g', { 'class': 'wheel-signs' });
    for (var i = 0; i < 12; i++) {
      var mid = i * 30 + 15;
      var gp = lonToXY(mid, ascLon, R_SIGN_GLYPH);
      var np = lonToXY(mid, ascLon, R_SIGN_NAME);
      signGroup.appendChild(el('text', {
        x: gp.x, y: gp.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': '"Noto Serif", serif',
        'font-size': 24,
        fill: 'var(--ink)'
      }, SIGN_GLYPHS[i]));
      signGroup.appendChild(el('text', {
        x: np.x, y: np.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': 'Manrope, system-ui, sans-serif',
        'font-size': 11,
        fill: 'var(--ink-muted)'
      }, i18nLookup(locale, 'natal.signs.' + SIGN_KEYS[i], SIGN_KEYS[i])));
    }
    svgElement.appendChild(signGroup);

    // ---- Layer 4: inner ring boundary ----
    svgElement.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_INNER_RING,
      fill: 'none',
      stroke: 'var(--outline)',
      'stroke-width': 1
    }));

    // ---- Layer 5: house cusp lines (200 → 300) ----
    var houseGroup = el('g', { 'class': 'wheel-houses' });
    var houses = (model.houses && model.houses.length === 12) ? model.houses : [];
    for (var h = 0; h < houses.length; h++) {
      var cusp = houses[h].cusp;
      if (typeof cusp !== 'number') continue;
      var p1 = lonToXY(cusp, ascLon, R_HOUSE_INNER);
      var p2 = lonToXY(cusp, ascLon, R_INNER_RING);
      houseGroup.appendChild(el('line', {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: 'var(--outline)',
        'stroke-width': 1
      }));
    }
    svgElement.appendChild(houseGroup);

    // ---- Layer 6: house numbers ----
    var labelGroup = el('g', { 'class': 'wheel-house-numbers' });
    for (var hn = 0; hn < houses.length; hn++) {
      var thisCusp = houses[hn].cusp;
      var nextCusp = houses[(hn + 1) % houses.length].cusp;
      if (typeof thisCusp !== 'number' || typeof nextCusp !== 'number') continue;
      // Midpoint in longitude space (handle wrap)
      var span = ((nextCusp - thisCusp) % 360 + 360) % 360;
      if (span === 0) span = 30; // whole-sign safety
      var midLon = (thisCusp + span / 2) % 360;
      var lp = lonToXY(midLon, ascLon, R_HOUSE_LABEL);
      labelGroup.appendChild(el('text', {
        x: lp.x, y: lp.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': 'Manrope, system-ui, sans-serif',
        'font-size': 13,
        fill: 'var(--ink-muted)'
      }, String(houses[hn].number)));
    }
    svgElement.appendChild(labelGroup);

    // ---- Layer 7: inner circle ----
    svgElement.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_HOUSE_INNER,
      fill: 'var(--surface)',
      stroke: 'var(--outline-strong)',
      'stroke-width': 1
    }));

    // ---- Layer 8: aspect chords ----
    if (showAspects && Array.isArray(model.aspects) && Array.isArray(model.planets)) {
      var planetByName = {};
      model.planets.forEach(function (p) { planetByName[p.name] = p; });

      var aspectsGroup = el('g', { 'class': 'wheel-aspects' });
      model.aspects.forEach(function (a) {
        var style = ASPECT_STYLE[a.type];
        if (!style) return;
        var from = planetByName[a.from];
        var to = planetByName[a.to];
        if (!from || !to) return;
        var p1 = lonToXY(from.longitude, ascLon, R_ASPECT);
        var p2 = lonToXY(to.longitude,   ascLon, R_ASPECT);
        var attrs = {
          x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
          x2: p2.x.toFixed(2), y2: p2.y.toFixed(2),
          stroke: style.stroke,
          'stroke-width': style.width,
          'stroke-linecap': 'round',
          opacity: 0.85
        };
        if (style.dash) attrs['stroke-dasharray'] = style.dash;
        var line = el('line', attrs);
        var t = document.createElementNS(SVG_NS, 'title');
        t.textContent = a.from + ' ' + a.type + ' ' + a.to +
          ' (orb ' + (a.orb != null ? a.orb.toFixed(1) + '°' : '?') + ')';
        line.appendChild(t);
        aspectsGroup.appendChild(line);
      });
      svgElement.appendChild(aspectsGroup);
    }

    // ---- Layer 9: Asc & MC axes ----
    var axesGroup = el('g', { 'class': 'wheel-axes' });
    function axis(lon, label) {
      if (typeof lon !== 'number') return;
      var inner = lonToXY(lon, ascLon, 0);
      var outer = lonToXY(lon, ascLon, R_OUTER);
      axesGroup.appendChild(el('line', {
        x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
        stroke: 'var(--gold-hover)',
        'stroke-width': 2.5,
        'stroke-linecap': 'round'
      }));
      var labelPos = lonToXY(lon, ascLon, R_OUTER + 18);
      axesGroup.appendChild(el('text', {
        x: labelPos.x, y: labelPos.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': 'Manrope, system-ui, sans-serif',
        'font-size': 12,
        'font-weight': 600,
        fill: 'var(--gold-hover)'
      }, label));
    }
    axis(model.ascendant && model.ascendant.longitude, 'Asc');
    axis(model.midheaven && model.midheaven.longitude, 'MC');
    svgElement.appendChild(axesGroup);

    // ---- Layer 10 + 11: planet glyphs and degree labels ----
    // We nudge overlapping planets along the longitude axis so glyphs don't
    // stack on top of each other — a simple greedy separation pass.
    var planets = Array.isArray(model.planets) ? model.planets.slice() : [];
    planets.sort(function (a, b) { return a.longitude - b.longitude; });

    // Compute relative positions (after rotation), spread if closer than minSep
    var minSep = 6; // degrees
    var rel = planets.map(function (p) {
      return ((p.longitude - ascLon) % 360 + 360) % 360;
    });
    for (var pass = 0; pass < 3; pass++) {
      for (var k = 1; k < rel.length; k++) {
        if (rel[k] - rel[k - 1] < minSep) {
          var shift = (minSep - (rel[k] - rel[k - 1])) / 2;
          rel[k - 1] = Math.max(0, rel[k - 1] - shift);
          rel[k] = Math.min(360, rel[k] + shift);
        }
      }
    }

    var planetGroup = el('g', { 'class': 'wheel-planets' });
    planets.forEach(function (p, idx) {
      var meta = PLANET_META[p.name] || { glyph: '?', key: p.name.toLowerCase() };
      var displayLon = (rel[idx] + ascLon) % 360;
      var gp = lonToXY(displayLon, ascLon, R_PLANET_GLYPH);
      var lp = lonToXY(displayLon, ascLon, R_PLANET_LABEL);

      var fill = (p.name === 'Sun') ? 'var(--gold)' :
                 (p.name === 'Moon') ? 'var(--primary)' :
                 'var(--ink)';

      // tick from true longitude to display position (helps users see we
      // moved the glyph slightly to declutter)
      if (Math.abs(rel[idx] - ((p.longitude - ascLon) % 360 + 360) % 360) > 0.5) {
        var truePt = lonToXY(p.longitude, ascLon, R_HOUSE_INNER + 4);
        var pegPt  = lonToXY(displayLon, ascLon, R_HOUSE_INNER + 18);
        planetGroup.appendChild(el('line', {
          x1: truePt.x, y1: truePt.y, x2: pegPt.x, y2: pegPt.y,
          stroke: 'var(--ink-muted)',
          'stroke-width': 0.75,
          opacity: 0.5
        }));
      }

      var glyphText = el('text', {
        x: gp.x, y: gp.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': '"Noto Serif", serif',
        'font-size': 22,
        fill: fill
      }, meta.glyph);
      planetGroup.appendChild(glyphText);

      // Retrograde superscript
      if (p.retrograde) {
        planetGroup.appendChild(el('text', {
          x: gp.x + 14, y: gp.y - 10,
          'text-anchor': 'start',
          'dominant-baseline': 'middle',
          'font-family': 'Manrope, system-ui, sans-serif',
          'font-size': 12,
          fill: 'var(--gold-hover)'
        }, '℞'));
      }

      // Degree label
      planetGroup.appendChild(el('text', {
        x: lp.x, y: lp.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': 'Manrope, system-ui, sans-serif',
        'font-size': 10,
        fill: 'var(--ink-muted)'
      }, dmStr(p)));

      // Accessibility: <title> for hover/screen-reader
      var title = document.createElementNS(SVG_NS, 'title');
      title.textContent = i18nLookup(locale, 'natal.planets.' + meta.key, p.name) +
        ' ' + dmStr(p) + ' ' +
        i18nLookup(locale, 'natal.signs.' + SIGN_KEYS[p.signIndex || 0], p.sign || '') +
        (p.retrograde ? ' (retrograde)' : '') +
        (p.house ? ' — house ' + p.house : '');
      glyphText.appendChild(title);
    });
    svgElement.appendChild(planetGroup);
  }

  // ---------- export ----------

  global.NatalWheel = { render: render };

}(typeof window !== 'undefined' ? window : this));
