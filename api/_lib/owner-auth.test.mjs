import assert from 'node:assert/strict';
import test from 'node:test';

import { isOwnerUser, ownerEmails, ownerSubjects, trustedOwnerEmailProviders } from './owner-auth.js';

const ENV_KEYS = [
  'IYOGAU_OWNER_EMAILS',
  'IYOGAU_OWNER_EMAIL_PROVIDERS',
  'IYOGAU_OWNER_SUBJECTS',
  'NODE_ENV',
  'VERCEL_ENV',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  ENV_KEYS.forEach((key) => {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  });
}

test('owner role defaults to Ali email through trusted OAuth providers only', () => {
  const env = snapshotEnv();
  delete process.env.IYOGAU_OWNER_EMAILS;
  delete process.env.IYOGAU_OWNER_EMAIL_PROVIDERS;
  delete process.env.IYOGAU_OWNER_SUBJECTS;
  try {
    assert.deepEqual(ownerEmails(), ['ali.elentec@gmail.com']);
    assert.deepEqual(trustedOwnerEmailProviders(), ['google', 'apple']);
    assert.equal(isOwnerUser({ id: 'google-sub-1', provider: 'google', email: 'ali.elentec@gmail.com' }), true);
    assert.equal(isOwnerUser({ id: 'password-sub-1', provider: 'password', email: 'ali.elentec@gmail.com' }), false);
    assert.equal(isOwnerUser({ id: 'student-sub-1', provider: 'google', email: 'student@example.com' }), false);
  } finally {
    restoreEnv(env);
  }
});

test('owner role can be configured by comma-separated environment emails', () => {
  const env = snapshotEnv();
  process.env.IYOGAU_OWNER_EMAILS = 'owner@example.com, second@example.com';
  process.env.IYOGAU_OWNER_EMAIL_PROVIDERS = 'google,naver';
  delete process.env.IYOGAU_OWNER_SUBJECTS;
  try {
    assert.equal(isOwnerUser({ id: 'owner-1', provider: 'google', email: 'OWNER@example.com' }), true);
    assert.equal(isOwnerUser({ id: 'owner-2', provider: 'naver', email: 'second@example.com' }), true);
    assert.equal(isOwnerUser({ id: 'owner-3', provider: 'google', email: 'ali.elentec@gmail.com' }), false);
    assert.equal(isOwnerUser({ id: 'owner-4', provider: 'password', email: 'owner@example.com' }), false);
  } finally {
    restoreEnv(env);
  }
});

test('owner role can use explicit provider subject allowlist', () => {
  const env = snapshotEnv();
  process.env.IYOGAU_OWNER_SUBJECTS = 'google:subject-1,password:local-owner';
  try {
    assert.deepEqual(ownerSubjects(), ['google:subject-1', 'password:local-owner']);
    assert.equal(isOwnerUser({ id: 'subject-1', provider: 'google', email: 'person@example.com' }), true);
    assert.equal(isOwnerUser({ id: 'local-owner', provider: 'password', email: 'person@example.com' }), true);
    assert.equal(isOwnerUser({ id: 'subject-2', provider: 'google', email: 'ali.elentec@gmail.com' }), false);
  } finally {
    restoreEnv(env);
  }
});

test('production-like environments never trust password provider by owner email', () => {
  const env = snapshotEnv();
  process.env.NODE_ENV = 'production';
  process.env.IYOGAU_OWNER_EMAILS = 'owner@example.com';
  process.env.IYOGAU_OWNER_EMAIL_PROVIDERS = 'google,password';
  delete process.env.IYOGAU_OWNER_SUBJECTS;
  try {
    assert.deepEqual(trustedOwnerEmailProviders(), ['google']);
    assert.equal(isOwnerUser({ id: 'owner-password', provider: 'password', email: 'owner@example.com' }), false);
  } finally {
    restoreEnv(env);
  }
});
