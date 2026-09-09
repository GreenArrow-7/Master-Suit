# Secrets and Configuration

No secret values appear in this document. Variable names are listed because
they are declared in `.env*.example` and `src/lib/env.ts`.

## Configuration mechanism

- All configuration is read from `process.env` through one Zod schema,
  `envSchema` in `src/lib/env.ts` (~70 keys); the process fails fast on an
  invalid set (`safeParse` at module load). `resolveSecretFiles()` lets any
  key be supplied as `<KEY>_FILE` (path to a file, e.g. a Docker secret) —
  VERIFIED; TESTED `tests/security/secret-files`, `env-secrets`.
- `prisma.config.ts` loads `.env` for the Prisma CLI (never overriding an
  already-set variable). E2.
- `NODE_ENV` = how the code was built; `APP_ENV`
  (`development|test|demo|staging|production`) = which deployment this is.
  `PROCESS_ROLE` (`web|worker`). Production boot cross-checks `APP_ENV`
  against the database-name marker (`_test/_demo/_staging/_prod`). E1
  `startup-check.ts`; E4 `docs/ENVIRONMENTS.md`.
- Runtime-editable settings (lockout minutes, idle timeout, MFA requirement
  per workspace, HR parameters) live in `PlatformSetting` /
  `OrganizationSetting` and are read through `getNumericSetting()` /
  `src/lib/platform-settings.ts`. E1.

## Variable categories (names only)

| Category | Names |
|---|---|
| Core | `NODE_ENV`, `APP_ENV`, `PROCESS_ROLE`, `APP_URL`, `ALLOWED_ORIGINS`, `PORT`, `LOG_LEVEL`, `SLOW_QUERY_MS` |
| Bootstrap (first owner) | `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_OWNER_MFA_SECRET` |
| Data stores | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SHADOW_DATABASE_URL`, `DATABASE_REPLICA_URL`, `REDIS_URL`, `REDIS_PASSWORD`; compose-level `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` |
| Cryptographic | `FIELD_ENCRYPTION_KEY` (32-byte base64; envelope encryption of stored credentials/captures), `WEBHOOK_SIGNING_PEPPER`, `METRICS_TOKEN`, `FACE_SERVICE_TOKEN`, `FACE_SERVICE_TOKEN_PREVIOUS`, `FACE_SERVICE_TOKEN_ROTATED_AT` |
| Session / auth tuning | `SESSION_TTL_MINUTES`, `SERVICE_SESSION_TTL_MINUTES`, `SESSION_IDLE_TIMEOUT_MINUTES`, `MAX_FAILED_LOGINS`, `LOCKOUT_MINUTES`, `TRUSTED_PROXY_CIDRS`, `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `ATTENDANCE_CAPTURE_DIR` (legacy vault) |
| Providers | `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `WHATSAPP_PROVIDER`, `ANTIVIRUS_PROVIDER`, `CLAMAV_HOST`, `CLAMAV_PORT`, `ANTIVIRUS_TIMEOUT_MS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `META_APP_ID`, `META_APP_SECRET`, `RECORDING_URL_ALLOWED_HOSTS`, `LIVE_STREAM_WS_URL`, `LIVE_STREAM_PORT`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` |
| Face / attendance | `FACE_SERVICE_URL`, `FACE_TOKEN_MAX_AGE_DAYS`, `FACE_SERVICE_TIMEOUT_MS`, `FACE_MATCH_THRESHOLD`, `FACE_SAMPLES_REQUIRED`, `FACE_ENROLMENT_MIN_SPREAD`, `MAX_GPS_ACCURACY_M`, `MIN_PUNCH_INTERVAL_SECONDS`, `MAX_OFFLINE_SYNC_HOURS` |
| Limits & retention | `API_RATE_LIMIT_PER_MIN`, `EXPORT_MAX_ROWS`, `UPLOAD_MAX_MB`, `ATTENDANCE_CAPTURE_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `ATTENDANCE_PUNCH_RETENTION_DAYS`, `PLATFORM_AUDIT_RETENTION_DAYS` |
| Edge / monitoring (production example only) | `APP_DOMAIN`, `ACME_EMAIL`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`, `ALERT_PAGE_EMAIL_TO`, `ALERT_WEBHOOK_URL`, `PROMETHEUS_RETENTION` |
| Backup scripts | `BACKUP_PASSPHRASE`, `BACKUP_REQUIRE_ENCRYPTION`, `BACKUP_KEEP_MIN`, `BACKUP_MAX_AGE_HOURS`, `BACKUP_SHIP_*` (script-level, E2 `scripts/backup*.sh`) |
| CI / deploy (GitHub) | secrets `DEPLOY_HOST_<ENV>`, `DEPLOY_USER_<ENV>`, `DEPLOY_KEY_<ENV>`, `DEPLOY_KNOWN_HOSTS_<ENV>`; variable `DEPLOY_PATH_<ENV>`; `GITHUB_TOKEN` with `packages: write` for GHCR |
| Client-visible | `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_PRODUCT_SHORT_NAME`, `NEXT_PUBLIC_COMPANY_NAME` — display names only |

`scripts/generate-secrets.mjs` writes the three random 32-byte secrets into a
fresh `.env` on first setup. E2.

## Secret storage mechanism

- Development/CI: `.env` generated locally (git-ignored); CI generates its
  own `.env` in the workflow. E2.
- Deployed hosts: `.env.staging` / `.env.production` files in the checkout
  directory on the VM, passed to containers wholesale via
  `--env-file` (DOCUMENTED `docs/DEPLOY-AZURE.md` "Secrets in files rather
  than variables"; matched by `scripts/release.sh` `dc_for()`). `_FILE`
  indirection to Docker secrets is supported by code but is opt-in and not
  the documented default. E1/E2/E4.
- GitHub repository/environment secrets for deploy SSH; GHCR via
  `GITHUB_TOKEN`. E2.
- Stored credentials at rest (integration connections, some HR/attendance
  material) are envelope-encrypted per domain under `FIELD_ENCRYPTION_KEY`;
  `scripts/rotate-field-encryption-key.mjs` re-wraps; pre-encryption
  plaintext rows are tolerated by `decrypt()` (documented in
  `envelope.ts`). E1.
- No external secret manager (Vault, Azure Key Vault, AWS SM) referenced in
  the repository — negative evidence; production practice `UNKNOWN —
  requires runtime/infrastructure verification`.

## Client vs server boundary

Only the three `NEXT_PUBLIC_*` display names reach the browser
(`src/lib/branding.ts`); `env.ts` is server-only and imported by server
modules; `startup-check.ts` is loaded dynamically so the Edge/browser bundles
never parse it. VERIFIED. Session tokens are `httpOnly` cookies; nothing is
kept in web storage (see `docs/architecture/FRONTEND.md`).

## Exposure risks observable from structure (facts, not findings)

- Production secrets are environment variables inside containers
  (`docker inspect`, `/proc/<pid>/environ`) unless `_FILE` is adopted —
  stated by the project itself in `docs/DEPLOY-AZURE.md`.
- `.env`, `.env.test`, `.env.production`, `.env.staging` are git-ignored at
  both root and `apps/web`; `.env.bak*` patterns are ignored too. VERIFIED
  `git check-ignore`.
- pino redacts `password`, `passwordHash`, `token`, `tokenHash`, `secret`,
  `apiKey`, `otp`, `authorization` and `cookie` headers (wildcard depth 1);
  `SECRET_KEYS` are stripped from audit metadata; the kernel scrubs 5xx logs.
  Deeper nesting is not covered by the wildcard — a fact to keep in mind
  when logging objects. E1 `src/lib/logger.ts`, `audit.ts`, `handler.ts`.
- Backups are encrypted only when `BACKUP_PASSPHRASE` is set
  (`BACKUP_REQUIRE_ENCRYPTION=1` makes it mandatory). E2.
- Face-photo test assets were removed from git history on 2026-08-05
  (`docs/GIT-HISTORY-REMEDIATION.md`, E4). No other history remediation is
  recorded; a secret-scanning step is not present in CI (E2 negative).

## Evidence Sources

E1: `apps/web/src/lib/env.ts`, `src/lib/startup-check.ts`,
`src/lib/security/envelope.ts`, `src/lib/logger.ts`,
`src/lib/security/audit.ts`, `src/lib/branding.ts`, `src/lib/platform-settings.ts`.
E2: `apps/web/.env.example`, `.env.production.example`,
`.env.staging.example`, `.env.test.example`, root `.env.example`,
`prisma.config.ts`, `.gitignore` (root and `apps/web`),
`scripts/generate-secrets.mjs`, `scripts/rotate-*`, `scripts/backup*.sh`,
`.github/workflows/deploy.yml`, `build-images.yml`, `infra/docker-compose*.yml`.
E3: `apps/web/tests/security/secret-files.spec.ts`, `env-secrets.spec.ts`,
`secret-egress.spec.ts`, `tests/unit/env-example-parses.spec.ts`.
E4: `docs/DEPLOY-AZURE.md`, `docs/ENVIRONMENTS.md`,
`docs/GIT-HISTORY-REMEDIATION.md`.
Unverified: production secret handling on the host, key rotation history.
