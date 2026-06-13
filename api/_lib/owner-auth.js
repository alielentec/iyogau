import { HttpError } from './api-utils.js';
import { getSession } from './auth-session.js';

const DEFAULT_OWNER_EMAIL = 'ali.elentec@gmail.com';

export function ownerEmails() {
  const raw = process.env.IYOGAU_OWNER_EMAILS || DEFAULT_OWNER_EMAIL;
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return Boolean(email && ownerEmails().includes(email));
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
