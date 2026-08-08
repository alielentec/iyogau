import { setSessionCookie } from '../_lib/auth-session.js';
import {
  handleOptions,
  HttpError,
  requireSameOrigin,
  sendError,
  sendJson,
  setJsonHeaders,
} from '../_lib/api-utils.js';
import { localDevAuthEnabled } from '../_lib/runtime-env.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    requireSameOrigin(req);
    if (!localDevAuthEnabled()) {
      throw new HttpError(404, 'Local development sign-in is not available.');
    }
    setSessionCookie(req, res, {
      sub: 'local-dev-user',
      email: 'local-dev@iyogau.test',
      name: 'Local Dev User',
      picture: '',
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
