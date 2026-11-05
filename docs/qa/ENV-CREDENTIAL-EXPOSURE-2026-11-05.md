# Credential exposure: `apps/web/.env.qa-backup` on a pushed branch

**Scope of the exposure.** One blob, `1ba1e347da55e6d6c4eb15ed1a0b5f0d4eb4fcc4`,
added by one commit, `8114cf66`, reachable from exactly one ref.

| Question                              | Answer                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Commits that ever touched the path    | `8114cf66` only (`git log --all --remotes -- apps/web/.env.qa-backup`)                        |
| Refs whose tree contains it           | `origin/fix/ai-error-diagnosis` (PR #243, head `667ab9244f`) only                             |
| In `main`?                            | No. `git ls-tree -r origin/main` → 0 matches                                                  |
| In the released commit `1f98183b`?    | No. Same check → 0 matches                                                                    |
| In the previous release `8c3a41ec`?   | No                                                                                            |
| In `fix/ai-credential-policy` (#244)? | No — that branch's tree is clean; the blob never entered it                                   |
| In the release images?                | Impossible: `apps/web/.dockerignore` excludes `.env` and `.env.*`, so no build context had it |
| In CI artifacts?                      | No upload path in any workflow includes an environment file (only APKs, Playwright reports)   |
| GitHub secret-scanning alerts         | None — scanning is **disabled** on the repository (`/secret-scanning/alerts` → HTTP 404)      |

Wider than the one file: `git log origin/main --diff-filter=A --name-only`
over the **whole** history of `main` returns no `.env`, `.pem`, `.p12`, `.key`,
keystore or SSH key file that was ever added — only the two generator scripts
`apps/web/scripts/generate-secrets.mjs` and
`apps/mobile/scripts/set-ios-secrets.mjs`. So the exposure is this one blob on
this one branch, not a pattern.

Repository visibility is the remaining exposure surface: anyone who could read
the repository could read that branch while it existed.

## 1. What each value was, and where it is used

Values were compared by SHA-256 fingerprint; no value appears in this document
or in any report.

| Name                                     | What it is                                                                                                                         | Environments it is used in                 | Verdict                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `PLATFORM_OWNER_PASSWORD`                | **Byte-identical to `apps/web/.env.example`**                                                                                      | Local development only                     | Already public in the repository. Nothing was exposed that was not.      |
| `REDIS_PASSWORD`                         | **Byte-identical to `.env.example`, `.env.test.example`, and `infra/docker-compose.yml`** (`POSTGRES_PASSWORD`, `MINIO_ROOT_USER`) | Local development, CI service containers   | Already public. A one-word local default.                                |
| `S3_ACCESS_KEY_ID`                       | Same literal as above (`MINIO_ROOT_USER` in `infra/docker-compose.yml`)                                                            | Local development                          | Already public.                                                          |
| `S3_SECRET_ACCESS_KEY`                   | **Byte-identical to `MINIO_ROOT_PASSWORD` in `infra/docker-compose.yml`**                                                          | Local development                          | Already public.                                                          |
| `FIELD_ENCRYPTION_KEY`                   | The shared local-rig key: identical in **11** scratch worktrees under `C:\ymw\*`                                                   | Local scratch databases only (see §3)      | Not in the repository before. Production status: **owner must confirm**. |
| `WEBHOOK_SIGNING_PEPPER`                 | Same — identical across the same 11 rigs                                                                                           | Local scratch only                         | Same.                                                                    |
| `METRICS_TOKEN`                          | Same — identical across the same 11 rigs                                                                                           | Local scratch only                         | Same.                                                                    |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | `postgresql://…@127.0.0.1:5432/master_suite_fix`                                                                                   | A loopback scratch database on this laptop | Not reachable from anywhere else.                                        |
| `REDIS_URL`                              | `redis://…@127.0.0.1:6379/12`                                                                                                      | Loopback, database 12                      | Same.                                                                    |

Supporting facts from the file's own non-secret fields: `NODE_ENV=development`,
`APP_ENV=development`, `APP_URL=http://127.0.0.1:3300`, `EMAIL_PROVIDER=mock`,
`ALLOW_DEMO_SEED=yes`, `PLATFORM_OWNER_EMAIL=…@masterapp.local`. Every host is
`127.0.0.1`. The file is a development rig's environment, not a deployed one.

`docs/ENVIRONMENTS.md` states the policy this rests on: "Every environment
generates its own (`npm run secrets`) … Nothing is copied between
environments." If that policy held when the production environment was
provisioned, nothing in this blob is a production credential. **That is the one
thing this report cannot verify from here** — reading the production
environment is outside what this session is permitted to do.

### The one owner action that closes §1 and §2

Run on the production host. It prints fingerprints only — no secret reaches the
terminal, the scrollback, or this chat:

```bash
sudo sh -c 'set -a; . /opt/mastersuite/apps/web/.env.production; set +a; for k in FIELD_ENCRYPTION_KEY WEBHOOK_SIGNING_PEPPER METRICS_TOKEN REDIS_PASSWORD PLATFORM_OWNER_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do eval "v=\$$k"; printf "%-26s %s\n" "$k" "$(printf %s "$v" | sha256sum | cut -c1-12)"; done'
```

Compare against the exposed values' fingerprints:

| Name                      | Exposed value's fingerprint |
| ------------------------- | --------------------------- |
| `FIELD_ENCRYPTION_KEY`    | `f09b7fae5442`              |
| `WEBHOOK_SIGNING_PEPPER`  | `1a4005132f67`              |
| `METRICS_TOKEN`           | `05e271095fef`              |
| `REDIS_PASSWORD`          | `ad8b856e4b8e`              |
| `PLATFORM_OWNER_PASSWORD` | `bce7b8d826da`              |
| `S3_ACCESS_KEY_ID`        | `ad8b856e4b8e`              |
| `S3_SECRET_ACCESS_KEY`    | `ef529d5a63e6`              |

- **No fingerprint matches** → nothing production holds was exposed. Containment
  is complete once #243 is closed and its branch deleted; rotate nothing.
- **Any fingerprint matches** → that one credential is exposed in production and
  must be rotated. Do the same check on staging
  (`/opt/youhan-ios-staging/…/.env.staging`, same command) before deciding
  order.

## 2. Containment

| Credential                                                 | Action                                                                                                                   | Status                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `PLATFORM_OWNER_PASSWORD`, `REDIS_PASSWORD`, S3/MinIO pair | None available to take: these are the repository's own published defaults                                                | **Contained** — no rotation possible or meaningful                      |
| Local scratch Postgres/Redis on `127.0.0.1`                | None: not reachable off this machine                                                                                     | **Contained**                                                           |
| `METRICS_TOKEN`, `WEBHOOK_SIGNING_PEPPER`                  | Rotate **only if** the fingerprint check above matches production                                                        | **Pending the fingerprint check**                                       |
| Owner sessions                                             | The exposed owner password is the public example value for a local database; no deployed session was ever issued from it | **Contained** (re-confirm after the fingerprint check)                  |
| The blob itself                                            | Close #243 unmerged and delete `fix/ai-error-diagnosis`                                                                  | **Pending** — owner action; the tool restriction on `gh pr close` holds |

Access logs: no production access was attempted or verified from this session
(production reads are outside what it may do). If any fingerprint matches, the
logs worth reading are the metrics endpoint's (for `METRICS_TOKEN`) and the
owner sign-in audit for the owner account.

## 3. `FIELD_ENCRYPTION_KEY`, separately

**Not overwritten anywhere.** No rotation was performed, rehearsed or scheduled.

What the exposed key protected: the `master_suite_*` databases on `127.0.0.1`
belonging to the eleven local scratch rigs — synthetic workspaces, synthetic
leads, and the stand-in provider keys those rigs' tests store. No real customer
record has ever been in one: every rig database is created by
`prisma migrate deploy` plus the demo seed, which `docs/ENVIRONMENTS.md` and
`prisma/seed/index.ts` refuse to run against a production- or staging-named
database.

Rotating it would be the harmful move, not the safe one:
`src/lib/security/envelope.ts` says so in its own comment — "Rotating
`FIELD_ENCRYPTION_KEY` makes wrapped values undecryptable". Every integration
credential in the database is wrapped under a key derived from it by HKDF. So:

- If the production fingerprint **does not** match `f09b7fae5442` — the expected
  outcome under the stated provisioning policy — production's key was never
  exposed and must not be touched.
- If it **does** match, the rotation is a migration, not an edit: keep the old
  key readable, re-wrap every `IntegrationConnection.credentials` row and every
  other enveloped column under the new key, verify each integration still
  connects and that a restored backup still decrypts, and only then remove the
  old key. Provider keys wrapped under it (Gemini/OpenRouter workspace keys)
  would also have to be treated as exposed and re-issued by each workspace,
  because the wrapping key and the ciphertext would both have been public.

## 4. Repository hygiene

| Control                                  | State                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Ignore rule for backup environment files | **Live in `main`**: `**/.env.*` with `!**/.env.example` and `!**/.env.*.example`          |
| A check that catches this exact filename | **Added**: PR #247 — CI's first step after checkout fails on any tracked environment file |
| GitHub secret scanning / push protection | **Disabled** — owner action; this is the gap the CI step does not cover                   |
| Branch history retained                  | `origin/fix/ai-error-diagnosis` still carries the blob until #243 is closed and deleted   |

The CI step was verified both ways: it prints `no tracked .env files` on `main`
and names `apps/web/.env.qa-backup` with a non-zero exit when run over
`origin/fix/ai-error-diagnosis`.

Deleting the branch stops the file being served by the GitHub UI, but a blob
that was once pushed can remain in the repository's object store and stay
reachable by SHA. The fingerprint check is what decides whether that matters; a
repository-level garbage collection request to GitHub Support is the only way to
remove the object itself, and is worth filing only if a fingerprint matches.
