import { finishGoogleCallback } from '../../_lib/google-oauth.js';
import { HttpError, sendError } from '../../_lib/api-utils.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const returnTo = await finishGoogleCallback(req, res, url.searchParams);
    res.statusCode = 302;
    res.setHeader('Location', returnTo || '/#natal-calc');
    res.end();
  } catch (err) {
    sendError(res, err);
  }
}
