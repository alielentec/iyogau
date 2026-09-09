export function isProdLikeEnv() {
  const v = process.env.VERCEL_ENV;
  if (v) return v === 'production' || v === 'preview';
  return process.env.NODE_ENV === 'production';
}

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function localDevAuthEnabled() {
  return !isProdLikeEnv() && process.env.IYOGAU_ENABLE_DEV_AUTH !== '0';
}
