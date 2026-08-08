// POST /api/astrocarto
//
// Astrocartography lines + heat-matrix for a natal chart, scored under one of
// three life-mode lenses: relocation, immigration, soulmate.
//
// Math lives in ./_lib/astrocarto.js. This file is the HTTP envelope: CORS,
// rate-limit, validation, timezone resolution, response shaping. Same security
// posture as /api/calculate-chart — birth data NEVER logged, anonymised IP,
// shared rate bucket, 4 KB body cap.
//
// Returns 4 polylines per planet (MC, IC, AC, DC) × 9 Vedic bodies, plus a
// full-world center-sampled vector grid at the chosen resolution. Default
// 'medium' grid is 4°×4° → 45 × 90 = 4050 cells. The response is deterministic
// for a given (date,time,tz,lat,lon,tradition,mode,resolution) tuple → safe to
// cache 5 min in the browser.

import { checkRateLimit, anonymizeIp, shouldBypassLocalRateLimit } from './_lib/ratelimit.js';
import { localToUTC, ValidationError } from './_lib/validate.js';
import { validateAstrocartoInput } from './_lib/validate-astrocarto.js';
import { astroCartography, buildAstroNatal, buildSoulmateTimingBounds, buildSoulmateTimingTimeline } from './_lib/astrocarto.js';

const ENGINE_VERSION = '2.1.19';
const ASTROCARTO_VERSION = '1.3.0';
const ALLOWED_ORIGIN = 'https://iyogau.com';
const VERCEL_PREVIEW_RE = /^https:\/\/iyogau-[a-z0-9-]+\.vercel\.app$/i;
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
// Slightly larger than /api/calculate-chart's 2 KB because astrocarto carries
// optional currentResidence (and possibly resolution). Still tiny: typical
// request is ~250 bytes, max realistic ~600 bytes. 4 KB gives generous
// headroom without inviting payload-amplification.
const MAX_BODY_BYTES = 4 * 1024;

function isProdLikeEnv() {
  const v = process.env.VERCEL_ENV;
  if (v) return v === 'production' || v === 'preview';
  return process.env.NODE_ENV === 'production';
}

function pickCorsOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (reqOrigin === ALLOWED_ORIGIN) return reqOrigin;
  if (VERCEL_PREVIEW_RE.test(reqOrigin)) return reqOrigin;
  if (!isProdLikeEnv() && LOCALHOST_RE.test(reqOrigin)) return reqOrigin;
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

// Same IP-extraction trust order as /api/calculate-chart. On Vercel only
// `x-vercel-forwarded-for` is unspoofable; `x-real-ip` is gated to non-prod.
function clientIp(req) {
  const vercelXff = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelXff === 'string' && vercelXff.length > 0 && vercelXff.length < 256) {
    return vercelXff.split(',')[0].trim();
  }
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0 && xff.length < 256) {
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  if (!process.env.VERCEL_ENV) {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.length > 0 && realIp.length < 64) {
      return realIp.trim();
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function logLine(fields) {
  try { console.log(JSON.stringify(fields)); } catch { /* swallow */ }
}

async function readBody(req) {
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('payload too large'); err.code = 'TOO_LARGE'; throw err;
    }
    return req.body;
  }
  if (req.body && typeof req.body === 'object') {
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

  if (req.method === 'OPTIONS') {
    setCors(res, corsOrigin);
    res.status(corsOrigin ? 204 : 403).end();
    logLine({ t: new Date().toISOString(), ip: anonIp, status: corsOrigin ? 204 : 403, ms: Date.now() - startedAt, method: 'OPTIONS', route: 'astrocarto' });
    return;
  }

  setCors(res, corsOrigin);

  const secFetchSite = req.headers['sec-fetch-site'];
  const sameOriginFetch = secFetchSite === 'same-origin';
  if (!corsOrigin && !sameOriginFetch) {
    res.status(403).json({ error: 'Origin not allowed.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 403, ms: Date.now() - startedAt, reason: 'origin', route: 'astrocarto' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 405, ms: Date.now() - startedAt, method: req.method, route: 'astrocarto' });
    return;
  }

  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 415, ms: Date.now() - startedAt, route: 'astrocarto' });
    return;
  }

  // Rate limit — SHARED with /api/calculate-chart. Both endpoints serve the
  // same free-tool surface, and astrocarto compute is ~5-10× heavier than
  // the natal chart. Sharing the bucket means an attacker cannot get 5
  // charts + 5 astrocartos per minute (10 total) by alternating endpoints.
  if (shouldBypassLocalRateLimit(ip, reqOrigin, secFetchSite)) {
    res.setHeader('X-RateLimit-Bypass', 'local-development');
  } else {
    if (ip === 'unknown') {
      const tight = checkRateLimit('unknown:tight');
      if (!tight.allowed || tight.minuteRemaining < (tight.minuteLimit - 1)) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'Rate limit exceeded (anonymous client). Retry after 60s.' });
        logLine({ t: new Date().toISOString(), ip: anonIp, status: 429, ms: Date.now() - startedAt, rl: 'unknown', route: 'astrocarto' });
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
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 429, ms: Date.now() - startedAt, rl: rl.reason, route: 'astrocarto' });
      return;
    }
  }

  // Read + parse body.
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') {
      res.status(413).json({ error: `Request body exceeds ${MAX_BODY_BYTES} byte limit.` });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 413, ms: Date.now() - startedAt, route: 'astrocarto' });
      return;
    }
    res.status(400).json({ error: 'Failed to read request body.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'read', route: 'astrocarto' });
    return;
  }

  let parsed;
  if (typeof raw === 'object') {
    parsed = raw;
  } else {
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'json', route: 'astrocarto' });
      return;
    }
  }

  let input;
  try {
    input = validateAstrocartoInput(parsed);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message });
      logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'validate', route: 'astrocarto' });
      return;
    }
    throw e;
  }

  let dateUTC;
  try {
    dateUTC = localToUTC(input.date, input.time, input.tz);
    if (Number.isNaN(dateUTC.getTime())) throw new Error('invalid date');
  } catch (e) {
    const msg = (e instanceof ValidationError)
      ? e.message
      : 'Could not resolve birth date/time in the given timezone.';
    res.status(400).json({ error: msg });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 400, ms: Date.now() - startedAt, reason: 'tz', route: 'astrocarto' });
    return;
  }

  let payload;
  try {
    payload = buildAstrocartoPayload(input, dateUTC);
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute astrocartography.' });
    logLine({ t: new Date().toISOString(), ip: anonIp, status: 500, ms: Date.now() - startedAt, err: e && e.name, route: 'astrocarto' });
    return;
  }

  // Output is deterministic for the input tuple. 5 minutes in the browser
  // lets repeated mode-tab clicks reuse the response. `private` keeps the
  // shared CDN out of it — we don't want to cache PII-shaped request bodies
  // at the edge.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).json(payload);
  logLine({ t: new Date().toISOString(), ip: anonIp, status: 200, ms: Date.now() - startedAt, mode: input.mode, resolution: input.resolution, route: 'astrocarto' });
}

export function buildAstrocartoPayload(input, dateUTC) {
  const warnings = [];
  if (dateUTC && dateUTC.__ambiguous) {
    warnings.push('birth time fell inside a DST fall-back hour and was ambiguous; the earlier occurrence was used (standard convention)');
  }
  if (input.date < '1883-01-01') {
    warnings.push('pre-1883 date: most regions used Local Mean Time, not the modern IANA zone; computed offset may differ from the historic wall-clock by minutes');
  }
  if (input.mode === 'immigration' && !input.currentResidence) {
    warnings.push('immigration currentResidence not supplied; residence-distance adjustment omitted');
  }
  const timingBounds = input.mode === 'soulmate_timing'
    ? buildSoulmateTimingBounds(input.date)
    : null;

  const natalChart = buildAstroNatal(input, dateUTC);
  // Hand currentResidence through to the matrix scorer (only read when
  // mode === 'immigration'; for other modes it has no effect).
  natalChart.currentResidence = input.currentResidence;
  const targetDateUTC = input.targetDate
    ? new Date(`${input.targetDate}T12:00:00.000Z`)
    : null;

  const compute = astroCartography(natalChart, input.mode, {
    includeHeat: input.includeHeat !== false,
    latStep: input.latStep,
    lonStep: input.lonStep,
    targetDateUTC,
  });
  const cityTiming = input.mode === 'soulmate_timing' && input.targetLocation
    ? buildSoulmateTimingTimeline(natalChart, compute.lines, input.targetLocation, timingBounds)
    : null;

  return {
    version: ASTROCARTO_VERSION,
    mode: compute.mode,
    modeLabel: compute.modeLabel,
    modeWeights: compute.modeWeights,
    natalSummary: {
      ascendant: round6(natalChart.ascendant),
      midheaven: round6(natalChart.midheaven),
      ascSign: natalChart.ascSign,
      ayanamsa: input.tradition === 'sidereal' ? round6(natalChart.ayanamsa) : null,
      positions: natalChart.positions.map((p) => ({
        key: p.key,
        longitude: round6(p.longitude),
        sign: p.sign,
        house: p.house,
        ra: round6(p.ra),
        dec: round6(p.dec),
      })),
    },
    lines: compute.lines.map((line) => ({
      planet: line.planet,
      type: line.type,
      weight: Math.round(line.weight * 10000) / 10000,
      scoreType: line.scoreType,
      // Preserve sub-arcsecond geometry in the HTTP payload. Rounding to
      // 2 decimals visibly kept the curve shape but moved AC/DC horizon
      // points by multiple arcseconds, which is unacceptable for this map.
      points: line.points.map(([lon, lat]) => [round6(lon), round6(lat)]),
    })),
    timing: compute.timing && {
      targetDate: compute.timing.targetDate,
      targetTimeUTC: compute.timing.targetTimeUTC,
      timelineStartDate: timingBounds?.startDate || null,
      timelineEndDate: timingBounds?.endDate || null,
      timelineTotalDays: timingBounds?.totalDays || null,
      blend: compute.timing.blend,
      globalActivationScore: compute.timing.globalActivationScore,
      transitWeights: compute.timing.transitWeights,
      lines: compute.timing.lines.map((line) => ({
        planet: line.planet,
        type: line.type,
        weight: Math.round(line.weight * 10000) / 10000,
        scoreType: line.scoreType,
        points: line.points.map(([lon, lat]) => [round6(lon), round6(lat)]),
      })),
    },
    cityTiming,
    heatMatrix: compute.heatMatrix && {
      formula: compute.heatMatrix.formula,
      sigmaKm: compute.heatMatrix.sigmaKm,
      influenceKm: compute.heatMatrix.influenceKm,
      projection: compute.heatMatrix.projection,
      coordinateRole: compute.heatMatrix.coordinateRole,
      latRange: compute.heatMatrix.latRange,
      lonRange: compute.heatMatrix.lonRange,
      latStep: compute.heatMatrix.latStep,
      lonStep: compute.heatMatrix.lonStep,
      latitudes: compute.heatMatrix.latitudes,
      longitudes: compute.heatMatrix.longitudes,
      xCoordinates: compute.heatMatrix.xCoordinates,
      yCoordinates: compute.heatMatrix.yCoordinates,
      values: compute.heatMatrix.values,
      cellMeta: compute.heatMatrix.cellMeta,
      cells: compute.heatMatrix.cells,
      minValue: compute.heatMatrix.minValue,
      maxValue: compute.heatMatrix.maxValue,
    },
    input: {
      date: input.date,
      time: input.time,
      tz: input.tz,
      lat: input.lat,
      lon: input.lon,
      tradition: input.tradition,
      ayanamsa: input.ayanamsa,
      mode: input.mode,
      resolution: input.resolution,
      currentResidence: input.currentResidence,
      targetDate: input.targetDate,
      targetLocation: input.targetLocation,
      includeHeat: input.includeHeat,
    },
    provenance: {
      engine: 'astronomy-engine',
      engineVersion: ENGINE_VERSION,
      astrocartoVersion: ASTROCARTO_VERSION,
      timingModel: input.mode === 'soulmate_timing'
        ? 'natal-soulmate-plus-noon-utc-transit-angular-lines-birth-to-age-50'
        : null,
      immigrationDistanceBasis: input.mode === 'immigration'
        ? (input.currentResidence ? 'currentResidence' : 'omitted')
        : null,
      // Rahu/Ketu use the MEAN ascending node (same caveat as
      // /api/calculate-chart). True node consumers cannot rely on these.
      nodeModel: 'mean',
      warnings,
    },
    computedAt: new Date().toISOString(),
  };
}

function round6(v) { return Math.round(v * 1000000) / 1000000; }
