# Social Sign-In and Saved Birth Profiles

This project now supports account-owned saved birth profiles for the natal
chart and astrocartography calculators.

## Runtime Model

- Sign-in identifies the signed-in account. Supported methods are Google,
  Apple, Kakao, Naver, and direct email/password accounts.
- Saved birth profiles identify whose chart is being calculated.
- A signed-in user can have one `self` profile and multiple `friend` or `other`
  profiles.
- The browser cannot supply `ownerUserId`; profile ownership is derived only
  from the signed session cookie.
- API responses do not expose `ownerUserId` back to the browser.
- Birth data is not written to request logs by the auth/profile APIs.

## Required Environment Variables

Production and preview deployments require:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
IYOGAU_SESSION_SECRET=at-least-32-characters
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Optional:

```bash
GOOGLE_REDIRECT_URI=https://iyogau.com/api/auth/google/callback/
APPLE_CLIENT_ID=...
APPLE_CLIENT_SECRET=...
APPLE_REDIRECT_URI=https://iyogau.com/api/auth/apple/callback/
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...
KAKAO_REDIRECT_URI=https://iyogau.com/api/auth/kakao/callback/
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
NAVER_REDIRECT_URI=https://iyogau.com/api/auth/naver/callback/
```

If `GOOGLE_REDIRECT_URI` is omitted, the server derives it from the current
host. The same rule applies to `APPLE_REDIRECT_URI`, `KAKAO_REDIRECT_URI`, and
`NAVER_REDIRECT_URI`. For local development these are usually:

```text
http://localhost:4177/api/auth/google/callback/
http://localhost:4177/api/auth/apple/callback/
http://localhost:4177/api/auth/kakao/callback/
http://localhost:4177/api/auth/naver/callback/
```

Add the matching callback URL to each provider console.

### Apple

Apple web sign-in needs an Apple Services ID as `APPLE_CLIENT_ID`. The server
can use a pre-generated `APPLE_CLIENT_SECRET`, or generate it from:

```bash
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

The Apple callback supports `form_post`, which Apple requires for name/email
scopes in the web flow.

### Kakao

Use the Kakao REST API key as `KAKAO_CLIENT_ID`. `KAKAO_CLIENT_SECRET` is only
required when client-secret validation is enabled in Kakao Developers. The app
requests `profile_nickname`, `profile_image`, and `account_email` scopes.

### Naver

Use the Naver Login client ID and client secret. Naver returns the user profile
through `https://openapi.naver.com/v1/nid/me`; the saved-profile ownership key
is prefixed with `naver:` to avoid cross-provider collisions.

### Direct Email/Password

Direct accounts are handled server-side. Passwords are never stored as plain
text; the server stores a per-account `scrypt` hash and signs the same
HttpOnly session cookie used by social sign-in. Direct account ownership keys
are prefixed with `password:`.

Direct password auth uses the same storage layer as saved profiles:

- Local development: `.data/profile-store.json`
- Production/preview: Upstash Redis REST

If production storage is missing, the password form is unavailable through
`GET /api/auth/config/`.

## Real Google Sign-In Setup

Local development is only a real Google login when these are present in
`.env.local` and the server has been restarted:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4177/api/auth/google/callback/
IYOGAU_SESSION_SECRET=...
IYOGAU_ENABLE_DEV_AUTH=0
```

Use `.env.example` as the safe template. The server loads `.env` and
`.env.local` automatically during local development, and `.env*` files are
git-ignored except `.env.example`.

The Google OAuth client must be a Web application client and must include the
same redirect URI returned by:

```bash
curl http://localhost:4177/api/auth/config/
```

The header `Sign in` button opens a compact sign-in panel. The panel lists
configured social providers and includes direct email/password sign-in and
account creation when storage is available. When no provider or password store
is configured and local dev auth is enabled, the header explicitly shows
`Dev sign in`, which creates only a local test session for development.

## Storage

- Production/preview: Upstash Redis REST is required. This avoids relying on a
  non-durable Vercel function filesystem.
- Local development: when Upstash variables are absent and the environment is
  not production-like, profiles are stored in `.data/profile-store.json`.
- `.data/` is git-ignored because it contains private birth data.
- If Google OAuth variables are missing in local development, the UI exposes an
  explicit `Dev sign in` button so profile save/load behavior can be verified
  without a Google OAuth client. This endpoint is disabled in production-like
  environments and can be disabled locally with `IYOGAU_ENABLE_DEV_AUTH=0`.

## API Surface

- `GET /api/auth/session/`
- `GET /api/auth/config/`
- `POST /api/auth/dev-login/` local development only
- `POST /api/auth/logout/`
- `GET /api/auth/google/start/?returnTo=/...`
- `GET /api/auth/google/callback/`
- `GET /api/auth/apple/start/?returnTo=/...`
- `GET|POST /api/auth/apple/callback/`
- `GET /api/auth/kakao/start/?returnTo=/...`
- `GET /api/auth/kakao/callback/`
- `GET /api/auth/naver/start/?returnTo=/...`
- `GET /api/auth/naver/callback/`
- `POST /api/auth/password/signup/`
- `POST /api/auth/password/login/`
- `GET /api/profiles/`
- `POST /api/profiles/`
- `PUT /api/profiles/`
- `DELETE /api/profiles/`

Profile writes require an authenticated session and same-origin request.

## Profile Shape

```json
{
  "profileType": "self",
  "displayName": "Ali",
  "birthDate": "1985-06-09",
  "birthTime": "15:30:30",
  "unknownTime": false,
  "birthplaceName": "Hamedan, Iran",
  "lat": 35.196944,
  "lon": 48.697778,
  "timezone": "+03:30",
  "notes": ""
}
```

The UI loads a user's `self` profile by default after sign-in. Selecting any
saved profile fills the existing natal form, which keeps chart, relocation,
immigration, soulmate, and soulmate-timing calculations on the same input path.
