import { HttpError } from './api-utils.js';
import { getSession } from './auth-session.js';

const DEFAULT_OWNER_EMAIL = 'ali.elentec@gmail.com';
const DEFAULT_OWNER_EMAIL_PROVIDERS = ['google', 'apple'];

export function ownerEmails() {
  const raw = process.env.IYOGAU_OWNER_EMAILS || DEFAULT_OWNER_EMAIL;
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function ownerSubjects() {
  const raw = process.env.IYOGAU_OWNER_SUBJECTS || '';
  return raw
    .split(',')
    .map((subject) => subject.trim())
    .filter(Boolean);
}

export function trustedOwnerEmailProviders() {
  const raw = process.env.IYOGAU_OWNER_EMAIL_PROVIDERS || DEFAULT_OWNER_EMAIL_PROVIDERS.join(',');
  return raw
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider) => provider && provider !== 'password');
}

export function isOwnerUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const provider = String(user?.provider || '').trim().toLowerCase();
  const id = String(user?.id || user?.sub || '').trim();
  if (!provider || !id) return false;

  const subjects = ownerSubjects();
  if (subjects.length) {
    return subjects.includes(id) || subjects.includes(`${provider}:${id}`);
  }

  return Boolean(
    email &&
    ownerEmails().includes(email) &&
    trustedOwnerEmailProviders().includes(provider),
  );
}

export function requireSession(req) {
  const session = getSession(req);
  if (!session) throw new HttpError(401, 'Sign in required.');
  return session;
}

export function requireOwnerSession(req) {
  const session = requireSession(req);
  if (!isOwnerUser(session.user)) throw new HttpError(403, 'Owner access required.');
  return session;
}

export function sessionUserView(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    provider: user.provider || '',
    owner: isOwnerUser(user),
  };
}
