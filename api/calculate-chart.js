// POST /api/calculate-chart
//
// Computes a Vedic (Lahiri sidereal, Whole-Sign) or tropical natal chart
// using astronomy-engine. Stateless, in-memory rate-limited, no persistence.
//
// SECURITY: birth data (date/time/lat/lon/tz) is NEVER logged. Logs carry
// only timestamp, anonymized IP (/24 for IPv4, /48 for IPv6), status code,
// and duration. See ./_lib/ratelimit.js#anonymizeIp.

import { computePlanetTropical, computeAscMC, PLANETS, norm360 } from './_lib/astronomy.js';
import { lahiriAyanamsa, applyAyanamsa } from './_lib/ayanamsa.js';
import { buildWholeSignHouses, decomposeLongitude, houseOf } from './_lib/houses.js';
import { computeAspects } from './_lib/aspects.js';
import { checkRateLimit, anonymizeIp } from './_lib/ratelimit.js';
import { validateInput, localToUTC, ValidationError } from './_lib/validate.js';

const ENGINE_VERSION = '2.1.19';
const ALLOWED_ORIGIN = 'https://iyogau.com';
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;
const MAX_BODY_BYTES = 2 * 1024;

function pickCorsOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (reqOrigin === ALLOWED_ORIGIN) return reqOrigin;
  if (VERCEL_PREVIEW_RE.test(reqOrigin)) return reqOrigin;
  return null;
}

function setCors(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function logLine(fields) {
  // Single-line JSON for log aggregators. NO birth data, NO request body.
  try { console.log(JSON.stringify(fields)); } catch { /* swallow */ }
}

// Read the request body as a string, with a hard byte cap.
async function readBody(req) {
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('payload too large'); err.code = 'TOO_LARGE'; throw err;
    }
    return req.body;
  }
  if (req.body && typeof req.body === 'object') {
    // Vercel may pre-parse JSON. Re-serialize so the size check is consistent.
    const s = JSON.stringify(req.body);
    if (Buffer.byteLength(s, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('payload too large'); err.code = 'TOO_LARGE'; throw err;
    }
    return s;
  }
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error('payload too large'); err.code = 'TOO_LARGE';
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const ip = clientIp(req);
  const anonIp = anonymizeIp(ip);
  const reqOrigin = req.headers.origin;
  const corsOrigin = pickCorsOrigin(reqOrigin);

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    setCors(res, corsOrigin);
    res.status(corsOrigin ? 204 : 403).end();
    logLine({ t: new Date().toISOString(), ip: anonIp, status: corsOrigin ? 204 : 403, ms: Date.now() - startedAt, method: 'OPTIONS' });
    return;
  }

  setCors(res, corsOrigin);

  // Reject cross-origin from disallowed origins. Same-origin (no Origin
  // header, e.g. server-to-server smoke tests) is allowed.
  if (reqOrigin && !corsOrigin) {
    res.status(403).json({ error: 'Origin not allowed.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 403, ms: Date.now() - startedAt, reason: 'origin' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 405, ms: Date.now() - startedAt, method: req.method });
    return;
  }

  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 415, ms: Date.now() - startedAt });
    return;
  }

  // Rate limit (after method/CT checks so we don't burn a token on a misroute).
  const rl = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Limit-Minute', String(rl.minuteLimit));
  res.setHeader('X-RateLimit-Remaining-Minute', String(rl.minuteRemaining));
  res.setHeader('X-RateLimit-Limit-Day', String(rl.dayLimit));
  res.setHeader('X-RateLimit-Remaining-Day', String(rl.dayRemaining));
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: `Rate limit exceeded (${rl.reason}). Retry after ${rl.retryAfter}s.` });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 429, ms: Date.now() - startedAt, rl: rl.reason });
    return;
  }

  // Read + parse body.
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') {
      res.status(413).json({ error: 'Request body exceeds 2 KB limit.' });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 413, ms: Date.now() - startedAt });
      return;
    }
    res.status(400).json({ error: 'Failed to read request body.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'read' });
    return;
  }

  let parsed;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'json' });
    return;
  }

  let input;
  try {
    input = validateInput(parsed);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'validate' });
      return;
    }
    throw e;
  }

  // Convert birth local civil time → UTC instant.
  let dateUTC;
  try {
    dateUTC = localToUTC(input.date, input.time, input.tz);
    if (Number.isNaN(dateUTC.getTime())) throw new Error('invalid date');
  } catch {
    res.status(400).json({ error: 'Could not resolve birth date/time in the given timezone.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'tz' });
    return;
  }

  // Compute.
  let payload;
  try {
    payload = buildChart(input, dateUTC);
  } catch (e) {
    // Astronomy compute failure — log the error class but not the inputs.
    res.status(500).json({ error: 'Failed to compute chart.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 500, ms: Date.now() - startedAt, err: e && e.name });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(payload);
  logLine({ t: new Date().toISOString(), ip: anonIp, status: 200, ms: Date.now() - startedAt });
}

function buildChart(input, dateUTC) {
  const warnings = [];
  if (input.unknownTime) warnings.push('approximate ascendant due to unknown birth time');

  const ayanamsaValue = input.tradition === 'sidereal' ? lahiriAyanamsa(dateUTC) : 0;
  const adjust = (lonDeg) => input.tradition === 'sidereal'
    ? applyAyanamsa(lonDeg, ayanamsaValue)
    : norm360(lonDeg);

  // Planets (tropical from engine → adjusted to sidereal if requested).
  const planetsRaw = PLANETS.map((name) => {
    const p = computePlanetTropical(name, dateUTC);
    return { name, ...p, longitude: adjust(p.longitude) };
  });

  // Asc / MC.
  const { ascendant: ascTrop, midheaven: mcTrop } = computeAscMC(dateUTC, input.lat, input.lon);
  const ascLon = adjust(ascTrop);
  const mcLon = adjust(mcTrop);

  // Houses + per-planet house assignment.
  const houses = buildWholeSignHouses(ascLon).map((h) => {
    const d = decomposeLongitude(h.cusp);
    return { number: h.number, cusp: h.cusp, sign: d.sign, signIndex: d.signIndex, degree: d.degree, minute: d.minute };
  });

  const planets = planetsRaw.map((p) => {
    const d = decomposeLongitude(p.longitude);
    return {
      name: p.name,
      longitude: p.longitude,
      latitude: p.latitude,
      sign: d.sign,
      signIndex: d.signIndex,
      degree: d.degree,
      minute: d.minute,
      second: d.second,
      speed: Math.round(p.speed * 10000) / 10000,
      retrograde: p.retrograde,
      house: houseOf(p.longitude, ascLon),
    };
  });

  const ascD = decomposeLongitude(ascLon);
  const mcD = decomposeLongitude(mcLon);

  return {
    ascendant: { longitude: ascLon, sign: ascD.sign, signIndex: ascD.signIndex, degree: ascD.degree, minute: ascD.minute, second: ascD.second },
    midheaven: { longitude: mcLon, sign: mcD.sign, signIndex: mcD.signIndex, degree: mcD.degree, minute: mcD.minute, second: mcD.second },
    planets,
    houses,
    aspects: computeAspects(planets),
    tradition: input.tradition,
    ayanamsa: input.ayanamsa,
    ayanamsaValue: input.tradition === 'sidereal' ? Math.round(ayanamsaValue * 1000000) / 1000000 : null,
    houseSystem: 'whole-sign',
    input: {
      date: input.date,
      time: input.time,
      tz: input.tz,
      lat: input.lat,
      lon: input.lon,
      tradition: input.tradition,
      ayanamsa: input.ayanamsa,
      unknownTime: input.unknownTime,
    },
    provenance: {
      engine: 'astronomy-engine',
      engineVersion: ENGINE_VERSION,
      warnings,
    },
    computedAt: new Date().toISOString(),
  };
}
