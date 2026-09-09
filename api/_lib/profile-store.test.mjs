import assert from 'node:assert/strict';
import test from 'node:test';

import { sortProfiles } from './profile-store.js';

test('profile sorting keeps self profile first and then newest updates', () => {
  const sorted = sortProfiles([
    { id: 'friend-old', profileType: 'friend', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'other-new', profileType: 'other', updatedAt: '2026-02-01T00:00:00.000Z' },
    { id: 'self', profileType: 'self', updatedAt: '2025-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ['self', 'other-new', 'friend-old']);
});
