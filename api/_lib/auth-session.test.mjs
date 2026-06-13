import assert from 'node:assert/strict';
import test from 'node:test';

import { getSession, signToken, verifyToken } from './auth-session.js';

test('signed auth tokens verify and reject tampering', () => {
  const token = signToken({ sub: 'google-user-1', provider: 'google' }, 60);
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'google-user-1');
  assert.equal(payload.provider, 'google');

  const parts = token.split('.');
  const tampered = parts[0].replace(/.$/, parts[0].endsWith('a') ? 'b' : 'a') + '.' + parts[1];
  assert.equal(verifyToken(tampered), null);
});

test('password sessions are accepted as authenticated account sessions', () => {
  const token = signToken({
    sub: 'password:user-id',
    provider: 'password',
    email: 'person@example.test',
    name: 'Direct User',
  }, 60);

  const session = getSession({ headers: { cookie: `iyogau_session=${encodeURIComponent(token)}` } });

  assert.equal(session.user.id, 'password:user-id');
  assert.equal(session.user.email, 'person@example.test');
  assert.equal(session.user.provider, 'password');
});
