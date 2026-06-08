// Navamsha (D9) — the ninth-harmonic divisional chart, the most important
// divisional in Parashari Vedic astrology (used for marriage, spouse, and
// underlying-strength readings).
//
// Each 30° sign is divided into 9 navamshas of 3°20' each. The 9 navamshas
// map to 12 sidereal signs by the Parashari rule, which depends on the
// modality of the source sign:
//
//   - Movable (Aries, Cancer, Libra, Capricorn — indices 0,3,6,9):
//       start from the sign itself.
//   - Fixed (Taurus, Leo, Scorpio, Aquarius — indices 1,4,7,10):
//       start from the 9th sign from it, i.e. (sign + 8) % 12.
//   - Dual / mutable (Gemini, Virgo, Sagittarius, Pisces — indices 2,5,8,11):
//       start from the 5th sign from it, i.e. (sign + 4) % 12.
//
// The navamsha index within the source sign (0..8) is then added to the
// start sign (mod 12) to get the navamsha sign.
//
// This is the standard rule given in Brihat Parashara Hora Shastra and
// implemented identically in ast/src/lib/astrology.js#navamshaFor.

import { SIGNS } from './houses.js';

export const DIVISION_DEG = 30 / 9; // 3.333… ° per navamsha

function norm360(deg) {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

// Input: sidereal ecliptic longitude in degrees. Returns the D9 sign and
// position. The returned `longitude` is the D9-chart longitude (0..360),
// laid out by treating the D9 sign as a full 30° span and the fractional
// position within the source navamsha as the fractional position within
// the D9 sign — which is how a divisional-chart longitude is conventionally
// reported, and how ast/src/lib/astrology.js#navamshaFor reports it.
export function navamshaOf(siderealLongitudeDeg) {
  const lon = norm360(siderealLongitudeDeg);
  const sign = Math.floor(lon / 30);                    // 0..11
  const degreeInSign = lon - sign * 30;                  // 0..30
  const padaIdx = Math.floor(degreeInSign / DIVISION_DEG); // 0..8

  let startSign;
  // Movable signs: start at self.
  if (sign === 0 || sign === 3 || sign === 6 || sign === 9) {
    startSign = sign;
  // Fixed signs: start at the 9th sign from self.
  } else if (sign === 1 || sign === 4 || sign === 7 || sign === 10) {
    startSign = (sign + 8) % 12;
  // Dual signs: start at the 5th sign from self.
  } else {
    startSign = (sign + 4) % 12;
  }

  const navSign = (startSign + padaIdx) % 12;
  const fraction = (degreeInSign - padaIdx * DIVISION_DEG) / DIVISION_DEG; // 0..1
  const longitudeWithinNavamshaSign = fraction * 30;     // 0..30 (D9 sign-local)

  return {
    sign: navSign,
    signName: SIGNS[navSign],
    pada: padaIdx + 1,        // 1..9 — the navamsha number within the source sign
    longitude: navSign * 30 + longitudeWithinNavamshaSign, // D9-chart longitude
    longitudeWithinNavamshaSign,
  };
}
