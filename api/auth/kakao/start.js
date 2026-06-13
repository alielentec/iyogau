import { buildProviderAuthRedirect } from '../../_lib/oauth-providers.js';
import { HttpError, sendError } from '../../_lib/api-utils.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const returnTo = url.searchParams.get('returnTo') || '/#natal-calc';
    const location = buildProviderAuthRedirect(req, res, 'kakao', returnTo);
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
  } catch (err) {
    sendError(res, err);
  }
}
