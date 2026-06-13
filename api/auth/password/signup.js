import {
  createPasswordAccount,
  enforcePasswordAuthRateLimit,
  toSessionUser,
} from '../../_lib/password-auth.js';
import { setSessionCookie } from '../../_lib/auth-session.js';
import {
  handleOptions,
  readJson,
  requireSameOrigin,
  sendError,
  sendJson,
  setJsonHeaders,
} from '../../_lib/api-utils.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    requireSameOrigin(req);
    enforcePasswordAuthRateLimit(req);
    const account = await createPasswordAccount(await readJson(req));
    const user = toSessionUser(account);
    setSessionCookie(req, res, user);
    return sendJson(res, 201, { ok: true, user: { id: user.sub, email: user.email, name: user.name, provider: user.provider } });
  } catch (err) {
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    sendError(res, err);
  }
}
