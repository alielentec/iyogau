import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoDuplicateProfile,
  assertSingleSelfProfile,
  demoteOtherSelfProfiles,
  normalizeProfileInput,
  profileDuplicateIdentityChanged,
  toClientProfile,
} from './profile-validation.js';

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

test('profile validation rejects unresolved 0,0 coordinates', () => {
  assert.throws(
    () => normalizeProfileInput({ ...baseProfile, lat: 0, lon: 0 }),
    /cannot both be 0/,
  );
});

test('duplicate profile guard blocks same person details and allows meaningful differences', () => {
  const existing = normalizeProfileInput({ ...baseProfile, displayName: '  Ali  ' });
  const duplicate = normalizeProfileInput({ ...baseProfile, profileType: 'other', displayName: 'ali' });
  assert.throws(
    () => assertNoDuplicateProfile([existing], duplicate),
    /same name, birth date, birth time, and birthplace/,
  );

  const differentDate = normalizeProfileInput({ ...baseProfile, birthDate: '1985-06-10' });
  assert.doesNotThrow(() => assertNoDuplicateProfile([existing], differentDate));
});

test('single self profile rule blocks a second self profile for the same user list', () => {
  const existing = normalizeProfileInput({ ...baseProfile, displayName: 'Existing self' });
  const candidate = normalizeProfileInput({ ...baseProfile, displayName: 'New self' });
  assert.throws(() => assertSingleSelfProfile([existing], candidate), /Only one My Profile/);

  const update = normalizeProfileInput({ ...baseProfile, displayName: 'Updated self' }, existing);
  assert.doesNotThrow(() => assertSingleSelfProfile([existing], update));
});

test('profile default helper demotes the previous self profile', () => {
  const existingSelf = normalizeProfileInput({ ...baseProfile, displayName: 'Existing self' });
  const newSelf = normalizeProfileInput({ ...baseProfile, displayName: 'New self' });
  const friend = normalizeProfileInput({ ...baseProfile, profileType: 'friend', displayName: 'Friend' });
  const next = demoteOtherSelfProfiles([existingSelf, friend, newSelf], newSelf.id);
  assert.equal(next.find((profile) => profile.id === existingSelf.id).profileType, 'other');
  assert.equal(next.find((profile) => profile.id === newSelf.id).profileType, 'self');
  assert.equal(next.find((profile) => profile.id === friend.id).profileType, 'friend');
});

test('profile default changes do not count as duplicate identity edits', () => {
  const duplicateA = normalizeProfileInput({ ...baseProfile, profileType: 'other', displayName: 'Duplicate' });
  const duplicateB = normalizeProfileInput({ ...baseProfile, profileType: 'other', displayName: 'Duplicate' });
  const nextDefault = normalizeProfileInput({ ...baseProfile, profileType: 'self', displayName: 'Duplicate' }, duplicateB);

  assert.equal(profileDuplicateIdentityChanged(duplicateB, nextDefault), false);
  assert.throws(
    () => assertNoDuplicateProfile([duplicateA, duplicateB], nextDefault),
    /same name, birth date, birth time, and birthplace/,
  );
});
