// Vedic nakshatras (lunar mansions). The sidereal zodiac is divided into 27
// equal segments of 360°/27 = 13°20' each, starting from 0° sidereal Aries.
// Each nakshatra is further divided into 4 padas (quarters) of 3°20'.
//
// The lord column gives the Vimshottari-dasha ruler. The lord sequence
// (Ketu, Venus, Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury) repeats
// three times across the 27 nakshatras — a structural feature of the
// Vimshottari system, not a coincidence.
//
// Table ported verbatim (names + lords) from ast/src/lib/data.js#NAKSHATRAS
// so both projects produce identical nakshatra labels for the same Moon.

export const NAK_DEG = 360 / 27;          // 13.333… ° per nakshatra
export const PADA_DEG = NAK_DEG / 4;      //  3.333… ° per pada

const TABLE = [
  ['Ashwini',          'Ketu'],
  ['Bharani',          'Venus'],
  ['Krittika',         'Sun'],
  ['Rohini',           'Moon'],
  ['Mrigashira',       'Mars'],
  ['Ardra',            'Rahu'],
  ['Punarvasu',        'Jupiter'],
  ['Pushya',           'Saturn'],
  ['Ashlesha',         'Mercury'],
  ['Magha',            'Ketu'],
  ['Purva Phalguni',   'Venus'],
  ['Uttara Phalguni',  'Sun'],
  ['Hasta',            'Moon'],
  ['Chitra',           'Mars'],
  ['Swati',            'Rahu'],
  ['Vishakha',         'Jupiter'],
  ['Anuradha',         'Saturn'],
  ['Jyeshtha',         'Mercury'],
  ['Mula',             'Ketu'],
  ['Purva Ashadha',    'Venus'],
  ['Uttara Ashadha',   'Sun'],
  ['Shravana',         'Moon'],
  ['Dhanishta',        'Mars'],
  ['Shatabhisha',      'Rahu'],
  ['Purva Bhadrapada', 'Jupiter'],
  ['Uttara Bhadrapada','Saturn'],
  ['Revati',           'Mercury'],
];

export const NAKSHATRAS = TABLE.map(([name, lord], index) => ({ index, name, lord }));

function norm360(deg) {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

// Lookup. Input is a SIDEREAL ecliptic longitude in degrees (any sign);
// the function normalizes to [0, 360). Returns { index, name, pada, lord }
// where pada ∈ {1, 2, 3, 4}. Boundary cases (longitude exactly at the end
// of a nakshatra) roll forward via the floor in degreeIn.
export function nakshatraOf(siderealLongitudeDeg) {
  const lon = norm360(siderealLongitudeDeg);
  const index = Math.floor(lon / NAK_DEG) % 27;     // 0..26
  const degreeIn = lon - index * NAK_DEG;            // 0..NAK_DEG
  const pada = Math.min(4, Math.floor(degreeIn / PADA_DEG) + 1); // 1..4
  const { name, lord } = NAKSHATRAS[index];
  return { index, name, pada, lord };
}
