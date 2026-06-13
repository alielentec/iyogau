# Trusted Branch Inventory

Target branch: `codex/q1-course-dashboard`

This branch is intended to be the clean working baseline for future development. It preserves existing code and separates live app files from reference artifacts without deleting project material.

## Production App Surface

- Public pages: `index.html`, `ko/index.html`, `zh/index.html`.
- Detailed astrology workspace: `natal-chart/index.html`.
- Legal/support pages: `privacy/`, `terms/`, `health-disclaimer/`, `accessibility/`.
- Shared production assets: `assets/css/`, `assets/js/`, `assets/data/`, `assets/img/`, `favicon.ico`, `rates.json`.
- Serverless API routes: `api/*.js`, `api/auth/**/*.js`, and shared runtime modules in `api/_lib/*.js`.
- Operational config: `vercel.json`, `.vercelignore`, `.github/workflows/`, `package.json`, `package-lock.json`.

## Preserved Reference Material

- `_archive/visual-evidence/` contains tracked screenshots and visual QA evidence.
- `_archive/local-only/` contains ignored local-only exports and scratch/reference material such as downloaded HTML bundles and Stitch files.
- `_archive/` is excluded from Vercel deploys so reference files do not become part of the public website.

## Review Findings Addressed

- Missing production scripts referenced by HTML were restored: `assets/js/public-astrology.js` and `assets/js/marriage-score.js`.
- Matching marriage-score API/runtime files were restored: `api/marriage-score.js` and `api/_lib/ashtakoota.js`.
- Public presets, i18n keys, and CSS were restored to match the current homepage and workspace markup.
- Shared auth/profile CORS now rejects localhost origins in production-like environments.
- Shared JSON request parsing now enforces content type and body-size limits even when Vercel supplies an already-parsed object body.
- Package metadata now declares ESM explicitly; the locale build script was converted accordingly.

## Validation Gates

- `node --test`
- `npm run build:locales`
- Browser QA on `/`, `/natal-chart/`, `/ko/`, and `/zh/`
- Confirm no missing JS/CSS 404s or console runtime exceptions.

## Rollback References

- Preserved WIP branch: `codex/q1-wip-auth-profiles-course-prereq`
- Clean starting branch before cleanup: `codex/q1-course-dashboard`
- Prior baseline tag: `pre-course-dashboard-baseline`
