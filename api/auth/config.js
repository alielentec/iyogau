import { handleOptions, sendJson, setJsonHeaders } from '../_lib/api-utils.js';
import { googleRedirectUri } from '../_lib/google-oauth.js';
import { authProvidersConfig, providerOAuthConfigured } from '../_lib/oauth-providers.js';
import { profileStorageAvailable } from '../_lib/profile-store.js';
import { localDevAuthEnabled } from '../_lib/runtime-env.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  setJsonHeaders(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  const providers = authProvidersConfig(req);
  return sendJson(res, 200, {
    providers,
    passwordAuthAvailable: profileStorageAvailable(),
    googleConfigured: providerOAuthConfigured('google'),
    localDevAuthAvailable: localDevAuthEnabled(),
    googleRedirectUri: googleRedirectUri(req),
  });
}
