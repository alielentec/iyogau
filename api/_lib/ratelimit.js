// In-memory per-IP token bucket. Two windows: 5/min and 20/day.
//
// State lives in module scope and survives across requests within a single
// Vercel function instance. Cold starts reset it. This is acceptable for a
// public free-tool lead magnet: a determined abuser can scale-out by waiting
// for cold starts, but typical abuse (single-host scraping) is throttled.
// A future revision should move to Upstash/Redis if abuse warrants it.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_LIMIT = 5;
const DAY_LIMIT = 20;
// Cap the Map size so a flood of unique IPs cannot OOM the instance.
const MAX_TRACKED_IPS = 10_000;
const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const buckets = new Map();

function getBucket(ip, now) {
  let b = buckets.get(ip);
  if (!b) {
    if (buckets.size >= MAX_TRACKED_IPS) {
      // Evict the oldest entry (Map iteration order = insertion order).
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    b = { minuteCount: 0, minuteWindowStart: now, dayCount: 0, dayWindowStart: now };
    buckets.set(ip, b);
  }
  return b;
}

export function checkRateLimit(ip) {
  const now = Date.now();
  const b = getBucket(ip, now);

  if (now - b.minuteWindowStart >= MINUTE_MS) {
    b.minuteCount = 0;
    b.minuteWindowStart = now;
  }
  if (now - b.dayWindowStart >= DAY_MS) {
    b.dayCount = 0;
    b.dayWindowStart = now;
  }

  const minuteRemaining = Math.max(0, MINUTE_LIMIT - b.minuteCount);
  const dayRemaining = Math.max(0, DAY_LIMIT - b.dayCount);

  if (b.minuteCount >= MINUTE_LIMIT) {
    const retryAfter = Math.ceil((b.minuteWindowStart + MINUTE_MS - now) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(1, retryAfter),
      reason: 'minute',
      minuteLimit: MINUTE_LIMIT, minuteRemaining: 0,
      dayLimit: DAY_LIMIT, dayRemaining,
    };
  }
  if (b.dayCount >= DAY_LIMIT) {
    const retryAfter = Math.ceil((b.dayWindowStart + DAY_MS - now) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(1, retryAfter),
      reason: 'day',
      minuteLimit: MINUTE_LIMIT, minuteRemaining,
      dayLimit: DAY_LIMIT, dayRemaining: 0,
    };
  }

  b.minuteCount += 1;
  b.dayCount += 1;
  return {
    allowed: true,
    minuteLimit: MINUTE_LIMIT, minuteRemaining: MINUTE_LIMIT - b.minuteCount,
    dayLimit: DAY_LIMIT, dayRemaining: DAY_LIMIT - b.dayCount,
  };
}

function isProdLikeEnv() {
  const v = process.env.VERCEL_ENV;
  if (v) return v === 'production' || v === 'preview';
  return process.env.NODE_ENV === 'production';
}

function isLoopbackIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.split('%')[0].trim().toLowerCase();
  return clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '0:0:0:0:0:0:0:1' ||
    clean === '::ffff:127.0.0.1';
}

export function shouldBypassLocalRateLimit(ip, origin, secFetchSite) {
  if (isProdLikeEnv()) return false;
  if (!isLoopbackIp(ip)) return false;
  return secFetchSite === 'same-origin' ||
    !origin ||
    LOCALHOST_ORIGIN_RE.test(origin);
}

// Anonymize IPv4 by zeroing the last octet; IPv6 by keeping the first 48 bits
// (the /48 routing prefix) and zeroing everything past it. Compressed IPv6
// addresses (containing `::`) must be expanded to their full 8-group form
// BEFORE slicing, or the `2001:db8::1` form collapses incorrectly.
export function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';
  // Strip IPv6 zone suffix and IPv4-mapped IPv6 prefix.
  let clean = ip.split('%')[0].trim();
  if (clean.startsWith('::ffff:')) clean = clean.slice(7);

  if (clean.includes('.') && !clean.includes(':')) {
    const parts = clean.split('.');
    if (parts.length !== 4) return 'unknown';
    if (!parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return 'unknown';
    return parts.slice(0, 3).join('.') + '.0';
  }

  if (clean.includes(':')) {
    // Expand any `::` to the full 8-group form, then take the first three
    // groups (the /48 routing prefix). Without expansion, e.g. `2001:db8::1`
    // would split to ['2001','db8','','1'] and lose the position information.
    const expanded = expandIpv6(clean);
    if (!expanded) return 'unknown';
    return expanded.slice(0, 3).join(':') + '::';
  }

  return 'unknown';
}

// Expand a possibly-compressed IPv6 address to an array of 8 hex groups.
// Returns null if malformed.
function expandIpv6(ip) {
  const dcIdx = ip.indexOf('::');
  let left = [];
  let right = [];
  if (dcIdx === -1) {
    left = ip.split(':');
  } else {
    left = ip.slice(0, dcIdx).split(':').filter((g) => g !== '');
    right = ip.slice(dcIdx + 2).split(':').filter((g) => g !== '');
  }
  const filled = 8 - left.length - right.length;
  if (filled < 0) return null;
  const middle = new Array(filled).fill('0');
  const all = [...left, ...middle, ...right];
  if (all.length !== 8) return null;
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return all;
}
