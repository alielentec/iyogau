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
import { nakshatraOf } from './_lib/nakshatra.js';
import { navamshaOf } from './_lib/navamsha.js';
import { checkRateLimit, anonymizeIp } from './_lib/ratelimit.js';
import { validateInput, localToUTC, ValidationError } from './_lib/validate.js';

const ENGINE_VERSION = '2.1.19';
const ALLOWED_ORIGIN = 'https://iyogau.com';
// Restrict Vercel preview-URL acceptance to iyogau's own project. The previous
// catch-all `*.vercel.app` regex meant any third-party Vercel app could call
// the API and piggyback on our free-chart compute. We now match only the
// project prefix iyogau- followed by the standard Vercel preview suffix.
const VERCEL_PREVIEW_RE = /^https:\/\/iyogau-[a-z0-9-]+\.vercel\.app$/i;
// Localhost origins are accepted ONLY when VERCEL_ENV is 'development' (the
// value Vercel sets locally when you run `vercel dev`) or when neither
// VERCEL_ENV nor NODE_ENV mark a production-like environment. This is
// stricter than the previous NODE_ENV-only check, which could be flipped
// by a typoed env var.
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const MAX_BODY_BYTES = 2 * 1024;

function isProdLikeEnv() {
  const v = process.env.VERCEL_ENV;
  if (v) return v === 'production' || v === 'preview';
  return process.env.NODE_ENV === 'production';
}

function pickCorsOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (reqOrigin === ALLOWED_ORIGIN) return reqOrigin;
  if (VERCEL_PREVIEW_RE.test(reqOrigin)) return reqOrigin;
  if (!isProdLikeEnv() && LOCALHOST_RE.test(reqOrigin)) {
    return reqOrigin;
  }
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

// Resolve the client IP for rate-limit keying. On Vercel only
// `x-vercel-forwarded-for` is unspoofable — the edge sets it AFTER stripping
// any inbound value. `x-real-ip` and `x-forwarded-for` are pass-through
// attacker-controlled headers in Vercel's serverless runtime (the edge
// appends the real IP but does NOT remove caller-supplied entries), so
// trusting them lets an attacker rotate the value per request and bypass
// rate-limit buckets entirely.
//
// Order of preference:
//   1. `x-vercel-forwarded-for` — the only unspoofable header on Vercel,
//      always the real client IP. Take the LEFTMOST entry (Vercel sets it
//      as a single-value header in practice, but split-and-take-first is
//      defensive against future format changes).
//   2. `x-forwarded-for` — fallback for non-Vercel runtimes (local dev,
//      generic Node hosts behind a reverse proxy). Take the RIGHTMOST
//      entry — that is the IP added by the most-recent trusted proxy.
//      Never the leftmost (caller-controlled).
//   3. `x-real-ip` — gated to non-production environments only. This
//      header is set by nginx and friends but is fully spoofable on
//      Vercel; we only trust it in local dev (where VERCEL_ENV is unset).
//   4. socket remoteAddress — direct-connection fallback.
function clientIp(req) {
  const vercelXff = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelXff === 'string' && vercelXff.length > 0 && vercelXff.length < 256) {
    const parts = vercelXff.split(',');
    // Vercel sets this to the immediate client IP, no chain. Leftmost.
    return parts[0].trim();
  }
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0 && xff.length < 256) {
    // Rightmost = most-recent trusted hop. Never the leftmost (caller-controlled).
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  // x-real-ip is spoofable on Vercel — only trust it outside production-
  // like environments. (VERCEL_ENV is unset locally; set to 'production'
  // or 'preview' on deployed builds.)
  if (!process.env.VERCEL_ENV) {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.length > 0 && realIp.length < 64) {
      return realIp.trim();
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function logLine(fields) {
  // Single-line JSON for log aggregators. NO birth data, NO request body.
  try { console.log(JSON.stringify(fields)); } catch { /* swallow */ }
}

// Read the request body. Returns either:
//   - a string (raw text, to be JSON.parse'd by the caller), or
//   - an object (already-parsed by Vercel — pass through to validateInput
//     directly so we skip a JSON.parse round-trip and surface clearer
//     errors).
// In all cases a 2KB byte cap is enforced.
async function readBody(req) {
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('payload too large'); err.code = 'TOO_LARGE'; throw err;
    }
    return req.body;
  }
  if (req.body && typeof req.body === 'object') {
    // Vercel pre-parsed it. Apply the size check against the serialised
    // form (the only honest way to express a 2KB cap on a structured
    // object) and return the object itself — the handler bypasses
    // JSON.parse for this path.
    const s = JSON.stringify(req.body);
    if (Buffer.byteLength(s, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('payload too large'); err.code = 'TOO_LARGE'; throw err;
    }
    return req.body;
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

  // Origin gate. Require EITHER an allow-listed Origin header, OR a
  // Sec-Fetch-Site === 'same-origin' marker on requests that legitimately
  // omit Origin (some browser modes / fetch keepalive paths drop it for
  // same-origin requests). Server-to-server tools and scrapers send no
  // Origin and no Sec-Fetch-Site — they get blocked. This closes the
  // previous bypass where `if (reqOrigin && !corsOrigin)` only fired when
  // Origin was set, letting null-Origin scrapers through.
  const secFetchSite = req.headers['sec-fetch-site'];
  const sameOriginFetch = secFetchSite === 'same-origin';
  if (!corsOrigin && !sameOriginFetch) {
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
  // 'unknown' is a sentinel meaning we could not extract a client IP from
  // any header — that should only happen for direct sockets to the Node
  // server (extremely rare in production). All such requests share the
  // same bucket, so one bad actor would block all legit callers. Apply
  // a much tighter throttle. We do this by checking the same bucket
  // twice (cheap; the bucket is in-process Map) — once for the normal
  // limit and once with a synthetic 'unknown:tight' key that has its
  // own 1/min cap.
  if (ip === 'unknown') {
    const tight = checkRateLimit('unknown:tight');
    if (!tight.allowed || tight.minuteRemaining < (tight.minuteLimit - 1)) {
      // Either already over its own tight limit, or this is the second+
      // request to the shared 'unknown' bucket within the minute.
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Rate limit exceeded (anonymous client). Retry after 60s.' });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 429, ms: Date.now() - startedAt, rl: 'unknown' });
      return;
    }
  }
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
  // readBody returns either a string (raw bytes / pre-stringified body)
  // or an object (Vercel pre-parsed JSON). Skip JSON.parse for the
  // object path — it has nothing to add and would either round-trip or
  // throw on a re-stringify edge case.
  if (typeof raw === 'object') {
    parsed = raw;
  } else {
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'json' });
      return;
    }
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
  } catch (e) {
    // DST-gap and similar wall-clock-doesn't-exist errors throw a
    // descriptive ValidationError — surface its message verbatim. Other
    // errors get the generic message (and we don't leak internals).
    const msg = (e instanceof ValidationError)
      ? e.message
      : 'Could not resolve birth date/time in the given timezone.';
    res.status(400).json({ error: msg });
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
  if (dateUTC && dateUTC.__ambiguous) {
    warnings.push('birth time fell inside a DST fall-back hour and was ambiguous; the earlier occurrence was used (standard convention)');
  }
  // Pre-1883 dates predate the standardised timezone system in most of
  // the world — wall clocks ran on Local Mean Time (LMT) tied to the
  // observer's longitude, and the IANA tz database's pre-1883 offsets
  // for most zones are best-effort approximations of that LMT. The
  // computed chart is still close but the timezone-of-record may be
  // off by minutes for non-IANA-canonical historic locations.
  if (input.date < '1883-01-01') {
    warnings.push('pre-1883 date: most regions used Local Mean Time, not the modern IANA zone; computed offset may differ from the historic wall-clock by minutes');
  }

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

  // Per-planet decomposition. Nakshatra + navamsha (D9) are sidereal
  // divisions of the ecliptic; we compute them from the already-adjusted
  // longitude. For tradition: 'sidereal' (the Vedic default) that is the
  // sidereal longitude and the result is canonical. For tradition: 'tropical'
  // the same divisions are applied to the tropical longitude — emitted for
  // completeness, but Vedic readers should request 'sidereal'.
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
      nakshatra: nakshatraOf(p.longitude),
      navamsha: navamshaOf(p.longitude),
    };
  });

  const ascD = decomposeLongitude(ascLon);
  const mcD = decomposeLongitude(mcLon);

  // Convenience pointer: the Moon's nakshatra is the Vedic-cosmology
  // centerpiece — the first thing a Vedic reader asks for. Surface it at the
  // top level so clients don't have to scan planets[]. Defensive null if
  // the Moon were somehow missing (it never is).
  const moon = planets.find((p) => p.name === 'Moon');
  const moonNakshatra = moon ? moon.nakshatra : null;

  return {
    ascendant: { longitude: ascLon, sign: ascD.sign, signIndex: ascD.signIndex, degree: ascD.degree, minute: ascD.minute, second: ascD.second },
    midheaven: { longitude: mcLon, sign: mcD.sign, signIndex: mcD.signIndex, degree: mcD.degree, minute: mcD.minute, second: mcD.second },
    planets,
    moonNakshatra,
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
      // The Rahu/Ketu longitudes returned in `planets[]` are based on the
      // Moon's MEAN ascending node (Meeus 1998 eq. 22.4) — they do not
      // include the ±~1.5° nutation oscillation of the TRUE node. This
      // matches Jagannatha Hora / Parashara's Light defaults and is the
      // standard choice for Lahiri-sidereal Vedic charts, but consumers
      // who specifically want the true node should not use these values.
      // See api/_lib/astronomy.js#lunarNodeTropical for the formula.
      nodeModel: 'mean',
      warnings,
    },
    computedAt: new Date().toISOString(),
  };
}
