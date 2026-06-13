import { callbackParams } from '../../_lib/oauth-providers.js';
import { sendError } from '../../_lib/api-utils.js';
import { requireOwnerSession } from '../../_lib/owner-auth.js';
import { finishGoogleCalendarCallback } from '../../_lib/google-calendar-sync.js';

export default async function handler(req, res) {
  try {
    const session = requireOwnerSession(req);
    const returnTo = await finishGoogleCalendarCallback(req, res, callbackParams(req), session);
    res.statusCode = 302;
    res.setHeader('Location', returnTo || '/owner/#calendar');
    res.end();
  } catch (err) {
    sendError(res, err);
  }
}
