import { callbackParams, finishProviderCallback } from '../../_lib/oauth-providers.js';
import { HttpError, sendError } from '../../_lib/api-utils.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const returnTo = await finishProviderCallback(req, res, 'apple', callbackParams(req));
    res.statusCode = 302;
    res.setHeader('Location', returnTo || '/#natal-calc');
    res.end();
  } catch (err) {
    sendError(res, err);
  }
}
