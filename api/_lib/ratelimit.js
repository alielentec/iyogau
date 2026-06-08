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

// Anonymize IPv4 by zeroing the last octet; IPv6 by zeroing the last 80 bits
// (keep the /48 routing prefix, drop interface identifiers).
export function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';
  // Strip IPv6 zone suffix and IPv4-mapped prefix.
  let clean = ip.split('%')[0].trim();
  if (clean.startsWith('::ffff:')) clean = clean.slice(7);
  if (clean.includes('.') && !clean.includes(':')) {
    const parts = clean.split('.');
    if (parts.length === 4) return parts.slice(0, 3).join('.') + '.0';
    return 'unknown';
  }
  if (clean.includes(':')) {
    // Expand and zero everything past the first 3 groups (/48).
    const groups = clean.split(':');
    const firstThree = groups.slice(0, 3).filter(Boolean);
    if (firstThree.length === 3) return firstThree.join(':') + '::';
    return 'ipv6';
  }
  return 'unknown';
}
