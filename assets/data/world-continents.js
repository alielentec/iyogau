/* =====================================================================
 *  world-continents.js
 *  ---------------------------------------------------------------------
 *  Simplified land-mass outlines for the astrocartography world map.
 *
 *  Each polygon is an array of [longitude, latitude] vertices. Polygons
 *  are closed implicitly (renderer adds a final 'Z' to each <path>).
 *  Coordinates are in degrees in the standard convention:
 *    longitude ∈ [-180, +180]   (east-positive)
 *    latitude  ∈ [-90,  +90]   (north-positive)
 *
 *  Source: Hand-simplified from Natural Earth 1:110m land polygons
 *  (public domain). Aggressive Douglas-Peucker simplification — ~12-25
 *  vertices per continent. Enough to read at-a-glance; not survey-grade.
 *  The heat-matrix overlay carries the actual data, the outline is only
 *  for visual orientation.
 *
 *  Why not TopoJSON?
 *    A full TopoJSON of world-110m is ~100KB and would need a runtime
 *    decoder. The astrocartography map is purely decorative — the user
 *    cares about the heat colors and lines, not millimeter-accurate
 *    coastlines. ~3KB of hand-drawn paths gives a recognizable globe
 *    silhouette without the dep.
 *
 *  Attached as a global so the inline astrocartography renderer can read
 *  it without an extra fetch round-trip.
 * ===================================================================== */

(function () {
  'use strict';

  // Each entry: name (for tooltips/a11y) + outline polygon(s).
  // Multi-polygon continents are split into separate entries (e.g.
  // Eurasia → "eurasia-main" + "indonesia-archipelago").
  window.IYOGAU_WORLD_CONTINENTS = [
    // --- North America (main landmass: Alaska → Florida → Greenland) ---
    {
      name: 'north-america',
      poly: [
        [-168, 65], [-156, 71], [-140, 70], [-128, 70], [-115, 73],
        [-100, 75], [-80, 78], [-65, 76], [-55, 72],
        [-60, 60], [-65, 50], [-58, 47], [-65, 45], [-72, 40],
        [-76, 38], [-80, 32], [-82, 27], [-80, 25], [-83, 25],
        [-89, 30], [-94, 29], [-97, 26], [-100, 22], [-105, 20],
        [-105, 25], [-110, 28], [-117, 32], [-122, 37], [-125, 48],
        [-130, 55], [-135, 58], [-145, 60], [-155, 58], [-162, 60],
        [-168, 65]
      ]
    },
    // --- Greenland ---
    {
      name: 'greenland',
      poly: [
        [-45, 60], [-50, 65], [-52, 70], [-50, 75], [-42, 82],
        [-30, 82], [-20, 78], [-22, 72], [-30, 66], [-42, 60], [-45, 60]
      ]
    },
    // --- South America (Caribbean → Tierra del Fuego) ---
    {
      name: 'south-america',
      poly: [
        [-78, 11], [-72, 12], [-65, 11], [-58, 7], [-51, 5],
        [-48, 0], [-44, -4], [-38, -8], [-35, -10], [-37, -15],
        [-39, -20], [-44, -22], [-48, -28], [-58, -34], [-62, -38],
        [-65, -45], [-68, -50], [-71, -55], [-67, -55], [-70, -45],
        [-74, -40], [-72, -35], [-71, -30], [-71, -25], [-72, -18],
        [-77, -12], [-79, -6], [-80, 0], [-78, 5], [-78, 11]
      ]
    },
    // --- Eurasia main (Europe + Asia, very simplified) ---
    {
      name: 'eurasia',
      poly: [
        [-10, 36], [-9, 43], [-2, 43], [0, 49], [-5, 56], [-3, 58],
        [5, 58], [5, 62], [11, 64], [13, 68], [22, 70], [30, 70],
        [40, 68], [55, 70], [70, 73], [85, 73], [105, 75], [125, 73],
        [145, 70], [160, 68], [175, 65], [180, 65], [180, 60],
        [165, 60], [155, 58], [145, 55], [140, 50], [137, 45],
        [142, 43], [145, 38], [140, 36], [135, 33], [129, 35],
        [125, 38], [122, 39], [121, 30], [115, 22], [108, 18],
        [105, 11], [103, 1], [110, 2], [115, 8], [123, 10],
        [125, 5], [120, -8], [110, -8], [100, 5], [96, 16],
        [88, 21], [85, 22], [78, 23], [72, 20], [73, 15], [74, 10],
        [78, 8], [80, 5], [78, 0], [75, 5], [70, 10], [63, 25],
        [55, 26], [50, 30], [44, 36], [38, 38], [35, 32], [32, 30],
        [34, 36], [28, 36], [25, 40], [20, 42], [15, 38], [9, 40],
        [3, 43], [-3, 36], [-10, 36]
      ]
    },
    // --- British Isles + Iceland (small but iconic) ---
    {
      name: 'british-isles',
      poly: [
        [-10, 51], [-8, 55], [-6, 58], [-2, 59], [1, 58],
        [2, 53], [-3, 51], [-6, 50], [-10, 51]
      ]
    },
    {
      name: 'iceland',
      poly: [
        [-24, 64], [-22, 66], [-15, 66], [-14, 64], [-19, 63], [-24, 64]
      ]
    },
    // --- Africa (Mediterranean → Cape of Good Hope) ---
    {
      name: 'africa',
      poly: [
        [-15, 28], [-12, 21], [-17, 15], [-15, 12], [-12, 7],
        [-8, 4], [-3, 5], [6, 4], [8, 4], [10, 2], [10, -3],
        [12, -6], [13, -12], [14, -17], [18, -23], [20, -32],
        [25, -34], [29, -34], [32, -29], [33, -25], [36, -20],
        [40, -15], [41, -10], [42, -4], [42, 5], [45, 11],
        [51, 12], [50, 8], [45, 5], [42, 8], [40, 10], [38, 15],
        [35, 23], [34, 30], [32, 31], [28, 31], [24, 32],
        [16, 32], [10, 33], [3, 35], [-3, 35], [-9, 31], [-10, 28],
        [-15, 28]
      ]
    },
    // --- Madagascar ---
    {
      name: 'madagascar',
      poly: [
        [43, -25], [45, -22], [49, -16], [50, -13], [48, -13],
        [46, -16], [44, -20], [43, -25]
      ]
    },
    // --- Australia ---
    {
      name: 'australia',
      poly: [
        [114, -22], [114, -32], [116, -35], [123, -34], [129, -32],
        [136, -35], [140, -38], [147, -39], [150, -37], [153, -29],
        [153, -25], [146, -19], [142, -11], [135, -12], [131, -12],
        [126, -14], [122, -17], [114, -22]
      ]
    },
    // --- New Zealand (two islands, drawn as one stylized blob) ---
    {
      name: 'new-zealand-north',
      poly: [
        [172, -34], [174, -36], [177, -37], [178, -39], [175, -42],
        [173, -41], [172, -34]
      ]
    },
    {
      name: 'new-zealand-south',
      poly: [
        [167, -47], [170, -46], [174, -42], [173, -45], [170, -47],
        [167, -47]
      ]
    },
    // --- Japan main island ---
    {
      name: 'japan',
      poly: [
        [130, 31], [131, 34], [136, 35], [140, 36], [142, 39],
        [141, 41], [144, 43], [145, 44], [141, 45], [139, 43],
        [135, 35], [131, 33], [130, 31]
      ]
    },
    // --- Indonesia / Philippines stylized blocks (very rough) ---
    {
      name: 'borneo',
      poly: [
        [109, 1], [113, 4], [118, 5], [119, 1], [117, -4], [114, -3], [110, -2], [109, 1]
      ]
    },
    {
      name: 'new-guinea',
      poly: [
        [131, -2], [136, 0], [141, -2], [145, -5], [150, -8],
        [148, -10], [142, -10], [135, -8], [131, -5], [131, -2]
      ]
    },
    {
      name: 'sumatra',
      poly: [
        [95, 5], [98, 4], [101, 2], [104, 0], [106, -3], [104, -5],
        [101, -3], [98, 0], [95, 3], [95, 5]
      ]
    },
    // --- Antarctica (visible strip on the map; full coverage clipped) ---
    {
      name: 'antarctica',
      poly: [
        [-180, -72], [-180, -78], [180, -78], [180, -72],
        [150, -70], [110, -68], [60, -68], [10, -70], [-30, -72],
        [-60, -75], [-100, -73], [-140, -75], [-180, -72]
      ]
    }
  ];
}());
