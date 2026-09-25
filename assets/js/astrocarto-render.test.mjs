import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createStubNode(tagName, text) {
  return {
    tagName,
    textContent: text || '',
    className: '',
    attributes: {},
    childNodes: [],
    firstChild: null,
    parentNode: null,
    hidden: false,
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    appendChild(child) {
      this.childNodes.push(child);
      this.firstChild = this.childNodes[0] || null;
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      this.firstChild = this.childNodes[0] || null;
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 400 };
    },
  };
}

function loadAstrocartoDebugContext() {
  const listeners = new Map();
  const document = {
    readyState: 'loading',
    documentElement: { getAttribute: () => 'en' },
    addEventListener(name, fn) { listeners.set(name, fn); },
    createElementNS: (_ns, tag) => createStubNode(tag),
    createElement: (tag) => createStubNode(tag),
    createTextNode: (text) => createStubNode('#text', String(text)),
    querySelectorAll: () => [],
  };
  const context = {
    console,
    window: {
      location: { search: '?astrocartoDebug=1' },
      IYOGAU_I18N: {},
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    },
    document,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    URLSearchParams,
    isFinite,
    Math,
  };
  context.window.document = document;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/data/world-continents.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('assets/js/astrocarto.js', 'utf8'), context);
  return context;
}

function findNodes(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.childNodes || []) findNodes(child, predicate, found);
  return found;
}

function collectText(root) {
  let out = root.textContent || '';
  for (const child of root.childNodes || []) out += collectText(child);
  return out;
}

function pointInRing(point, ring) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pathSegments(pathD, opts = {}) {
  const tokens = pathD.match(/[MLZ]|-?\d+(?:\.\d+)?/g) || [];
  const segments = [];
  let cursor = null;
  let subpathStart = null;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i++];
    if (token === 'M' || token === 'L') {
      const point = [Number(tokens[i++]), Number(tokens[i++])];
      if (token === 'L' && cursor) segments.push([cursor, point]);
      if (token === 'M') subpathStart = point;
      cursor = point;
    } else if (token === 'Z') {
      if (opts.includeClose && cursor && subpathStart) segments.push([cursor, subpathStart, 'Z']);
      cursor = null;
      subpathStart = null;
    }
  }
  return segments;
}

test('continent outline path splits antimeridian rings without cross-map chords', () => {
  const context = loadAstrocartoDebugContext();
  const helpers = context.window.__debug_astrocarto_pathing;
  assert.ok(helpers);

  const outline = helpers.continentsPathD(context.window.IYOGAU_WORLD_CONTINENTS, { closeSubpaths: false });
  assert.ok(outline.length > 1000);
  assert.equal(outline.includes(' Z'), false, 'visible outline must not close seam-split rings with SVG Z chords');

  const widest = pathSegments(outline).reduce((max, [a, b]) => Math.max(max, Math.abs(b[0] - a[0])), 0);
  assert.ok(widest <= 400, `outline contains a projected segment wider than half the map: ${widest}px`);
});

test('world land data preserves the Caspian Sea as an interior water hole', () => {
  const context = loadAstrocartoDebugContext();
  const caspianPoint = [50, 42];
  const continents = context.window.IYOGAU_WORLD_CONTINENTS;
  const containingLand = continents.find((item) => pointInRing(caspianPoint, item.poly));
  const containingHole = continents
    .flatMap((item) => item.holes || [])
    .find((ring) => pointInRing(caspianPoint, ring));

  assert.ok(containingLand, 'Caspian test point should fall inside the Eurasian outer land ring');
  assert.ok(containingHole, 'Caspian test point must also fall inside a preserved water hole');
});

test('planet polyline path inserts edge points at the antimeridian', () => {
  const context = loadAstrocartoDebugContext();
  const helpers = context.window.__debug_astrocarto_pathing;

  const path = helpers.polylineToPathD([[179, 10], [-179, 12], [-170, 14]]);
  assert.match(path, /L800(?:\.0+)?\s+/);
  assert.match(path, /M0(?:\.0+)?\s+/);

  const widest = pathSegments(path).reduce((max, [a, b]) => Math.max(max, Math.abs(b[0] - a[0])), 0);
  assert.ok(widest < 30, `polyline contains a false antimeridian chord: ${widest}px`);
});

test('land clip path has no hidden seam-fill chord away from the polar map edge', () => {
  const context = loadAstrocartoDebugContext();
  const helpers = context.window.__debug_astrocarto_pathing;

  const clip = helpers.continentsPathD(context.window.IYOGAU_WORLD_CONTINENTS, { closeSubpaths: true });
  const wideSegments = pathSegments(clip, { includeClose: true })
    .filter(([a, b]) => Math.abs(b[0] - a[0]) > 400);

  assert.equal(wideSegments.length, 1, 'only Antarctica should need a full-width polar clip edge');
  const [[a, b, kind]] = wideSegments;
  assert.equal(kind, undefined, 'polar clip edge should be an explicit SVG line, not a hidden Z chord');
  assert.equal(Math.min(a[0], b[0]), 0);
  assert.equal(Math.max(a[0], b[0]), 800);
  assert.ok(a[1] >= 399.999 && b[1] >= 399.999, `wide clip edge must stay on the map bottom, got y=${a[1]}→${b[1]}`);
});

test('rendered heat cells use exact raw grid geometry without browser smoothing', () => {
  const context = loadAstrocartoDebugContext();
  const container = createStubNode('div');
  const response = {
    modeWeights: { Sun: 1 },
    lines: [],
    heatMatrix: {
      latitudes: [-88],
      longitudes: [-178],
      xCoordinates: [4.444444],
      yCoordinates: [395.555556],
      values: [[42]],
      cellMeta: [[[]]],
      latStep: 4,
      lonStep: 4,
      coordinateRole: 'cell-center',
    },
  };

  context.window.__debug_astrocarto_renderMap(container, response, 'relocation');
  const cells = findNodes(container, (node) => node.attributes.class === 'astrocarto-cell');
  assert.equal(cells.length, 1);
  assert.equal(cells[0].attributes.x, '0.000000');
  assert.equal(cells[0].attributes.y, '391.111112');
  assert.equal(cells[0].attributes.width, '8.888889');
  assert.equal(cells[0].attributes.height, '8.888889');
  assert.equal(container.attributes['data-astrocarto-sigma-cells'], '0.00');
  assert.equal(context.window.__debug_astrocarto_smoothing.sigmaCells, 0);
  const clipPath = findNodes(container, (node) => node.tagName === 'path' && node.attributes['fill-rule'])[0];
  assert.equal(clipPath.attributes['fill-rule'], 'evenodd');
});

test('renderer shows every nonzero heat-contributing astrocartography line', () => {
  const context = loadAstrocartoDebugContext();
  const container = createStubNode('div');
  const response = {
    modeWeights: { Sun: 1, Mars: 0.2 },
    lines: [
      { planet: 'Sun', type: 'MC', points: [[0, -80], [0, 80]] },
      { planet: 'Mars', type: 'DC', points: [[-20, -60], [20, 60]] },
    ],
    heatMatrix: {
      latitudes: [0],
      longitudes: [0],
      xCoordinates: [400],
      yCoordinates: [200],
      values: [[10]],
      cellMeta: [[[]]],
      latStep: 4,
      lonStep: 4,
      coordinateRole: 'cell-center',
    },
  };

  context.window.__debug_astrocarto_renderMap(container, response, 'relocation');
  const renderedLines = findNodes(container, (node) => (
    node.tagName === 'path' &&
    typeof node.attributes.class === 'string' &&
    node.attributes.class.indexOf('astrocarto-line') >= 0
  ));
  const renderedPlanets = renderedLines.map((node) => node.attributes['data-planet']).sort();

  assert.deepEqual(renderedPlanets, ['Mars', 'Sun']);

  const legend = createStubNode('div');
  context.window.__debug_astrocarto_renderLegend(legend, 'relocation', response);
  assert.match(collectText(legend), /Mars/);
});

test('soulmate timing renderer exposes transit lines and timing legend date', () => {
  const context = loadAstrocartoDebugContext();
  const container = createStubNode('div');
  const response = {
    modeWeights: { Venus: 1 },
    lines: [
      { planet: 'Venus', type: 'DC', points: [[0, -70], [0, 70]] },
    ],
    timing: {
      targetDate: '2026-06-09',
      transitWeights: { Jupiter: 1 },
      lines: [
        { planet: 'Jupiter', type: 'AC', points: [[-30, -60], [30, 60]] },
      ],
    },
    heatMatrix: {
      latitudes: [0],
      longitudes: [0],
      xCoordinates: [400],
      yCoordinates: [200],
      values: [[10]],
      cellMeta: [[[{
        planet: 'Jupiter',
        type: 'AC',
        source: 'transit',
        distance: 80,
      }]]],
      latStep: 4,
      lonStep: 4,
      coordinateRole: 'cell-center',
    },
  };

  context.window.__debug_astrocarto_renderMap(container, response, 'soulmate_timing');
  const transitLines = findNodes(container, (node) => (
    node.tagName === 'path' &&
    node.attributes['data-source'] === 'transit'
  ));
  assert.equal(transitLines.length, 1);
  assert.equal(transitLines[0].attributes['data-planet'], 'Jupiter');

  const legend = createStubNode('div');
  context.window.__debug_astrocarto_renderLegend(legend, 'soulmate_timing', response);
  assert.match(collectText(legend), /2026-06-09/);
});

test('client resolution policy uses the high-accuracy grid on every viewport', () => {
  const context = loadAstrocartoDebugContext();
  assert.equal(context.window.__debug_astrocarto_pickResolution(), 'high');
});

test('legend discloses raw equation scores instead of smoothing', () => {
  const context = loadAstrocartoDebugContext();
  const legend = createStubNode('div');
  context.window.__debug_astrocarto_renderLegend(legend, 'relocation', {
    modeWeights: { Sun: 1 },
    heatMatrix: { latStep: 4, latitudes: [-88, -84] },
  });
  const text = collectText(legend);
  assert.match(text, /raw equation scores/i);
  assert.doesNotMatch(text, /Gaussian|smoothed|σ/i);
});

test('immigration legend discloses omitted current-residence distance adjustment', () => {
  const context = loadAstrocartoDebugContext();
  const legend = createStubNode('div');
  context.window.__debug_astrocarto_renderLegend(legend, 'immigration', {
    modeWeights: { Rahu: 1 },
    heatMatrix: { latStep: 4, latitudes: [-88, -84] },
    provenance: { immigrationDistanceBasis: 'omitted' },
  });
  const text = collectText(legend);
  assert.match(text, /current residence/i);
  assert.match(text, /omitted/i);
});
