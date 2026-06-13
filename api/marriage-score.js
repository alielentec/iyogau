import { buildChart } from './calculate-chart.js';
import { computeAshtakoota } from './_lib/ashtakoota.js';
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
import { listProfiles } from './_lib/profile-store.js';
import { localToUTC } from './_lib/validate.js';

function profileInput(profile) {
  return {
    date: profile.birthDate,
    time: profile.unknownTime ? '12:00' : profile.birthTime,
    tz: profile.timezone,
    lat: Number(profile.lat),
    lon: Number(profile.lon),
    tradition: 'sidereal',
    ayanamsa: 'true_chitrapaksha',
    unknownTime: !!profile.unknownTime,
  };
}

function chartForProfile(profile) {
  const input = profileInput(profile);
  const dateUTC = localToUTC(input.date, input.time, input.tz);
  return buildChart(input, dateUTC);
}

export function resolveProfilePair(profiles, profileAId, profileBId) {
  const idA = String(profileAId || '');
  const idB = String(profileBId || '');
  if (!idA || !idB) throw new HttpError(400, '`profileAId` and `profileBId` are required.');
  if (idA === idB) throw new HttpError(400, 'Choose two different saved profiles.');

  const profileA = profiles.find((profile) => profile.id === idA);
  const profileB = profiles.find((profile) => profile.id === idB);
  if (!profileA || !profileB) throw new HttpError(404, 'One or both profiles were not found.');
  return { profileA, profileB };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return handleOptions(req, res);
    setJsonHeaders(req, res);

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: 'Sign in required.' });

    requireSameOrigin(req);
    const body = await readJson(req);
    const profiles = await listProfiles(session.user.id);
    const { profileA, profileB } = resolveProfilePair(profiles, body.profileAId, body.profileBId);
    const chartA = chartForProfile(profileA);
    const chartB = chartForProfile(profileB);
    const score = computeAshtakoota(chartA, chartB);

    return sendJson(res, 200, {
      profileA: { id: profileA.id, displayName: profileA.displayName, profileType: profileA.profileType },
      profileB: { id: profileB.id, displayName: profileB.displayName, profileType: profileB.profileType },
      score,
    });
  } catch (err) {
    return sendError(res, err);
  }
}
