import { getSession } from './_lib/auth-session.js';
import {
  handleOptions,
  HttpError,
  readJson,
  requireSameOrigin,
  sendError,
  sendJson,
  setJsonHeaders,
} from './_lib/api-utils.js';
import { listProfiles, saveProfiles, sortProfiles } from './_lib/profile-store.js';
import {
  assertNoDuplicateProfile,
  demoteOtherSelfProfiles,
  normalizeProfileInput,
  profileDuplicateIdentityChanged,
  toClientProfile,
} from './_lib/profile-validation.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);

    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: 'Sign in required.' });

    if (req.method === 'GET') {
      const profiles = sortProfiles(await listProfiles(session.user.id)).map(toClientProfile);
      return sendJson(res, 200, { profiles });
    }

    requireSameOrigin(req);

    if (req.method === 'POST') {
      const body = await readJson(req);
      const existingProfiles = await listProfiles(session.user.id);
      const profile = normalizeProfileInput(body);
      assertNoDuplicateProfile(existingProfiles, profile);
      const nextProfiles = profile.profileType === 'self'
        ? demoteOtherSelfProfiles(existingProfiles, profile.id).concat(profile)
        : existingProfiles.concat(profile);
      const saved = await saveProfiles(session.user.id, nextProfiles);
      return sendJson(res, 201, { profile: toClientProfile(saved.find((p) => p.id === profile.id)) });
    }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      const id = body && String(body.id || '');
      if (!id) throw new HttpError(400, '`id` is required.');
      const existingProfiles = await listProfiles(session.user.id);
      const existing = existingProfiles.find((p) => p.id === id);
      if (!existing) throw new HttpError(404, 'Profile not found.');
      const updated = normalizeProfileInput(body.profile || body, existing);
      if (profileDuplicateIdentityChanged(existing, updated)) {
        assertNoDuplicateProfile(existingProfiles, updated);
      }
      const nextProfiles = existingProfiles.map((p) => p.id === id ? updated : p);
      const saved = await saveProfiles(
        session.user.id,
        updated.profileType === 'self' ? demoteOtherSelfProfiles(nextProfiles, updated.id) : nextProfiles,
      );
      return sendJson(res, 200, { profile: toClientProfile(saved.find((p) => p.id === id)) });
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const id = body && String(body.id || '');
      if (!id) throw new HttpError(400, '`id` is required.');
      const existingProfiles = await listProfiles(session.user.id);
      const next = existingProfiles.filter((p) => p.id !== id);
      if (next.length === existingProfiles.length) throw new HttpError(404, 'Profile not found.');
      await saveProfiles(session.user.id, next);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    sendError(res, err);
  }
}
