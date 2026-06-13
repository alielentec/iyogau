import {
  buildProviderAuthRedirect,
  clearOAuthProviderCachesForTests,
  finishProviderCallback,
  providerRedirectUri,
  verifyIdTokenForProvider,
} from './oauth-providers.js';

export function googleRedirectUri(req) {
  return providerRedirectUri(req, 'google');
}

export function buildGoogleAuthRedirect(req, res, returnTo) {
  return buildProviderAuthRedirect(req, res, 'google', returnTo);
}

export async function finishGoogleCallback(req, res, query) {
  return finishProviderCallback(req, res, 'google', query);
}

export async function verifyGoogleIdToken(idToken, clientId) {
  return verifyIdTokenForProvider('google', idToken, clientId);
}

export function clearGoogleJwksCacheForTests() {
  clearOAuthProviderCachesForTests();
}
