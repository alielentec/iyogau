// Major aspects with default orbs.

const ASPECTS = [
  { type: 'conjunction', angle: 0,   orb: 8 },
  { type: 'sextile',     angle: 60,  orb: 4 },
  { type: 'square',      angle: 90,  orb: 6 },
  { type: 'trine',       angle: 120, orb: 6 },
  { type: 'opposition',  angle: 180, orb: 8 },
];

// Angular separation along the ecliptic, in [0, 180].
function separation(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function computeAspects(planets) {
  const out = [];
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const sep = separation(planets[i].longitude, planets[j].longitude);
      let best = null;
      for (const asp of ASPECTS) {
        const orb = Math.abs(sep - asp.angle);
        if (orb <= asp.orb && (best === null || orb < best.orb)) {
          best = { type: asp.type, exact: asp.angle, orb };
        }
      }
      if (best) {
        out.push({
          from: planets[i].name,
          to: planets[j].name,
          type: best.type,
          orb: Math.round(best.orb * 100) / 100,
          exact: best.exact,
        });
      }
    }
  }
  return out;
}
