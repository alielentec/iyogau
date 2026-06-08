// Whole-Sign house system. The rising sign is house 1 in its entirety
// (0°–30°); houses 2..12 are the next 11 signs in order. Each cusp is the
// 0° point of its sign.

export const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

export function signIndexOf(longitudeDeg) {
  let lon = longitudeDeg % 360;
  if (lon < 0) lon += 360;
  return Math.floor(lon / 30);
}

// Returns the position decomposed into sign + DMS within the sign.
export function decomposeLongitude(longitudeDeg) {
  let lon = longitudeDeg % 360;
  if (lon < 0) lon += 360;
  const signIdx = Math.floor(lon / 30);
  const within = lon - signIdx * 30;
  const degree = Math.floor(within);
  const minFloat = (within - degree) * 60;
  const minute = Math.floor(minFloat);
  const second = Math.round((minFloat - minute) * 60);
  // Handle 60-second carry from rounding.
  if (second === 60) {
    return normalizeDMS(signIdx, degree, minute + 1, 0);
  }
  return {
    longitude: lon,
    sign: SIGNS[signIdx],
    signIndex: signIdx,
    degree,
    minute,
    second,
  };
}

function normalizeDMS(signIdx, degree, minute, second) {
  if (minute === 60) { degree += 1; minute = 0; }
  if (degree === 30) { degree = 0; signIdx = (signIdx + 1) % 12; }
  const lon = signIdx * 30 + degree + minute / 60 + second / 3600;
  return {
    longitude: lon,
    sign: SIGNS[signIdx],
    signIndex: signIdx,
    degree,
    minute,
    second,
  };
}

export function buildWholeSignHouses(ascendantLongitude) {
  const ascSignIdx = signIndexOf(ascendantLongitude);
  const houses = [];
  for (let i = 0; i < 12; i++) {
    const signIdx = (ascSignIdx + i) % 12;
    const cusp = signIdx * 30;
    const within = 0; // whole-sign cusps are always 0° of the sign
    houses.push({
      number: i + 1,
      cusp,
      sign: SIGNS[signIdx],
      signIndex: signIdx,
      degree: within,
      minute: 0,
    });
  }
  return houses;
}

// House number 1..12 for a planet, given the ascendant.
export function houseOf(planetLongitude, ascendantLongitude) {
  const ascSignIdx = signIndexOf(ascendantLongitude);
  const planetSignIdx = signIndexOf(planetLongitude);
  // Houses run forward from the asc sign.
  const diff = (planetSignIdx - ascSignIdx + 12) % 12;
  return diff + 1;
}
