# Google Sign-In and Saved Birth Profiles

This project now supports account-owned saved birth profiles for the natal
chart and astrocartography calculators.

## Runtime Model

- Google OAuth identifies the signed-in account.
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
```

If `GOOGLE_REDIRECT_URI` is omitted, the server derives it from the current
host. For local development this is usually:

```text
http://localhost:4177/api/auth/google/callback/
```

Add the same callback URL to the Google OAuth client.

## Storage

- Production/preview: Upstash Redis REST is required. This avoids relying on a
  non-durable Vercel function filesystem.
- Local development: when Upstash variables are absent and the environment is
  not production-like, profiles are stored in `.data/profile-store.json`.
- `.data/` is git-ignored because it contains private birth data.

## API Surface

- `GET /api/auth/session/`
- `POST /api/auth/logout/`
- `GET /api/auth/google/start/?returnTo=/...`
- `GET /api/auth/google/callback/`
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
