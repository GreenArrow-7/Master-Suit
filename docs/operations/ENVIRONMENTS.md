# Environments

Authoritative detail: `docs/ENVIRONMENTS.md` (2026-08-20) — current and
matched by code. This file is the Phase A summary with evidence labels; it
does not replace it.

| Environment | `APP_ENV` | Database name convention | Where | Demo seed | Status |
|---|---|---|---|---|---|
| Development | `development` | `leadflow` (historical) | laptop; Docker services on 127.0.0.1 (`infra/docker-compose.yml`, `npm run docker:up`) | allowed | VERIFIED (used in this workstream) |
| Test | `test` | `master_saas_test` | `npm test` locally and in CI (`ci.yml` services: `postgres:16`, Redis) | allowed | VERIFIED (E2) |
| Demo | `demo` | `master_saas_demo` | a production build with demo data (`scripts/start-local-prod.mjs`, `docs/DEMO.md`) | the use case | DOCUMENTED; live instance `UNKNOWN` |
| Staging | `staging` | `leadflow_staging` | second Compose project on the VM (`docker-compose.staging.yml`: Caddy `:8080`, ports offset 5433/9002/8026) | refused | E2 defined; live `UNKNOWN — requires runtime/infrastructure verification` |
| Production | `production` | `master_saas_prod` | Compose project on an Azure Ubuntu VM (`docker-compose.azure.yml`: Caddy 80/443) | refused | E2/E4 defined; live `UNKNOWN — requires runtime/infrastructure verification` |

## How configuration differs

- Each environment has its own `.env.<env>` file (git-ignored) built from
  `.env.example`, `.env.staging.example`, `.env.production.example`,
  `.env.test.example`. Production/staging examples add `APP_DOMAIN`,
  `ACME_EMAIL`, `ALERT_*`, `CLAMAV_*`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`,
  `PROMETHEUS_RETENTION`. E2.
- Compose composition per environment (`scripts/release.sh` `dc_for()`):
  staging = base + prod + staging overlay; production = base + prod + azure
  overlay (+ optional host overlay). E1.
- Enforcement in code (E1 `src/lib/startup-check.ts`, `prisma/seed`):
  `APP_ENV` must match the DB-name marker; seed refuses production/staging
  by declaration and by DB name and needs `ALLOW_DEMO_SEED=yes`; app and
  migration roles must differ; mock providers refused in production.
- Migrations flow staging → production; `check-staging-first.mjs` enforces
  it inside the production `migrate` profile. E1/E2.
- Windows launchers (`setup.ps1`, `start.ps1`) are development-only. E4.

## Evidence Sources

E1: `apps/web/src/lib/startup-check.ts`, `src/lib/env.ts`,
`prisma/seed/index.ts`, `scripts/release.sh`, `scripts/check-staging-first.mjs`.
E2: `apps/web/infra/docker-compose*.yml`, `.env*.example`,
`.github/workflows/ci.yml`, `scripts/start-local-prod.mjs`.
E4: `docs/ENVIRONMENTS.md`, `docs/DEPLOY-STAGING.md`, `docs/DEPLOY-AZURE.md`,
`docs/DEMO.md`, `docs/LOCAL-DEVELOPMENT.md`.
Unverified: existence and state of live demo, staging and production hosts.
