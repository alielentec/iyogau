#!/usr/bin/env node
// Local dev server: serves the static site AND dispatches /api/* paths
// to the matching Vercel-style serverless handler in ./api/.
//
// Why this exists: on production iyogau.com runs on Vercel, which
// transparently runs api/calculate-chart.js as a serverless function.
// A plain static server (python -m http.server) doesn't know about
// serverless functions and just returns HTML for /api/calculate-chart,
// which causes the form to show "could not compute your chart" with
// nothing visible in the console.
//
// Run from the project root:
//   node scripts/dev-server.mjs
// Then open http://localhost:5180/natal-chart/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.woff2':'font/woff2',
};

const handlerCache = new Map();
async function getApiHandler(apiPath) {
  if (handlerCache.has(apiPath)) return handlerCache.get(apiPath);
  const candidates = [
    apiPath + '.js',
    apiPath + '/index.js',
  ];
  for (const candidate of candidates) {
    const full = path.join(ROOT, candidate);
    if (!fs.existsSync(full)) continue;
    const mod = await import(pathToFileURL(full).href);
    const handler = mod.default || mod.handler;
    if (typeof handler === 'function') {
      handlerCache.set(apiPath, handler);
      return handler;
    }
  }
  return null;
}

// Light Express-style req/res polyfill so Vercel-shaped handlers work locally.
function shimResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (body) => {
    if (Buffer.isBuffer(body) || typeof body === 'string') res.end(body);
    else res.json(body);
    return res;
  };
  return res;
}

function shimRequest(req, body) {
  // Vercel's req.body is the parsed JSON when Content-Type is application/json
  if (body && body.length) {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
      try { req.body = JSON.parse(body.toString('utf8')); }
      catch { req.body = body.toString('utf8'); }
    } else {
      req.body = body.toString('utf8');
    }
  } else {
    req.body = undefined;
  }
  return req;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // --- API route ----------------------------------------------------
  if (pathname.startsWith('/api/')) {
    // Read body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    shimRequest(req, body);
    shimResponse(res);

    const apiPath = pathname.replace(/\/$/, ''); // strip trailing slash
    let handler;
    try {
      handler = await getApiHandler(apiPath);
    } catch (e) {
      console.error(`[dev-server] failed to load handler for ${apiPath}:`, e.message);
      res.status(500).json({ error: 'Handler load failed', message: e.message });
      return;
    }
    if (!handler) {
      res.status(404).json({ error: 'No handler for ' + apiPath });
      return;
    }
    try {
      await handler(req, res);
    } catch (e) {
      console.error(`[dev-server] handler threw for ${apiPath}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Handler error', message: e.message });
    }
    return;
  }

  // --- Static file ---------------------------------------------------
  let filePath = path.join(ROOT, pathname);
  if (pathname.endsWith('/') || !path.extname(pathname)) {
    // Try index.html in the directory (matches Vercel's cleanUrls behavior).
    const tryIndex = path.join(filePath, 'index.html');
    if (fs.existsSync(tryIndex)) filePath = tryIndex;
    else if (fs.existsSync(filePath + '.html')) filePath = filePath + '.html';
  }
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found: ' + pathname);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`iyogau dev server listening on http://localhost:${PORT}`);
  console.log(`  - static: ${ROOT}`);
  console.log(`  - api:    ${path.join(ROOT, 'api')}`);
  console.log(`  - try:    http://localhost:${PORT}/natal-chart/`);
});
