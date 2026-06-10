import { getSession } from '../_lib/auth-session.js';
import { handleOptions, sendJson, setJsonHeaders } from '../_lib/api-utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  setJsonHeaders(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  const session = getSession(req);
  if (!session) return sendJson(res, 200, { authenticated: false, user: null });
  return sendJson(res, 200, { authenticated: true, user: session.user });
}
