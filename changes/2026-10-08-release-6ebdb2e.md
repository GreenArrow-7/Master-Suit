# Release 6ebdb2e

**What.** Production moved from c46624f to 6ebdb2e on 8 Oct, the same day.
Migrations 98, unchanged.

| PR | Change |
|---|---|
| #136 | Logging or changing an activity reaches only leads in the person's scope ([entry](2026-10-07-activity-lead-scope.md)). |
| #137 | The app's fonts are committed and served from the app, not fetched from Google at build time ([entry](2026-10-07-self-hosted-fonts.md)). |
| #141 | The release record of c46624f (docs). |

**Verified.** #136 and #137 were merged while their own CI was in its last
steps (typecheck, lint, unit, integration and server suites already green on
each merged with `main`); `main`'s CI on 6ebdb2e then passed in full (run
37756171269), the first run of the three together. Images built (run
37756358928) — the first build that fetched nothing from Google. Staging 98 of
98, the staging-first gate passed with production already at 98 (so the four
migrations of c46624f did land), the restore drill verified, backup
20261008T103418Z shipped off the server, deploy exit 0, smoke 18 of 18, and
production reported BUILD_COMMIT 6ebdb2e. Afterwards, `/login` serves the three
committed Latin font files from `/_next/static/media` and references no Google
font host.

**Left open.**
- Text outside Latin (Cyrillic, Greek, most Latin Extended) now falls back to
  the system font: #137 ships the Latin files only.
