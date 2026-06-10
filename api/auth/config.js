import { handleOptions, sendJson, setJsonHeaders } from '../_lib/api-utils.js';
import { googleOAuthConfigured, localDevAuthEnabled } from '../_lib/runtime-env.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  setJsonHeaders(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  return sendJson(res, 200, {
    googleConfigured: googleOAuthConfigured(),
    localDevAuthAvailable: localDevAuthEnabled(),
  });
}
