import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSingleSelfProfile, normalizeProfileInput, toClientProfile } from './profile-validation.js';

const baseProfile = {
  profileType: 'self',
  displayName: 'Ali',
  birthDate: '1985-06-09',
  birthTime: '15:30:30',
  unknownTime: false,
  birthplaceName: 'Hamedan, Iran',
  lat: 35.196944,
  lon: 48.697778,
  timezone: '+03:30',
  notes: 'private note',
};

test('profile validation accepts second-level birth time and hides owner id from client shape', () => {
  const stored = normalizeProfileInput(baseProfile);
  stored.ownerUserId = 'google-user-1';
  assert.equal(stored.birthTime, '15:30:30');
  assert.equal(stored.timezone, '+03:30');
  assert.equal(toClientProfile(stored).ownerUserId, undefined);
});

test('profile validation rejects browser-supplied owner ids', () => {
  assert.throws(
    () => normalizeProfileInput({ ...baseProfile, ownerUserId: 'attacker' }),
    /ownership.*cannot be supplied/,
  );
});

test('single self profile rule blocks a second self profile for the same user list', () => {
  const existing = normalizeProfileInput({ ...baseProfile, displayName: 'Existing self' });
  const candidate = normalizeProfileInput({ ...baseProfile, displayName: 'New self' });
  assert.throws(() => assertSingleSelfProfile([existing], candidate), /Only one My Profile/);

  const update = normalizeProfileInput({ ...baseProfile, displayName: 'Updated self' }, existing);
  assert.doesNotThrow(() => assertSingleSelfProfile([existing], update));
});
