import assert from 'node:assert/strict';
import test from 'node:test';

import { isOwnerUser, ownerEmails } from './owner-auth.js';

test('owner role defaults to the configured Ali owner account', () => {
  const previous = process.env.IYOGAU_OWNER_EMAILS;
  delete process.env.IYOGAU_OWNER_EMAILS;
  try {
    assert.deepEqual(ownerEmails(), ['ali.elentec@gmail.com']);
    assert.equal(isOwnerUser({ email: 'ali.elentec@gmail.com' }), true);
    assert.equal(isOwnerUser({ email: 'student@example.com' }), false);
  } finally {
    if (previous === undefined) delete process.env.IYOGAU_OWNER_EMAILS;
    else process.env.IYOGAU_OWNER_EMAILS = previous;
  }
});

test('owner role can be configured by comma-separated environment emails', () => {
  const previous = process.env.IYOGAU_OWNER_EMAILS;
  process.env.IYOGAU_OWNER_EMAILS = 'owner@example.com, second@example.com';
  try {
    assert.equal(isOwnerUser({ email: 'OWNER@example.com' }), true);
    assert.equal(isOwnerUser({ email: 'second@example.com' }), true);
    assert.equal(isOwnerUser({ email: 'ali.elentec@gmail.com' }), false);
  } finally {
    if (previous === undefined) delete process.env.IYOGAU_OWNER_EMAILS;
    else process.env.IYOGAU_OWNER_EMAILS = previous;
  }
});
