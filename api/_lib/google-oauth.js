import { createOAuthState, setSessionCookie, verifyOAuthState } from './auth-session.js';
import { HttpError } from './api-utils.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

function config(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpError(503, 'Google Sign-In is not configured.');
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || absoluteUrl(req, '/api/auth/google/callback/');
  return { clientId, clientSecret, redirectUri };
}

function absoluteUrl(req, path) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4177';
  return `${proto}://${host}${path}`;
}

export function buildGoogleAuthRedirect(req, res, returnTo) {
  const cfg = config(req);
  const nonce = createOAuthState(req, res, returnTo);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    access_type: 'online',
    state: nonce,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function finishGoogleCallback(req, res, query) {
  const cfg = config(req);
  const code = query.get('code');
  const state = query.get('state');
  const oauthState = verifyOAuthState(req, res, state);
  if (!oauthState) throw new HttpError(400, 'Invalid or expired Google sign-in state.');
  if (!code) throw new HttpError(400, 'Missing Google authorization code.');

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new HttpError(502, 'Google token exchange failed.');
  }
  const claims = decodeJwtPayload(tokenJson.id_token);
  validateClaims(claims, cfg.clientId);
  const user = {
    sub: String(claims.sub),
    email: claims.email || '',
    name: claims.name || '',
    picture: claims.picture || '',
  };
  setSessionCookie(req, res, user);
  return oauthState.returnTo;
}

function decodeJwtPayload(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new HttpError(502, 'Google did not return an identity token.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(502, 'Malformed Google identity token.');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - parts[1].length % 4) % 4);
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    throw new HttpError(502, 'Could not parse Google identity token.');
  }
}

function validateClaims(claims, clientId) {
  if (!claims || typeof claims !== 'object') throw new HttpError(502, 'Google identity token is empty.');
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new HttpError(502, 'Google identity token issuer mismatch.');
  if (claims.aud !== clientId) throw new HttpError(502, 'Google identity token audience mismatch.');
  if (!claims.sub) throw new HttpError(502, 'Google identity token has no subject.');
  if (Number(claims.exp) <= Math.floor(Date.now() / 1000)) throw new HttpError(502, 'Google identity token is expired.');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new HttpError(403, 'Google account email must be verified.');
  }
}
