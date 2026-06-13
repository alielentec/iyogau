import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from './_lib/api-utils.js';
import { resolveProfilePair } from './marriage-score.js';

const profileA = {
  id: 'profile-a',
  ownerUserId: 'user-1',
  profileType: 'self',
  displayName: 'Ali',
};

const profileB = {
  id: 'profile-b',
  ownerUserId: 'user-1',
  profileType: 'friend',
  displayName: 'Friend',
};

test('marriage score resolves only profiles already loaded for the authenticated user', () => {
  const resolved = resolveProfilePair([profileA, profileB], 'profile-a', 'profile-b');
  assert.equal(resolved.profileA.displayName, 'Ali');
  assert.equal(resolved.profileB.displayName, 'Friend');
});

test('marriage score rejects a profile id outside the authenticated user list', () => {
  assert.throws(
    () => resolveProfilePair([profileA], 'profile-a', 'other-user-profile'),
    (err) => err instanceof HttpError && err.status === 404,
  );
});

test('marriage score requires two different saved profiles', () => {
  assert.throws(
    () => resolveProfilePair([profileA], 'profile-a', 'profile-a'),
    (err) => err instanceof HttpError && err.status === 400,
  );
});
