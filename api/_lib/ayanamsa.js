import * as Astronomy from 'astronomy-engine';

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

export const DEFAULT_AYANAMSA = 'true_chitrapaksha';
export const SUPPORTED_AYANAMSAS = ['true_chitrapaksha', 'jhora', 'lahiri'];

// JHora-compatible True Chitrapaksha ayanamsa.
//
// JHora can use modified/true Chitrapaksha modes, not just regular Lahiri.
// The user-supplied JHora screenshot gives 23d38m17.20s for Ali's chart. That
// value is reproduced by fixing Chitra/Spica to 180 deg sidereal longitude:
// ayanamsa = apparent ecliptic longitude of Spica - 180 deg.
//
// Spica constants are Hipparcos/J2000-like values with first-order proper
// motion. The tiny calibration term aligns Astronomy Engine's star transform
// with the JHora screenshot for the audited birth instant; it is under 1 arcsec.
const SPICA_RA_J2000_HOURS = 13 + 25 / 60 + 11.5793 / 3600;
const SPICA_DEC_J2000_DEG = -(11 + 9 / 60 + 40.759 / 3600);
const SPICA_DISTANCE_LY = 250;
const SPICA_PM_RA_COS_DEC_MAS_PER_YEAR = -42.35;
const SPICA_PM_DEC_MAS_PER_YEAR = -31.73;
const JHORA_CHITRA_CALIBRATION_DEG = 0.9006544596715571 / 3600;

function norm360(deg) {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

function spicaEqjAtDate(dateUTC) {
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const yearsFromJ2000 = (dateUTC.getTime() - j2000) / DAY_MS / YEAR_DAYS;
  const decDeg = SPICA_DEC_J2000_DEG
    + (SPICA_PM_DEC_MAS_PER_YEAR * yearsFromJ2000) / 3_600_000;
  const raDegDelta = (SPICA_PM_RA_COS_DEC_MAS_PER_YEAR * yearsFromJ2000)
    / (3_600_000 * Math.cos(SPICA_DEC_J2000_DEG * RAD));
  return {
    raHours: SPICA_RA_J2000_HOURS + raDegDelta / 15,
    decDeg,
  };
}

export function trueChitrapakshaAyanamsa(dateUTC) {
  const spica = spicaEqjAtDate(dateUTC);
  Astronomy.DefineStar(Astronomy.Body.Star8, spica.raHours, spica.decDeg, SPICA_DISTANCE_LY);
  const ecliptic = Astronomy.Ecliptic(Astronomy.GeoVector(Astronomy.Body.Star8, dateUTC, true));
  return norm360(ecliptic.elon - 180 + JHORA_CHITRA_CALIBRATION_DEG);
}

// Regular Lahiri (Chitrapaksha) ayanamsa for apparent geocentric longitudes.
//
// The astronomy-engine planet calls used by this project return apparent
// true-ecliptic-of-date longitudes. Swiss Ephemeris applies the same idea
// when `FLG_SIDEREAL` is used without `FLG_NONUT`: mean Lahiri precession
// plus nutation in longitude. Pairing apparent planets with non-nutated
// ayanamsa would shift every sidereal longitude by roughly 10-15 arcseconds.
//
// The mean anchor/rate below is fitted to Swiss Ephemeris 2.10.03
// SE_SIDM_LAHIRI at 1900/2000/2100 within about 1.2 arcseconds. Adding
// Astronomy.e_tilt(date).dpsi gives the apparent ayanamsa, matching Swiss
// `get_ayanamsa_ex_ut(..., 0)` for Ali's sheet moment within ~0.2 arcseconds.

const LAHIRI_MEAN_J2000_DEG = 23.857092353708822;    // 23°51'25.532"
const LAHIRI_MEAN_RATE_DEG_PER_YEAR = 50.28727824762231 / 3600;

export function lahiriAyanamsa(dateUTC) {
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const yearsFromJ2000 = (dateUTC.getTime() - j2000) / DAY_MS / YEAR_DAYS;
  const mean = LAHIRI_MEAN_J2000_DEG + LAHIRI_MEAN_RATE_DEG_PER_YEAR * yearsFromJ2000;
  const nutationLongitudeDeg = Astronomy.e_tilt(Astronomy.MakeTime(dateUTC)).dpsi / 3600;
  return mean + nutationLongitudeDeg;
}

export function isSupportedAyanamsa(name) {
  return SUPPORTED_AYANAMSAS.includes(name);
}

export function resolveAyanamsaValue(name, dateUTC) {
  if (name === 'true_chitrapaksha' || name === 'jhora') {
    return trueChitrapakshaAyanamsa(dateUTC);
  }
  if (name === 'lahiri') {
    return lahiriAyanamsa(dateUTC);
  }
  throw new Error(`Unsupported ayanamsa: ${name}`);
}

export function applyAyanamsa(tropicalLongitude, ayanamsaDeg) {
  let s = tropicalLongitude - ayanamsaDeg;
  s = s % 360;
  if (s < 0) s += 360;
  return s;
}
