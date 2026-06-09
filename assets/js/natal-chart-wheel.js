/* =====================================================================
 *  natal-chart-wheel.js  —  Luna-style D1 wheel, amethyst-tinted.
 *
 *  Public API (unchanged from the previous placeholder):
 *      window.NatalWheel.render(model, svgElement, options)
 *  ===================================================================
 *
 *  Provenance — Luna glyph artwork
 *  --------------------------------------------------------------------
 *  Sign / planet / aspect glyph path data in this file was ported from
 *  src/components/ChartWheel.jsx of the AstroBlueprint sister project,
 *  where it carries the comment "Symbol artwork lifted from Luna's own
 *  SVG export (user-authorized)."
 *
 *  If a future legal review concludes Luna Astrology's artwork should
 *  not be redistributed here, swap each <g id="luna-*"> block for the
 *  corresponding Unicode astrological glyph (♈♉♊… ☉☽☿…).
 *
 *  ===================================================================
 *  Port notes
 *  --------------------------------------------------------------------
 *  - All geometry, layout, leader-arc, and aspect math is preserved
 *    verbatim from ast/src/components/ChartWheel.jsx (LunaWheel).
 *  - Only color literals change: ast's blue/pink Luna palette is
 *    replaced with iyogau amethyst theme tokens (var(--*)).
 *  - The iyogau /api/calculate-chart response uses Western 10 planets
 *    (Sun..Saturn + Uranus, Neptune, Pluto). ast's chart uses Sun..
 *    Saturn + Rahu/Ketu. We adapt by:
 *      * mapping iyogau's `name` field to ast's `key`,
 *      * supplying luna-uranus / luna-neptune / luna-pluto symbol defs
 *        as Unicode glyph fallbacks (Luna has no artwork for them),
 *      * picking sensible amethyst hues for the three outer planets.
 *  - 0..100 viewBox is preserved; the page's 800x800 placeholder
 *    viewBox is overridden in render().
 * ===================================================================== */

(function (global) {
  'use strict';

  /* -----------------------------------------------------------------
   * Math primitives (inlined from ast/src/lib/chartMath.js +
   * ast/src/lib/astrology.js — kept identical so this file stays
   * verifiable against the source).
   * ----------------------------------------------------------------- */

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function signIndexFor(longitude) {
    return Math.floor(normalizeDegrees(longitude) / 30);
  }

  function splitLongitude(longitude) {
    var totalMinutes = Math.round(normalizeDegrees(longitude) * 60) % (360 * 60);
    var sign = Math.floor(totalMinutes / (30 * 60));
    var minutesInSign = totalMinutes - sign * 30 * 60;
    return {
      sign: sign,
      degree: Math.floor(minutesInSign / 60),
      minute: minutesInSign % 60
    };
  }

  function houseNumber(signIdx, ascSign) {
    return ((signIdx - ascSign + 12) % 12) + 1;
  }

  function angleDistance(a, b) {
    var diff = Math.abs(normalizeDegrees(a - b));
    return diff > 180 ? 360 - diff : diff;
  }

  function formatDegree(longitude) {
    var s = splitLongitude(longitude);
    return s.degree + 'd ' + (s.minute < 10 ? '0' + s.minute : s.minute) + 'm ' + SIGNS[s.sign].short;
  }

  /* -----------------------------------------------------------------
   * SIGNS table (inlined from ast/src/lib/data.js).
   * ----------------------------------------------------------------- */

  var SIGNS = [
    { name: 'Aries',       short: 'Ar', element: 'Fire',  mode: 'Move'  },
    { name: 'Taurus',      short: 'Ta', element: 'Earth', mode: 'Fixed' },
    { name: 'Gemini',      short: 'Ge', element: 'Air',   mode: 'Dual'  },
    { name: 'Cancer',      short: 'Ca', element: 'Water', mode: 'Move'  },
    { name: 'Leo',         short: 'Le', element: 'Fire',  mode: 'Fixed' },
    { name: 'Virgo',       short: 'Vi', element: 'Earth', mode: 'Dual'  },
    { name: 'Libra',       short: 'Li', element: 'Air',   mode: 'Move'  },
    { name: 'Scorpio',     short: 'Sc', element: 'Water', mode: 'Fixed' },
    { name: 'Sagittarius', short: 'Sa', element: 'Fire',  mode: 'Dual'  },
    { name: 'Capricorn',   short: 'Cp', element: 'Earth', mode: 'Move'  },
    { name: 'Aquarius',    short: 'Aq', element: 'Air',   mode: 'Fixed' },
    { name: 'Pisces',      short: 'Pi', element: 'Water', mode: 'Dual'  }
  ];

  /* -----------------------------------------------------------------
   * Color tables — amethyst tokens replacing ast's Luna hex palette.
   * Using var(--token) so the wheel re-tints automatically if the
   * site's theme picker is ever unhidden.
   * ----------------------------------------------------------------- */

  var ELEMENT_COLORS = {
    Fire:  'var(--gold-hover)',     // ast: #e52a6f
    Earth: 'var(--primary-hover)',  // ast: #984680
    Air:   'var(--primary-soft)',   // ast: #0bb5c3
    Water: 'var(--primary)'         // ast: #464fff
  };

  /* Per-planet hues. Values live in natal-chart.css as --planet-<name>
   * custom properties so themes can override them via :root or
   * [data-theme=...]. The same color is applied to the glyph fill AND
   * the radial degree-line stroke (see render() below), so each leader
   * is visually traceable back to its planet. */
  var PLANET_COLORS = {
    Sun:     'var(--planet-sun)',
    Moon:    'var(--planet-moon)',
    Mercury: 'var(--planet-mercury)',
    Venus:   'var(--planet-venus)',
    Mars:    'var(--planet-mars)',
    Jupiter: 'var(--planet-jupiter)',
    Saturn:  'var(--planet-saturn)',
    Uranus:  'var(--planet-uranus)',
    Neptune: 'var(--planet-neptune)',
    Pluto:   'var(--planet-pluto)',
    Rahu:    'var(--planet-rahu)',
    Ketu:    'var(--planet-ketu)'
  };

  // Map iyogau planet names → Luna symbol ids.
  var PLANET_GLYPH_IDS = {
    Sun:     'sun',
    Moon:    'moon',
    Mercury: 'mercury',
    Venus:   'venus',
    Mars:    'mars',
    Jupiter: 'jupiter',
    Saturn:  'saturn',
    Uranus:  'uranus',     // Unicode-glyph fallback (no Luna artwork)
    Neptune: 'neptune',    // ditto
    Pluto:   'pluto',      // ditto
    // Rahu / Ketu both ride the Luna lunar-node artwork. Following ast's
    // convention, Ketu uses the same glyph but is rotated 180° elsewhere
    // in render() when present (descending node = ascending node flipped).
    Rahu:    'lunar-true-nodes',
    Ketu:    'lunar-true-nodes'
  };

  var SIGN_GLYPH_IDS = [
    'aries','taurus','gemini','cancer','leo','virgo',
    'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
  ];

  var ASPECT_RULES = [
    { angle: 0,   type: 'conjunction' },
    { angle: 60,  type: 'sextile'     },
    { angle: 90,  type: 'square'      },
    { angle: 120, type: 'trine'       },
    { angle: 150, type: 'inconjunct'  },
    { angle: 180, type: 'opposition'  }
  ];

  // Luna's 3-tone aspect palette → amethyst.
  var ASPECT_COLORS = {
    trine:      'var(--primary)',     // ast: #0bb5c3
    sextile:    'var(--primary)',     // ast: #0bb5c3
    square:     'var(--gold-hover)',  // ast: #e52a6f
    opposition: 'var(--gold-hover)',  // ast: #e52a6f
    inconjunct: 'var(--ink-muted)'    // ast: #464fff
  };

  /* -----------------------------------------------------------------
   * Geometry — Luna's exact radii on a 0–100 viewBox.
   * Identical to the L block in ast/src/components/ChartWheel.jsx.
   * Visible-ink scale multipliers are PROVEN by ast's verify-glyphs.html
   * harness; do not "tidy" them.
   * ----------------------------------------------------------------- */

  var L = {
    outer:        50,                  // background disc
    zodiacBand:   45.16,               // white zodiac band outer edge
    field:        44.28,               // main lavender field top
    innerBand:    25.36,               // house-number band outer edge
    centralDisc:  22.28,               // central aspect disc
    signGlyphR:   47.58,               // rim sign glyphs
    signGlyphScale:       0.0484 * 0.55,
    planetGlyphR: 39.5,               // user directive 2026-06-09 (v3): SINGLE constant ring for ALL planet glyphs. The radialSlot offset from 13aa292 is reverted — every glyph lands at exactly L.planetGlyphR regardless of cluster membership. Cluster separation is handled by (a) the angular fan in layoutPlanets and (b) a per-cluster-index stagger of the LEADER ARC RADIUS (see the leader-geometry block below). The RED outer-segment touching the degree-tick is constant length for every planet so every degree-tick anchor reads identically; the GREEN inner-segment length absorbs the cluster stagger.
    planetGlyphScale:     0.0484 * 0.821,
    degreeR:      35.34,
    signGlyphInR: 32.22,
    planetSignGlyphScale: 0.0484 * 0.4104,
    minuteR:      29.81,
    aspectGlyphScale:     0.4456 * 0.88 * 0.05
  };

  /* -----------------------------------------------------------------
   * Leader-path geometry — user directive 2026-06-09 (latest revision).
   *
   * Up to four sub-segments per leader. The RED outer segment is a
   * CONSTANT length for every planet; the GREEN inner segment absorbs
   * the per-cluster stagger; the glyph sits at L.planetGlyphR exactly,
   * but GREEN stops GLYPH_STANDOFF units OUTSIDE the glyph centre so
   * the leader stroke does not crash through the glyph artwork.
   *
   *     ● R_OUT, exactDegree                          (outer anchor on L.field)
   *     |  RED   (constant length = RED_LENGTH for every planet)
   *     ● R_MID_BASE, exactDegree                     (corner 1)
   *     |  connector  (length = i × STAGGER_STEP; empty when i=0)
   *     ● arcRadius_i, exactDegree                    (corner 2)
   *     ↳ arc along arcRadius_i, exactDegree → fannedDegree
   *     ● arcRadius_i, fannedDegree                   (corner 3)
   *     |  GREEN (length = arcRadius_i − (planetGlyphR + GLYPH_STANDOFF))
   *     ● planetGlyphR + GLYPH_STANDOFF, fannedDegree (GREEN endpoint, gap above glyph)
   *     ·· (GLYPH_STANDOFF gap — leader stops here)
   *     ● planetGlyphR, fannedDegree                  (glyph centre, no stroke)
   *
   * Spec:
   *   - RED (R_OUT → R_MID_BASE at exact longitude) is identical for
   *     every planet → every degree-tick anchor reads the same.
   *   - The arc radius walks inward by exactly STAGGER_STEP per cluster
   *     slot, where STAGGER_STEP = 2 × LEADER_STROKE_WIDTH. The 2×
   *     spacing means adjacent staggered arcs are separated by exactly
   *     one stroke-width of background — a 0.08-wide line, then a
   *     0.08-wide background gap, then the next 0.08-wide line — so a
   *     5-planet stellium produces 5 visually distinct nested arcs.
   *   - GREEN length therefore varies only by i × STAGGER_STEP.
   *   - All glyphs are centred on L.planetGlyphR exactly — single ring.
   *   - GREEN's inner endpoint is at (planetGlyphR + GLYPH_STANDOFF),
   *     leaving ~GLYPH_STANDOFF viewBox units of visible gap between
   *     the leader and the glyph artwork. Total radial reach of the
   *     visible leader: R_OUT − (planetGlyphR + GLYPH_STANDOFF) −
   *     i × STAGGER_STEP.
   * ----------------------------------------------------------------- */
  var R_OUT               = L.field;             // 44.28 — outer anchor at field-ring edge
  var RED_LENGTH          = 0.946;               // CONSTANT length of the RED outer segment for EVERY planet
  var R_MID_BASE          = R_OUT - RED_LENGTH;  // 43.334 — base arc radius (solo planets / cluster slot 0)
  var LEADER_STROKE_WIDTH = 0.08;                // matches CSS .luna-leader stroke-width
  var STAGGER_STEP        = 2 * LEADER_STROKE_WIDTH; // 0.16 — per-cluster-slot radial step (2× = 1 line + 1 background-gap between adjacent lines)
  var GLYPH_STANDOFF      = 2.0;                 // viewBox units; leader GREEN segment stops this far ABOVE planetGlyphR so glyph artwork is not crossed

  /* -----------------------------------------------------------------
   * Trig helpers — verbatim from ast/src/components/ChartWheel.jsx.
   * arcPath / ringSegmentPath are unused by LunaWheel but kept for
   * parity with the source file.
   * ----------------------------------------------------------------- */

  function polar(center, radius, degrees) {
    var rad = ((degrees - 90) * Math.PI) / 180;
    return [center + Math.cos(rad) * radius, center + Math.sin(rad) * radius];
  }

  // eslint-disable-next-line no-unused-vars
  function arcPath(center, radius, start, end) {
    var s = polar(center, radius, start);
    var e = polar(center, radius, end);
    var large = (end - start) <= 180 ? 0 : 1;
    return 'M ' + s[0] + ' ' + s[1] +
      ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + e[0] + ' ' + e[1];
  }

  // eslint-disable-next-line no-unused-vars
  function ringSegmentPath(center, outerRadius, innerRadius, start, end) {
    var oS = polar(center, outerRadius, start);
    var oE = polar(center, outerRadius, end);
    var iE = polar(center, innerRadius, end);
    var iS = polar(center, innerRadius, start);
    var large = (end - start) <= 180 ? 0 : 1;
    return [
      'M ' + oS[0] + ' ' + oS[1],
      'A ' + outerRadius + ' ' + outerRadius + ' 0 ' + large + ' 1 ' + oE[0] + ' ' + oE[1],
      'L ' + iE[0] + ' ' + iE[1],
      'A ' + innerRadius + ' ' + innerRadius + ' 0 ' + large + ' 0 ' + iS[0] + ' ' + iS[1],
      'Z'
    ].join(' ');
  }

  function chartAngle(longitude, ascendant) {
    if (Number.isFinite(ascendant)) {
      return normalizeDegrees(ascendant - longitude + 270);
    }
    return normalizeDegrees(longitude);
  }

  /* -----------------------------------------------------------------
   * Aspect math — verbatim from ast.
   * ----------------------------------------------------------------- */

  function aspectBetween(a, b) {
    var distance = angleDistance(a, b);
    var hits = ASPECT_RULES
      .map(function (rule) { return { angle: rule.angle, type: rule.type, orb: Math.abs(distance - rule.angle) }; })
      .filter(function (rule) { return rule.orb <= 6; })
      .sort(function (x, y) { return x.orb - y.orb; });
    return hits[0];
  }

  function buildAspects(planets) {
    var aspects = [];
    for (var i = 0; i < planets.length; i += 1) {
      for (var j = i + 1; j < planets.length; j += 1) {
        var aspect = aspectBetween(planets[i].longitude, planets[j].longitude);
        if (aspect) {
          aspects.push({
            id: planets[i].key + '-' + planets[j].key + '-' + aspect.type,
            from: planets[i],
            to: planets[j],
            angle: aspect.angle,
            type: aspect.type,
            orb: aspect.orb
          });
        }
      }
    }
    return aspects.sort(function (a, b) { return b.orb - a.orb; });
  }

  function aspectEndpoints(aspect, asc) {
    var p1 = polar(50, L.centralDisc, chartAngle(aspect.from.longitude, asc));
    var p2 = polar(50, L.centralDisc, chartAngle(aspect.to.longitude, asc));
    return { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], mx: (p1[0] + p2[0]) / 2, my: (p1[1] + p2[1]) / 2 };
  }

  /* -----------------------------------------------------------------
   * layoutPlanets — verbatim cluster-fanning algorithm from ast.
   * Crowded stelliums fan ANGULARLY on a single ring so glyphs never
   * overlap and never get pushed onto the inner house-number band.
   * ----------------------------------------------------------------- */

  function layoutPlanets(planets) {
    var sorted = planets.slice().sort(function (a, b) { return a.longitude - b.longitude; });
    var clusters = [];
    sorted.forEach(function (planet) {
      var current = clusters[clusters.length - 1];
      var previous = current && current[current.length - 1];
      if (previous && angleDistance(planet.longitude, previous.longitude) < 16) {
        current.push(planet);
      } else {
        clusters.push([planet]);
      }
    });

    if (clusters.length > 1) {
      var first = clusters[0][0];
      var lastCluster = clusters[clusters.length - 1];
      var last = lastCluster[lastCluster.length - 1];
      if (first && last && angleDistance(first.longitude, last.longitude) < 13) {
        clusters[0] = lastCluster.concat(clusters[0]);
        clusters.pop();
      }
    }

    var out = [];
    clusters.forEach(function (cluster) {
      // Angular fan: 11° per planet for clusters of 2-3, 10° per planet
      // for clusters of 4+. This is the ONLY separation mechanism — see
      // the leader-geometry comment block above for the reasoning.
      var spread = cluster.length > 3 ? 10 : 11;
      cluster.forEach(function (planet, index) {
        var labelLongitude = normalizeDegrees(
          planet.longitude + (index - (cluster.length - 1) / 2) * spread
        );
        out.push(Object.assign({}, planet, {
          clusterSize: cluster.length,
          clusterIndex: index,
          labelLongitude: labelLongitude
        }));
      });
    });
    return out;
  }

  function placeGlyph(angle, radius, scale) {
    var p = polar(50, radius, angle);
    return 'translate(' + p[0] + ' ' + p[1] + ') scale(' + scale + ') translate(-50 -50)';
  }

  /* -----------------------------------------------------------------
   * DOM helpers.
   * ----------------------------------------------------------------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  function el(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          var v = attrs[k];
          if (v === undefined || v === null || v === false) continue;
          // `href` on SVG <use> works in modern browsers without xlink, but for
          // older browsers we mirror to xlink:href for safety.
          if (k === 'href' && tag === 'use') {
            node.setAttributeNS(XLINK_NS, 'xlink:href', String(v));
          }
          node.setAttribute(k, String(v));
        }
      }
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function tinted(color, child) {
    // ast uses inline style={{ color }} so the child's currentColor inherits.
    // setAttribute('style', ...) is the vanilla equivalent.
    var g = el('g', null);
    g.setAttribute('style', 'color: ' + color);
    g.appendChild(child);
    return g;
  }

  /* -----------------------------------------------------------------
   * LunaGlyphDefs — symbol artwork.
   * Sign / planet / aspect path strings are reproduced verbatim from
   * ast/src/components/ChartWheel.jsx (see Provenance block at top).
   * Each <g id="luna-*"> wraps a single <path> whose fill=currentColor
   * so the parent <g style="color:…"> tints it.
   *
   * Uranus / Neptune / Pluto are not in Luna's original export — we
   * fall back to Unicode astrological glyphs centered at the same
   * (50, 50) symbol-space origin so the placeGlyph() transform pipeline
   * still works unmodified.
   *
   * Per-entry: { id, d, scale }  (scale 4.166666… = original 24x24 box;
   * scale 0.520833… = original 192x192 box). Falls back to entries
   * with `unicode` for Uranus/Neptune/Pluto.
   * ----------------------------------------------------------------- */

  var LUNA_GLYPH_TRANSFORM_24 = 'scale(4.1666666666667)';
  var LUNA_GLYPH_TRANSFORM_192 = 'scale(0.52083333333333)';

  // Path strings are static literal constants (not user input).
  // They were copied verbatim from ChartWheel.jsx so this file stays
  // diffable against the source.
  var LUNA_DEFS = [
    { id: 'aries',       t: LUNA_GLYPH_TRANSFORM_24,  d: 'M13 20c0 .6-.4 1-1 1s-1-.4-1-1V7.3C11 5.5 9.5 4 7.8 4S4.5 5.5 4.5 7.3s1.5 3.3 3.2 3.3c.6 0 1 .4 1 1s-.4 1-1 1c-2.9 0-5.2-2.4-5.2-5.3S4.8 2 7.8 2c1.7 0 3.2.9 4.2 2.2C13 2.9 14.5 2 16.2 2c2.9 0 5.2 2.4 5.2 5.3s-2.3 5.3-5.2 5.3c-.6 0-1-.4-1-1s.4-1 1-1c1.8 0 3.2-1.5 3.2-3.3S18 4 16.2 4 13 5.5 13 7.3V20z' },
    { id: 'taurus',      t: LUNA_GLYPH_TRANSFORM_24,  d: 'M20 13c0 4.4-3.6 8-8 8s-8-3.6-8-8c0-3 1.6-5.6 4.1-7-1-.6-2-1.3-2.7-2.3-.4-.4-.3-1.1.1-1.4.5-.3 1.1-.2 1.4.2C8.1 4 9.7 4.9 11.5 5h1c1.8-.1 3.5-1 4.6-2.5.3-.4 1-.5 1.4-.2.4.3.5 1 .2 1.4C18 4.7 17 5.5 16 6c2.4 1.4 4 4 4 7zM6 13c0 3.3 2.7 6 6 6s6-2.7 6-6c0-3.2-2.4-5.7-5.5-6h-1C8.4 7.3 6 9.8 6 13z' },
    { id: 'gemini',      t: LUNA_GLYPH_TRANSFORM_24,  d: 'M9 18.4V5.8c2 .3 4 .3 6 0v12.6c-2-.4-4-.4-6 0zm8 .5V5.3c.9-.3 1.7-.6 2.5-1 .5-.2.6-.8.4-1.3-.3-.5-.9-.7-1.4-.4-3.8 2-9.3 2-13.1-.1-.4-.2-1-.1-1.3.4S4 4 4.5 4.3c.8.4 1.6.7 2.5 1v13.5c-.9.3-1.7.6-2.5 1-.5.3-.7.9-.4 1.4.3.5.9.7 1.4.4 3.8-2.1 9.2-2.1 13 0 .5.3 1.1.1 1.4-.4.3-.5.1-1.1-.4-1.4-.8-.3-1.6-.7-2.5-.9z' },
    { id: 'cancer',      t: LUNA_GLYPH_TRANSFORM_24,  d: 'M4.9 3.8s.1-.1.2-.1C9.9.4 17 2.1 20.7 6.6c.4.4.3 1-.1 1.4-.4.4-1.1.3-1.4-.1-2.2-2.5-5.6-4-8.8-3.8 1 .8 1.7 2.1 1.7 3.5C12 10 10 12 7.5 12S3 10 3 7.5c0-1.5.7-2.8 1.9-3.7zM13.7 20c-1-.8-1.7-2.1-1.7-3.5 0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5c0 1.5-.7 2.8-1.9 3.7l-.2.2c-4.8 3.2-11.9 1.5-15.6-3-.4-.4-.3-1 .1-1.4.4-.4 1.1-.3 1.4.1 2.2 2.6 5.6 4 8.9 3.9zM7.5 10C8.9 10 10 8.9 10 7.5S8.9 5 7.5 5 5 6.1 5 7.5 6.1 10 7.5 10zm9 9c1.4 0 2.5-1.1 2.5-2.5S17.9 14 16.5 14 14 15.1 14 16.5s1.1 2.5 2.5 2.5z' },
    { id: 'leo',         t: LUNA_GLYPH_TRANSFORM_24,  d: 'M12 15.5C12 18 10 20 7.5 20S3 18 3 15.5 5 11 7.5 11h.3c-2-5 .1-9 5.8-9 7.6 0 8.8 5.8 3.4 13.7-1.2 1.7-1.2 3.1-.5 3.9.7.7 1.9.7 2.8-.1.4-.4 1.1-.3 1.4.1.4.4.3 1.1-.1 1.4-1.7 1.5-4.1 1.4-5.5 0-1.5-1.5-1.5-4 .2-6.4C20 7.8 19.2 4 13.6 4c-4.8 0-6 3.7-2.6 8.6.6.8 1 1.8 1 2.9zm-2.6-1.7c-.5-.5-1.2-.8-1.9-.8C6.1 13 5 14.1 5 15.5S6.1 18 7.5 18s2.5-1.1 2.5-2.5c0-.5-.1-.9-.4-1.3l-.1-.1c0-.1-.1-.2-.1-.3z' },
    { id: 'virgo',       t: LUNA_GLYPH_TRANSFORM_24,  d: 'M19.8 11.6c0 2.6-1 4.4-2.8 5.4v-6.6c0-.8.6-1.4 1.4-1.4.8 0 1.4.6 1.4 1.4v1.2zM17 7.3v-.6c0-2-1.5-3.7-3.5-3.7-1 0-1.9.4-2.5 1.1C10.4 3.4 9.5 3 8.5 3S6.6 3.4 6 4.1c-.6-.6-1.4-1-2.3-1.1-.5-.1-1 .3-1.1.9-.1.5.3 1 .9 1.1.9.1 1.5.8 1.5 1.7v13.1c0 .6.4 1 1 1s1-.4 1-1V6.7C7 5.7 7.7 5 8.5 5s1.5.7 1.5 1.7v13.1c0 .6.4 1 1 1s1-.4 1-1V6.7c0-1 .7-1.7 1.5-1.7s1.5.7 1.5 1.7v11c-.3.1-.7.1-1 .1-.6 0-1 .5-1 1 0 .6.5 1 1 1 .3 0 .6 0 .9-.1V21c0 .6.4 1 1 1s1-.4 1-1v-1.8c2.9-1.1 4.8-3.8 4.8-7.6v-1.2c0-1.9-1.5-3.4-3.4-3.4-.4 0-.9.1-1.3.3z' },
    { id: 'libra',       t: LUNA_GLYPH_TRANSFORM_24,  d: 'M18 10.1C18 6.7 15.3 4 12 4s-6 2.7-6 6.1c0 1 .3 2 .7 2.9H2c-.6 0-1 .4-1 1s.4 1 1 1h8c.6 0 1-.4 1-1s-.4-1-1-1h-.8c-.8-.8-1.2-1.8-1.2-2.9C8 7.8 9.8 6 12 6s4 1.8 4 4.1c0 1.1-.4 2.1-1.2 2.9H14c-.6 0-1 .4-1 1s.4 1 1 1h7.9c.6 0 1-.4 1-1s-.4-1-1-1h-4.6c.5-.9.7-1.9.7-2.9zm4 8.9c.6 0 1-.4 1-1s-.4-1-1-1H2c-.6 0-1 .4-1 1s.4 1 1 1h20z' },
    { id: 'scorpio',     t: LUNA_GLYPH_TRANSFORM_192, d: 'm182.6 139.5-15.9-23.9c-2.4-3.7-7.4-4.7-11.1-2.2-3.7 2.4-4.7 7.4-2.2 11.1L161 136h-21.1c-6.5 0-12-5.6-12-12.6V45.6c0-16.3-12.3-29.6-28-29.6-7.9 0-15 3.4-20 8.8-5-5.4-12.1-8.8-20-8.8-8 0-15.2 3.5-20.2 9.1-4.6-4.8-7.8-8.1-14.9-9-4.4-.6-8.4 2.5-9 6.9-.6 4.4 2.5 8.4 6.9 9 7.1.9 9.2 6.6 9.2 13.7v105.8c0 4.6 3.9 8.3 8.5 8 4.3-.3 7.5-4 7.5-8.3V45.5c.1-7.7 5.5-13.5 12-13.5 6.6 0 12 5.9 12 13.6v105.8c0 4.6 3.9 8.3 8.5 8 4.3-.3 7.5-4 7.5-8.3V45.6c0-7.7 5.4-13.6 12-13.6s12 5.9 12 13.6v77.8c0 15.7 12.5 28.6 28 28.6H161l-7.7 11.6c-2.5 3.7-1.5 8.6 2.2 11.1 1.4.9 2.9 1.3 4.4 1.3 2.6 0 5.1-1.3 6.7-3.6l15.9-23.9c1.9-2.7 1.9-6.3.1-9zm-16.6 5.1v-1.1l.4.6-.4.5z' },
    { id: 'sagittarius', t: LUNA_GLYPH_TRANSFORM_24,  d: 'M19 6.5V12c0 .6.4 1 1 1s1-.4 1-1V4c0-.6-.4-1-1-1h-8c-.6 0-1 .4-1 1s.4 1 1 1h5.5l-8 8-1.7-1.7c-.4-.4-1.1-.4-1.5 0s-.4 1.1 0 1.5L8 14.5l-4.8 4.8c-.4.4-.4 1.1 0 1.5s1.1.4 1.5 0L9.5 16l1.7 1.7c.4.4 1.1.4 1.5 0s.4-1.1 0-1.5L11 14.5l8-8z' },
    { id: 'capricorn',   t: LUNA_GLYPH_TRANSFORM_24,  d: 'M18.2 11.6c2.6 0 4.8-2.2 4.8-4.8S20.9 2 18.2 2s-4.8 2.2-4.8 4.8c0 .3 0 .6.1.9-.8-.8-1.5-2.1-2.3-3.7-.4-.8-1.6-.8-1.9.1L6.2 14.2l-2.4-8c-.2-.6-.8-.9-1.3-.7-.5.2-.8.7-.7 1.3l3.4 11.1c.3.9 1.6.9 1.9 0L10.5 7s.2.3.2.4c1.3 2.1 2.8 3.3 4.8 3.9 2.8 5.6 1.4 8.7-3.8 8.7h-1.4c-.6 0-1 .4-1 1s.4 1 1 1h1.4c6.5 0 8.7-4.2 6.2-10.4h.3zm0-2c-1.5 0-2.8-1.3-2.8-2.8S16.7 4 18.2 4C19.8 4 21 5.3 21 6.8s-1.2 2.8-2.8 2.8z' },
    { id: 'aquarius',    t: LUNA_GLYPH_TRANSFORM_24,  d: 'm5.7 8.4 1.1 1.2c1.1 1.2 2.9 1.2 4 0L12 8.4l1.1 1.2c1.1 1.2 2.9 1.2 4 0l1.1-1.2 2.1 2.3c.4.4 1 .4 1.3 0 .4-.4.4-1 0-1.4l-2.8-3c-.4-.4-1-.4-1.3 0l-1.8 2c-.3.4-.9.4-1.3 0l-1.8-2c-.4-.4-1-.4-1.3 0l-1.8 2c-.3.4-.9.4-1.3 0l-1.8-2c-.4-.4-1-.4-1.3 0l-2.8 3c-.4.4-.4 1 0 1.4.4.4 1 .4 1.3 0l2.1-2.3zm0 7 1.1 1.2c1.1 1.2 2.9 1.2 4 0l1.1-1.2 1.1 1.2c1.1 1.2 2.9 1.2 4 0l1.1-1.2 2.1 2.3c.4.4 1 .4 1.3 0 .4-.4.4-1 0-1.4l-2.8-3c-.4-.4-1-.4-1.3 0l-1.8 2c-.3.4-.9.4-1.3 0l-1.8-2c-.4-.4-1-.4-1.3 0l-1.8 2c-.3.4-.9.4-1.3 0l-1.8-2c-.4-.4-1-.4-1.3 0l-2.8 3c-.4.4-.4 1 0 1.4.4.4 1 .4 1.3 0l2.2-2.3z' },
    { id: 'pisces',      t: LUNA_GLYPH_TRANSFORM_24,  d: 'M12.9 11c.3-3.8 2-7.3 5.2-8.9.5-.2 1.1 0 1.3.5s0 1.1-.5 1.3c-2.5 1.2-3.8 4.1-4 7.1h4.3c.6 0 1 .4 1 1s-.4 1-1 1h-4.3c.2 3 1.6 5.9 4 7.1.5.2.7.8.5 1.3s-.8.7-1.3.5c-3.2-1.6-4.9-5.1-5.2-8.9h-2.8c-.3 3.8-2 7.3-5.2 8.9-.5.2-1.1 0-1.3-.5s0-1.1.5-1.3c2.5-1.2 3.8-4.1 4-7.1H3.8c-.6 0-1-.4-1-1s.4-1 1-1h4.3c-.2-3-1.6-5.9-4-7.1-.5-.2-.7-.8-.5-1.3s.9-.7 1.4-.5c3.2 1.6 4.9 5.1 5.2 8.9h2.7z' },
    { id: 'sun',         t: LUNA_GLYPH_TRANSFORM_24,  d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 2c4.4 0 8 3.6 8 8s-3.6 8-8 8-8-3.6-8-8 3.6-8 8-8zm0 10c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z' },
    { id: 'moon',        t: LUNA_GLYPH_TRANSFORM_192, d: 'M88 16c-18.6 0-36.5 6.4-50.7 17.9-5.7 4.6-2.7 13.9 4.7 14.2C67.5 49.2 96 70.3 96 96s-28.5 46.8-54 47.9c-7.3.3-10.4 9.6-4.7 14.2C51.5 169.6 69.4 176 88 176c44.2 0 80-35.8 80-80s-35.8-80-80-80zm0 144c-14.9 0-23.7-4.8-23.7-4.8s4.8-2.2 6.6-3.2c19.8-10.9 41.1-32 41.1-56.1 0-24.7-22-46.3-42.7-56.9-1.7-.9-5.1-2.4-5.1-2.4S73.1 32 88 32c35.3 0 64 28.7 64 64s-28.7 64-64 64z' },
    { id: 'mercury',     t: LUNA_GLYPH_TRANSFORM_24,  d: 'M12 14c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5M6.8 4.3C5.7 5.5 5 7.2 5 9c0 3.5 2.6 6.4 6 6.9V18H9.2c-.6 0-1 .4-1 1s.4 1 1 1H11v2c0 .6.4 1 1 1s1-.4 1-1v-2h2c.6 0 1-.4 1-1s-.4-1-1-1h-2v-2.1c3.4-.5 6-3.4 6-6.9 0-1.8-.7-3.5-1.8-4.7L18.4 3c.4-.4.4-1 0-1.4-.4-.4-1-.4-1.4 0L15.6 3c-1.1-.6-2.3-1-3.6-1s-2.5.4-3.6 1L7 1.6c-.4-.4-1-.4-1.4 0-.4.4-.4 1 0 1.4l1.2 1.3z' },
    { id: 'venus',       t: LUNA_GLYPH_TRANSFORM_24,  d: 'M13 16.4c3.9-.5 7-3.9 7-7.9 0-4.4-3.6-8-8-8s-8 3.6-8 8c0 4.1 3.1 7.4 7 7.9v2.1H9.2c-.6 0-1 .4-1 1s.4 1 1 1H11v2c0 .6.4 1 1 1s1-.4 1-1v-2h2c.6 0 1-.4 1-1s-.4-1-1-1h-2v-2.1zm-1-1.9c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z' },
    { id: 'mars',        t: LUNA_GLYPH_TRANSFORM_24,  d: 'M10 20c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6M21 2h-6.7c-.6 0-1 .4-1 1s.4 1 1 1h4.3l-3.7 3.7C13.6 6.6 11.8 6 10 6c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8c0-1.8-.6-3.6-1.7-4.9L20 5.4v4.3c0 .6.4 1 1 1s1-.4 1-1V3c0-.6-.4-1-1-1' },
    { id: 'jupiter',     t: LUNA_GLYPH_TRANSFORM_192, d: 'M168 120h-16V24c0-4.4-3.6-8-8-8s-8 3.6-8 8v96H89.7c1.8-1.6 3.5-3.2 5.1-5 19.3-21.4 17.5-51.2 17.2-55.3C111.8 34.3 95.1 16 72 16c-23.2 0-40 18.5-40 44 0 4.4 3.6 8 8 8s8-3.6 8-8c0-13.9 7.4-28 24-28s24 14.1 24 28v.8c0 .3 2.5 26.1-13.1 43.4C73.5 114.7 59 120 40 120c-4.4 0-8 3.6-8 8s3.6 8 8 8h96v32c0 4.4 3.6 8 8 8s8-3.6 8-8v-32h16c4.4 0 8-3.6 8-8s-3.6-8-8-8z' },
    { id: 'saturn',      t: LUNA_GLYPH_TRANSFORM_24,  d: 'M10 9.3V7h2c.6 0 1-.4 1-1s-.4-1-1-1h-2V3c0-.6-.4-1-1-1s-1 .4-1 1v2H6c-.6 0-1 .4-1 1s.4 1 1 1h2v14c0 .6.4 1 1 1s1-.4 1-1v-9.8h.2c.9-.1 1.9-.2 2.8-.1 1.5.2 2.5.8 2.9 1.8.2.6.1 1.4-.2 2.4-.1.4-.3.8-.5 1.4-1.1 2.6-1.2 3-.9 3.9.2.8.7 1.4 1.3 1.8.4.4 1 .6 1.4.6.5 0 1-.4 1-.9s-.4-1-.9-1c-.1 0-.3-.1-.5-.2s-.4-.4-.5-.7c-.1-.3.1-.8.9-2.7.3-.6.4-1.1.6-1.5.5-1.4.6-2.6.2-3.7-.7-1.9-2.3-2.8-4.5-3.1-1.1-.1-2.2-.1-3.3.1z' },
    { id: 'lunar-true-nodes', t: LUNA_GLYPH_TRANSFORM_192, d: 'M151 112.8c.4-.7.9-1.5 1.3-2.3 2-3.7 3.5-7.5 4.9-11.5 3.2-10.3 3.8-21.4 1.6-31.9-.9-4.1-2-8.1-3.8-12-2.4-5.7-5.6-11.1-9.6-15.8-2.6-3.2-5.5-5.9-8.6-8.6-1.6-1.3-3.2-2.5-4.9-3.7-5.2-3.5-10.8-6.2-16.8-8.1-10.3-3.2-21.4-3.8-32-1.6-4.1.9-8.1 2-12 3.8-9.5 4-17.9 10.3-24.4 18.2-1.3 1.6-2.5 3.2-3.7 4.9-2.2 3.4-4.3 7.1-5.9 10.9-5.1 11.8-6.4 25.2-3.8 37.8.9 4.1 2 8.1 3.8 12 .8 1.9 1.7 3.8 2.7 5.6.4.8.9 1.5 1.3 2.3C4.3 122 9.8 175 48.1 176c31.6-.2 43.7-40.8 18.1-58.4l-.6-.6c-9.7-7.9-16.1-19.8-17.2-32.2-.6-3.1-.4-6.5-.2-9.7 1.6-18.8 15.4-35.7 33.5-41 3.1-1 6.2-1.6 9.4-1.9 3.2-.3 6.6-.3 9.8 0 6.3.6 12.4 2.5 18 5.5 13.8 7.3 23.5 21.8 24.9 37.4.3 3.2.2 6.5 0 9.8-.6 6.3-2.5 12.4-5.5 18-2.9 5.4-7 10.3-11.7 14.2l-.6.6c-25.8 17.4-13.5 58.2 18 58.3 38.3-1 43.8-54.1 7-63.2zM48 160c-8.8 0-16-7.2-16-16s7.2-16 16-16 16 7.2 16 16-7.2 16-16 16zm96 0c-8.8 0-16-7.2-16-16s7.2-16 16-16 16 7.2 16 16-7.2 16-16 16z' },
    { id: 'trine',       t: LUNA_GLYPH_TRANSFORM_192, d: 'M173.7 150.3 106 23.3c-2.7-4.9-6.4-7.3-10-7.3s-7.3 2.4-10 7.3l-67.7 127c-5.5 9.7-.9 17.7 10.3 17.7h134.8c11.2 0 15.8-8 10.3-17.7zm-137.9 1.6L96 38l60.2 113.9H35.8z' },
    { id: 'sextile',     t: LUNA_GLYPH_TRANSFORM_192, d: 'M168 88.1h-57.7l32.5-52c2.3-3.7 1.2-8.7-2.5-11-3.7-2.3-8.7-1.2-11 2.5L95.9 80.9l-33-53c-2.3-3.8-7.3-4.9-11-2.6-3.8 2.3-4.9 7.3-2.6 11l32.2 51.8H24c-4.4 0-8 3.6-8 8s3.6 8 8 8h57.4l-32.3 51.7c-2.3 3.7-1.2 8.7 2.5 11 1.3.8 2.8 1.2 4.2 1.2 2.7 0 5.3-1.3 6.8-3.8l33.2-53.1 33.1 53.2c1.5 2.4 4.1 3.8 6.8 3.8 1.4 0 2.9-.4 4.2-1.2 3.8-2.3 4.9-7.3 2.6-11l-32.2-51.8H168c4.4 0 8-3.6 8-8s-3.6-8-8-8z' },
    { id: 'square',      t: LUNA_GLYPH_TRANSFORM_192, d: 'M160 16H32c-8.8 0-16 7.2-16 16v128c0 8.8 7.2 16 16 16h128c8.8 0 16-7.2 16-16V32c0-8.8-7.2-16-16-16zm0 144H32V32h128v128z' },
    { id: 'opposition',  t: LUNA_GLYPH_TRANSFORM_192, d: 'M135.9 15.6c-22.1 0-40 17.9-40 40 0 8.1 2.4 15.6 6.6 22l-25.8 24.2C70.7 98.1 63.6 96 56 96c-22.1 0-40 17.9-40 40s17.9 40 40 40 40-17.9 40-40c0-8.7-2.8-16.8-7.5-23.3l25.3-23.8c6.3 4.2 14 6.7 22.2 6.7 22.1 0 40-17.9 40-40-.1-22.1-18-40-40.1-40zM56 160c-13.2 0-24-10.8-24-24s10.8-24 24-24 24 10.8 24 24-10.8 24-24 24zm79.9-80.4c-13.2 0-24-10.8-24-24s10.8-24 24-24 24 10.8 24 24-10.8 24-24 24z' },
    { id: 'inconjunct',  t: LUNA_GLYPH_TRANSFORM_192, d: 'M114.4 47.9H168c4.4 0 8-3.6 8-8s-3.6-8-8-8H24c-4.4 0-8 3.6-8 8s3.6 8 8 8h53.6l-60.5 100c-2.3 3.8-1 8.7 2.7 11 3.8 2.3 8.7 1 11-2.7L96 48.4l65.1 107.7c2.3 3.8 7.2 5 11 2.7s5-7.2 2.7-11l-60.4-99.9z' },
    // ---- Iyogau-only Unicode-glyph fallbacks (Luna has no artwork) ----
    // Symbol-space origin is (50, 50); these <text> nodes are sized to
    // visually match the path-based planet glyphs after placeGlyph()'s
    // scale wrap.
    { id: 'uranus',  unicode: '♅' },
    { id: 'neptune', unicode: '♆' },
    { id: 'pluto',   unicode: '♇' }
  ];

  function buildLunaDefs() {
    var defs = el('defs', null);
    LUNA_DEFS.forEach(function (def) {
      var g = el('g', { id: 'luna-' + def.id });
      if (def.d) {
        // Path-based Luna glyph.
        g.appendChild(el('path', {
          d: def.d,
          transform: def.t,
          fill: 'currentColor',
          stroke: 'currentColor',
          'stroke-width': '0.3'
        }));
      } else if (def.unicode) {
        // Unicode-glyph fallback for Uranus/Neptune/Pluto.
        g.appendChild(el('text', {
          x: 50, y: 50,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: 'currentColor',
          'font-family': "'Noto Serif', serif",
          'font-size': 100,
          'font-weight': 600
        }, def.unicode));
      }
      defs.appendChild(g);
    });

    // Drop shadow. Luna's flood color was #3c386e (cool indigo); we use
    // ink (#2a1d34, the amethyst palette's deep tone) at lighter opacity
    // for a softer feel suited to the amethyst theme.
    // NB: var(--ink) won't resolve inside SVG-filter color attributes,
    // so we use the literal value here.
    var filter = el('filter', {
      id: 'luna-wheel-shadow',
      x: '-12%', y: '-12%', width: '124%', height: '124%'
    });
    filter.appendChild(el('feDropShadow', {
      dx: '0', dy: '1.4', stdDeviation: '1.5',
      'flood-color': '#2a1d34', 'flood-opacity': '0.10'
    }));
    defs.appendChild(filter);

    return defs;
  }

  /* -----------------------------------------------------------------
   * Adapter: convert iyogau API model -> ast-style planet objects.
   * iyogau:   { name: 'Sun', longitude, retrograde, signIndex, … }
   * ast:      { key:  'Sun', label, longitude, oob, … }
   * The wheel uses `key` for color/glyph lookup and `label||key` for
   * the screen-reader summary.
   * ----------------------------------------------------------------- */

  function adaptPlanets(modelPlanets, locale) {
    if (!Array.isArray(modelPlanets)) return [];
    return modelPlanets
      .filter(function (p) { return p && typeof p.longitude === 'number'; })
      .map(function (p) {
        return {
          key: p.name,
          label: i18nLookup(locale, 'natal.planets.' + String(p.name).toLowerCase(), p.name),
          longitude: p.longitude,
          retrograde: !!p.retrograde,
          // Iyogau's `oob` (out-of-bounds) is not in the API contract;
          // the leader will simply render in the muted-ink color.
          oob: false
        };
      });
  }

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

  /* -----------------------------------------------------------------
   * render()
   * ----------------------------------------------------------------- */

  function render(model, svgElement, options) {
    if (!model || !svgElement) return;
    options = options || {};
    var locale = options.locale || 'en';
    var title = options.title || 'Birth chart';

    // --- preserve <title>/<desc> for a11y, then clear the rest ----
    var preserve = [];
    Array.prototype.forEach.call(svgElement.childNodes, function (n) {
      if (n.nodeType === 1 && (n.tagName === 'title' || n.tagName === 'desc')) {
        preserve.push(n);
      }
    });
    while (svgElement.firstChild) svgElement.removeChild(svgElement.firstChild);
    preserve.forEach(function (n) { svgElement.appendChild(n); });

    // --- canvas setup ----
    svgElement.setAttribute('viewBox', '0 0 100 100');
    svgElement.setAttribute('role', 'img');
    svgElement.setAttribute('aria-label', title + ' natal chart wheel');

    var c = 50;
    var asc = (model.ascendant && typeof model.ascendant.longitude === 'number')
      ? model.ascendant.longitude : null;
    var mc = (model.midheaven && typeof model.midheaven.longitude === 'number')
      ? model.midheaven.longitude : null;
    var ascSign = Number.isFinite(asc) ? signIndexFor(asc) : 0;

    // angle markers (derived in-render — not an external param)
    var angleMarkers = [];
    if (Number.isFinite(asc)) {
      angleMarkers.push({ key: 'AC', longitude: asc, className: 'angle-marker-ac' });
      angleMarkers.push({ key: 'DC', longitude: normalizeDegrees(asc + 180), className: 'angle-marker-dc' });
    }
    if (Number.isFinite(mc)) {
      angleMarkers.push({ key: 'MC', longitude: mc, className: 'angle-marker-mc' });
      angleMarkers.push({ key: 'IC', longitude: normalizeDegrees(mc + 180), className: 'angle-marker-ic' });
    }

    var planets = adaptPlanets(model.planets, locale);
    var sorted = layoutPlanets(planets);
    var aspects = buildAspects(planets).filter(function (a) { return a.type !== 'conjunction'; });

    // Merge our classes into whatever the markup already had.
    var classBase = (svgElement.getAttribute('class') || '')
      .replace(/\bluna-wheel\b/g, '')
      .replace(/\bchart-wheel\b/g, '')
      .trim();
    svgElement.setAttribute('class', (classBase + ' chart-wheel luna-wheel').trim());

    // a11y link to the aspect list
    var aspectListId = (title || 'birth-chart').replace(/\s+/g, '-').toLowerCase() + '-aspects';
    if (aspects.length) svgElement.setAttribute('aria-describedby', aspectListId);
    else svgElement.removeAttribute('aria-describedby');

    // --- defs ----
    svgElement.appendChild(buildLunaDefs());

    // --- Layer A: concentric rings (outer -> inner) ---
    svgElement.appendChild(el('circle', { cx: c, cy: c, r: L.outer,       'class': 'luna-bg',          filter: 'url(#luna-wheel-shadow)' }));
    svgElement.appendChild(el('circle', { cx: c, cy: c, r: L.zodiacBand,  'class': 'luna-zodiac-band' }));
    svgElement.appendChild(el('circle', { cx: c, cy: c, r: L.field,       'class': 'luna-field' }));
    svgElement.appendChild(el('circle', { cx: c, cy: c, r: L.innerBand,   'class': 'luna-inner-band' }));
    svgElement.appendChild(el('circle', { cx: c, cy: c, r: L.centralDisc, 'class': 'luna-central-disc' }));

    // --- Layer B: 1° ticks around the zodiac band ---
    var tickGroup = el('g', { 'class': 'luna-ticks' });
    for (var deg = 0; deg < 360; deg += 1) {
      var ang = chartAngle(deg, asc);
      var isBoundary = (deg % 30) === 0;
      var isFive = (deg % 5) === 0;
      var tOuter = L.zodiacBand;
      // User directive 2026-06-09 (v3): degree-tick inner endpoints sit
      // OUTSIDE the planet-glyph ring (and outside L.field for most),
      // so the Sun glyph at a sign cusp never collides with a tick.
      // Boundary ticks stop at R_OUT − 0.3 = 43.98 (just inside L.field
      // = 44.28); five-ticks and 1° ticks are progressively shorter so
      // they stop comfortably outside the field ring.
      var tInner = isBoundary
        ? (R_OUT - 0.3)                      // boundary (30°) — stops 0.3 above R_OUT
        : (L.zodiacBand - (isFive ? 0.80 : 0.55));
      var tp1 = polar(c, tOuter, ang);
      var tp2 = polar(c, tInner, ang);
      var cls = 'luna-tick' +
        (isBoundary ? ' luna-tick-boundary' : isFive ? ' luna-tick-five' : '');
      tickGroup.appendChild(el('line', {
        x1: tp1[0], y1: tp1[1], x2: tp2[0], y2: tp2[1], 'class': cls
      }));
    }
    svgElement.appendChild(tickGroup);

    // --- Layer C: sign boundaries + rim glyphs ---
    // (Per-house-cusp degree labels intentionally omitted: in whole-sign
    // every cusp sits at 0° of its sign, so they'd render as 12 identical "0°".)
    var signGroup = el('g', { 'class': 'luna-signs' });
    SIGNS.forEach(function (sign, index) {
      var start = index * 30;
      var boundaryAngle = chartAngle(start, asc);
      var glyphAngle = chartAngle(start + 15, asc);
      var b1 = polar(c, L.zodiacBand, boundaryAngle);
      var b2 = polar(c, L.field, boundaryAngle);

      var group = el('g', null);
      group.appendChild(el('line', {
        x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1], 'class': 'luna-sign-boundary'
      }));
      var use = el('use', {
        'data-glyph': 'sign-rim',
        href: '#luna-' + SIGN_GLYPH_IDS[index],
        transform: placeGlyph(glyphAngle, L.signGlyphR, L.signGlyphScale)
      });
      group.appendChild(tinted(ELEMENT_COLORS[sign.element], use));
      signGroup.appendChild(group);
    });
    svgElement.appendChild(signGroup);

    // --- Layer D: house cusp lines + house numbers ---
    var houseGroup = el('g', { 'class': 'luna-houses' });
    for (var h = 0; h < 12; h += 1) {
      var hStart = h * 30;
      var hAng = chartAngle(hStart, asc);
      var hno = houseNumber(h, ascSign);
      var isAxis = (hno === 1 || hno === 4 || hno === 7 || hno === 10);
      var h1 = polar(c, L.field, hAng);
      var h2 = polar(c, L.centralDisc, hAng);
      var lblPos = polar(c, (L.innerBand + L.centralDisc) / 2, chartAngle(hStart + 15, asc));
      var hg = el('g', null);
      hg.appendChild(el('line', {
        x1: h1[0], y1: h1[1], x2: h2[0], y2: h2[1],
        'class': 'luna-house-line' + (isAxis ? ' luna-house-line-axis' : '')
      }));
      hg.appendChild(el('text', {
        x: lblPos[0], y: lblPos[1],
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'class': 'luna-house-number'
      }, String(hno)));
      houseGroup.appendChild(hg);
    }
    svgElement.appendChild(houseGroup);

    // --- Layer E: aspect chords (on the central-disc rim) ---
    var aspectGroup = el('g', { 'class': 'luna-aspects' });
    aspects.forEach(function (aspect) {
      var ep = aspectEndpoints(aspect, asc);
      aspectGroup.appendChild(el('line', {
        x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2,
        stroke: ASPECT_COLORS[aspect.type],
        'class': 'luna-aspect-line'
      }));
    });
    svgElement.appendChild(aspectGroup);

    // --- Layer F: aspect glyphs at each chord midpoint ---
    var aspectGlyphGroup = el('g', { 'class': 'luna-aspect-glyphs' });
    aspects.forEach(function (aspect) {
      var ep = aspectEndpoints(aspect, asc);
      var aUse = el('use', {
        href: '#luna-' + aspect.type,
        transform: 'translate(' + ep.mx + ' ' + ep.my + ') scale(' + L.aspectGlyphScale + ') translate(-50 -50)'
      });
      aspectGlyphGroup.appendChild(tinted(ASPECT_COLORS[aspect.type], aUse));
    });
    svgElement.appendChild(aspectGlyphGroup);

    // --- Layer G: Asc/Desc + MC/IC axis lines ---
    var axisGroup = el('g', { 'class': 'luna-axes' });
    if (Number.isFinite(asc)) {
      var aA = polar(c, L.field, chartAngle(asc, asc));
      var aB = polar(c, L.field, chartAngle(asc + 180, asc));
      axisGroup.appendChild(el('line', {
        x1: aA[0], y1: aA[1], x2: aB[0], y2: aB[1], 'class': 'luna-axis-line'
      }));
    }
    if (Number.isFinite(mc)) {
      var mA = polar(c, L.field, chartAngle(mc, asc));
      var mB = polar(c, L.field, chartAngle(mc + 180, asc));
      axisGroup.appendChild(el('line', {
        x1: mA[0], y1: mA[1], x2: mB[0], y2: mB[1],
        'class': 'luna-axis-line luna-axis-line-mc'
      }));
    }
    svgElement.appendChild(axisGroup);

    // --- Layer H: per-planet leader + glyph + degree / inner-sign / minute stack ---
    var planetGroup = el('g', { 'class': 'luna-planets' });
    sorted.forEach(function (planet) {
      var angle = chartAngle(planet.labelLongitude != null ? planet.labelLongitude : planet.longitude, asc);
      var exactAngle = chartAngle(planet.longitude, asc);
      var color = PLANET_COLORS[planet.key] || 'var(--ink-muted)';
      var s = splitLongitude(planet.longitude);
      // SINGLE PLANET RING (per user directive 2026-06-09 v3): every
      // glyph sits at exactly L.planetGlyphR. There is no per-planet
      // radial offset on the glyph itself — the radialSlot from 13aa292
      // is reverted. Cluster separation lives on the LEADER ARC: each
      // additional cluster member pulls its arc radius one stroke-width
      // further inward (see clusterIndex below).
      var glyphR = L.planetGlyphR;
      var glyphId = PLANET_GLYPH_IDS[planet.key] || 'sun'; // safety fallback
      var glyphTransform = placeGlyph(angle, glyphR, L.planetGlyphScale);

      // ---- Leader path (see top-of-file Leader-path geometry block) ----
      // Sub-segments (in render order):
      //   RED       : (R_OUT, exact)        → (R_MID_BASE, exact)         — constant for ALL
      //   connector : (R_MID_BASE, exact)   → (arcRadius_i, exact)        — empty when i = 0
      //   ARC       : (arcRadius_i, exact)  → (arcRadius_i, fanned)       — at the staggered radius
      //   GREEN     : (arcRadius_i, fanned) → (planetGlyphR, fanned)      — length varies by i
      // User directive 2026-06-09 (latest revision, supersedes audit-revert):
      // re-enable per-cluster stagger at TWICE the stroke width per slot, so
      // adjacent staggered arcs sit with one full stroke-width of background
      // colour between them (visible gap, not abutting lines). Exact user
      // phrasing: "make 2* thickness instead of 1*thickness which means we
      // have 1 thickness background color between lines".
      var arcRadius = R_MID_BASE - (planet.clusterIndex || 0) * STAGGER_STEP;

      var pRedOuter = polar(c, R_OUT,        exactAngle);  // start of RED (exact-degree tick anchor)
      var pRedInner = polar(c, R_MID_BASE,   exactAngle);  // end of RED / start of connector
      var pArcOuter = polar(c, arcRadius,    exactAngle);  // end of connector / start of ARC
      var pArcInner = polar(c, arcRadius,    angle);       // end of ARC / start of GREEN
      // GREEN ends GLYPH_STANDOFF units OUTSIDE the glyph centre, leaving
      // a visible gap so the stroke does not crash through the glyph art.
      // User directive 2026-06-09: "current path interfere the planet make
      // it a bit shorter as distance given using red arrow".
      var pGreenIn  = polar(c, L.planetGlyphR + GLYPH_STANDOFF, angle); // end of GREEN — stops above glyph

      // SVG arc params: short arc (large-arc-flag = 0); sweep direction
      // tracks the fan offset (signed, normalised to [-180, +180]).
      var deltaSigned = ((angle - exactAngle) % 360 + 540) % 360 - 180;
      var sweepFlag = (deltaSigned >= 0) ? 1 : 0;

      // Build the path. The "connector" L-segment collapses to a no-op
      // when arcRadius === R_MID_BASE (i.e. solo planet, clusterIndex = 0)
      // because pRedInner and pArcOuter coincide — emitting it is still
      // valid SVG and keeps the path expression uniform across cases.
      var leaderPath =
        'M ' + pRedOuter[0] + ' ' + pRedOuter[1] +
        ' L ' + pRedInner[0] + ' ' + pRedInner[1] +
        ' L ' + pArcOuter[0] + ' ' + pArcOuter[1] +
        ' A ' + arcRadius + ' ' + arcRadius + ' 0 0 ' + sweepFlag + ' ' +
                pArcInner[0] + ' ' + pArcInner[1] +
        ' L ' + pGreenIn[0] + ' ' + pGreenIn[1];
      var leaderClass = 'luna-leader' + (planet.oob ? ' luna-leader-oob' : '');

      // ---- Inner stack: degree, per-planet sign glyph, minute ----
      var degP = polar(c, L.degreeR, angle);
      var minP = polar(c, L.minuteR, angle);
      var signIdx = signIndexFor(planet.longitude);
      var signColor = ELEMENT_COLORS[SIGNS[signIdx].element];

      var pg = el('g', null);
      // Leader stroke is set inline to the planet's color so each radial
      // tick visually matches its glyph. The CSS .luna-leader rule
      // (no stroke declared) supplies width / opacity only. The OOB
      // variant overrides via class — see .luna-leader-oob in CSS.
      pg.appendChild(el('path', {
        d: leaderPath,
        fill: 'none',
        stroke: color,
        'class': leaderClass
      }));

      var glyphUse = el('use', {
        'data-glyph': 'planet',
        href: '#luna-' + glyphId,
        transform: glyphTransform
      });
      pg.appendChild(tinted(color, glyphUse));

      pg.appendChild(el('text', {
        x: degP[0], y: degP[1],
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'class': 'luna-degree luna-degree-deg'
      }, s.degree + 'º'));

      var innerSignUse = el('use', {
        'data-glyph': 'sign-inner',
        href: '#luna-' + SIGN_GLYPH_IDS[signIdx],
        transform: placeGlyph(angle, L.signGlyphInR, L.planetSignGlyphScale)
      });
      pg.appendChild(tinted(signColor, innerSignUse));

      pg.appendChild(el('text', {
        x: minP[0], y: minP[1],
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'class': 'luna-degree luna-degree-min'
      }, s.minute + "'"));

      // a11y: <title> child for hover/SR readout
      var ttl = document.createElementNS(SVG_NS, 'title');
      ttl.textContent = (planet.label || planet.key) + ' ' +
        formatDegree(planet.longitude) +
        (planet.retrograde ? ' (retrograde)' : '');
      pg.appendChild(ttl);

      planetGroup.appendChild(pg);
    });
    svgElement.appendChild(planetGroup);

    // --- Layer I: AC / DC / MC / IC markers just outside the band ---
    var markerGroup = el('g', { 'class': 'luna-angle-markers' });
    angleMarkers.forEach(function (marker) {
      var mAng = chartAngle(marker.longitude, asc);
      var mPos = polar(c, L.outer - 1, mAng);
      markerGroup.appendChild(el('text', {
        x: mPos[0], y: mPos[1],
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'class': 'luna-angle-marker ' + marker.className
      }, marker.key));
    });
    svgElement.appendChild(markerGroup);

    // --- a11y: sibling <ul class="sr-only"> with the aspect summary ---
    // Lives outside the SVG, inside .natal-wheel-wrap, so aria-describedby
    // resolves cleanly. Remove the previous run's list before re-rendering.
    var wrap = svgElement.parentNode;
    if (wrap) {
      var prev = wrap.querySelector('ul[data-natal-aspect-list="1"]');
      if (prev) wrap.removeChild(prev);
      if (aspects.length) {
        var ul = document.createElement('ul');
        ul.id = aspectListId;
        ul.className = 'sr-only';
        ul.setAttribute('data-natal-aspect-list', '1');
        aspects.forEach(function (a) {
          var li = document.createElement('li');
          var typeLabel = i18nLookup(locale, 'natal.aspects.' + a.type, a.type);
          li.textContent = (a.from.label || a.from.key) + ' ' +
            typeLabel + ' ' + (a.to.label || a.to.key);
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
    }
  }

  /* -----------------------------------------------------------------
   * Export.
   * ----------------------------------------------------------------- */

  global.NatalWheel = { render: render };

}(typeof window !== 'undefined' ? window : this));
