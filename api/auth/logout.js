import { clearSessionCookie } from '../_lib/auth-session.js';
import { handleOptions, requireSameOrigin, sendError, sendJson, setJsonHeaders } from '../_lib/api-utils.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    requireSameOrigin(req);
    clearSessionCookie(req, res);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
