const MAX_JSON_BYTES = 32 * 1024;
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const ALLOWED_ORIGIN = 'https://iyogau.com';
const VERCEL_PREVIEW_RE = /^https:\/\/iyogau-[a-z0-9-]+\.vercel\.app$/i;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function pickSameOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN || VERCEL_PREVIEW_RE.test(origin) || LOCALHOST_RE.test(origin)) return origin;
  return '';
}

export function setJsonHeaders(req, res) {
  const origin = pickSameOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function handleOptions(req, res) {
  const origin = pickSameOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, accept');
    res.status(204).end();
  } else {
    res.status(403).end();
  }
}

export function requireSameOrigin(req) {
  const origin = req.headers.origin || '';
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'same-origin') return;
  if (origin && pickSameOrigin(req)) return;
  throw new HttpError(403, 'Same-origin request required.');
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  let raw = '';
  if (typeof req.body === 'string') {
    raw = req.body;
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) throw new HttpError(413, 'Request body is too large.');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export function sendError(res, err) {
  const status = Number(err?.status) || 500;
  const message = err instanceof HttpError
    ? err.message
    : (status >= 500 ? 'Server error.' : (err?.message || 'Request failed.'));
  res.status(status).json({ error: message });
}
