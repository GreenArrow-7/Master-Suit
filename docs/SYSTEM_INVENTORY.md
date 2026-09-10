# System Inventory — YOUHAN ONE

Phase A inventory of the repository as observed on 2026-09-07, branch
`dev/yourhan-next` at `f16ed67` with an uncommitted UI redesign in the working
tree (34 modified, 2 untracked files under `apps/web/src`, all presentation
layer). Every statement carries an evidence level (E1 code, E2 executable
config, E3 tests, E4 repository docs, E5 inference, E6 runtime-only). Where the
repository cannot answer, the entry says `UNKNOWN — requires verification`.

Naming: the repository is `Master-Suit`; the npm package is `master-app`; docs
call the product "Master SaaS"/"Master Suite"; the UI brand is YOUHAN ONE via
`NEXT_PUBLIC_PRODUCT_NAME` (`src/lib/branding.ts`); internal prefixes are
`lf_` / "leadflow" (session cookie, API keys, Docker user, pino `service`).
All refer to the same system (E1/E2/E4).

## Summary by area

| Area | Current observed state | Evidence |
|---|---|---|
| Frontend | Next.js 16.2.12 App Router, React 19.2.8, TypeScript 5.9.3 strict. 135 server-component pages, 111 `'use client'` files, no client state library, no server actions. Styling: `tokens.css` + `globals.css` (`.lf-*` classes in 245/274 tsx), Tailwind 4.3.3 imported and used in ~40 files. | E1 `apps/web/src/app`, E2 `package.json`, `next.config.ts` |
| Backend | Same Next.js process: 173 `route.ts` handlers (170 under `/api/v1`), an API kernel `route()` in `src/lib/api/handler.ts` used by 136 of them, service layer `src/services/*` (24 domains), `src/lib/*` platform libraries. | E1 |
| Database | PostgreSQL 16 via Prisma 7.10.0 (`@prisma/adapter-pg`). 201 models, 105 enums, 188 models carry `tenantId`, 65 migrations (+ `migration_lock.toml`). Row-level security forced on tenant tables; app connects as a `NOBYPASSRLS` role. | E1 `prisma/schema.prisma`, `prisma/migrations`, `src/lib/db.ts`, `src/lib/startup-check.ts` |
| Authentication | Cookie session `lf_session` (opaque token, SHA-256 hash in `PlatformSession`), argon2id passwords, TOTP MFA + recovery codes, refresh rotation with replay revocation, idle timeout, password reset (30-min single-use), invitations, API keys `lf_live_…`, service credentials `lf_svc_…`. | E1 `src/lib/auth/*`, `src/app/api/v1/auth/*`; E3 `tests/security/*` |
| Authorization | Platform roles (`USER`, `OWNER`, `SUPPORT`, `SECURITY_AUDITOR`, `AI_SERVICE`); workspace membership + role → permission map with scopes `NONE/OWN/TEAM/BRANCH/REGION/ORGANIZATION`; visibility resolver; field-level security; module entitlements (HRMS/SALES); RLS. | E1 `src/lib/security/*`; E3 `tests/permission`, `tests/tenant` |
| Integrations | Telephony (Exotel, Knowlarity, Plivo, Twilio), Meta lead forms/comments/messaging, WhatsApp Cloud API, Google Calendar, Google Speech / Gemini / OpenRouter (transcription + AI), FCM + APNs push, SMTP e-mail, ClamAV, face-recognition sidecar, S3/MinIO. | E1 `src/lib/integrations/*`, `src/lib/ai/*`, `src/lib/push/send.ts`, `src/lib/mailer.ts`, `src/lib/antivirus.ts`, `src/services/hr/face.ts` |
| Jobs / workers | BullMQ 5.81.2 on Redis; 9 queues (`automation`, `distribution`, `sla`, `campaign`, `webhook`, `maintenance`, `media`, `ai`, `notifications`); separate worker process (`PROCESS_ROLE=worker`); schedulers for retention (daily), maintenance (quarter-hourly), campaign sweep (60 s). | E1 `src/lib/queue.ts`, `src/workers/*` |
| Storage | S3-compatible object store (MinIO locally) via `@aws-sdk/client-s3`; bucket auto-created; attendance captures encrypted before upload; documents, recordings, exports. | E1 `src/lib/storage.ts`; E4 `docs/KNOWN-LIMITATIONS.md` |
| E-mail | nodemailer SMTP or `mock`; Mailpit locally; bodies never logged. | E1 `src/lib/mailer.ts` |
| Payments | No payment gateway integration found (0 references to Stripe/Razorpay/PayPal/etc.). Plans/subscriptions/billing events are internal records; commissions/payouts are computed, not paid. | E1 grep of `src` and schema — *negative evidence, see note* |
| AI/LLM | Google Gemini (`generativelanguage.googleapis.com`) or OpenRouter; per-workspace or shared key; usage metering and spend cap; prompt redaction; "ONE AI" assistant with tool calls and confirmation. | E1 `src/lib/ai/*`; E3 `tests/security/ai-redaction`, `assistant-guardrails`, `tests/permission/ai-usage` |
| Configuration | Zod-validated `process.env` (`src/lib/env.ts`, ~70 keys), `<KEY>_FILE` secret-file support, `.env.<env>` files (git-ignored), `APP_ENV` axis separate from `NODE_ENV`, boot cross-check against database name. | E1 `src/lib/env.ts`, `src/lib/startup-check.ts`; E2 `.env*.example` |
| Logging / metrics | pino 9 JSON to stdout with redaction; in-process metrics exposed at `/api/metrics` (Prometheus exposition, `METRICS_TOKEN`-gated, 404 otherwise); Prometheus v3.1.0 + Alertmanager v0.28.0 in Compose with 12 alert rules; health endpoints. No tracing, no log shipping, no exception tracker. | E1 `src/lib/logger.ts`, `src/lib/metrics.ts`, `src/app/api/metrics`, `src/app/api/health`; E2 `infra/docker-compose.yml`, `infra/prometheus-alerts.yml` |
| Audit | `AuditLog` (tenant-scoped, 30 event kinds, diffs, request id, ip, ua) and `PlatformAuditEvent`; `audit()` called from 141 sites; retention by env. | E1 `prisma/schema.prisma`, `src/lib/security/audit.ts` |
| Testing | Vitest 4.1.10: `tests/{unit,hr,sales,security,tenant,permission,integration}` (152 spec files) + `tests/server` (2, own config); Playwright 1.62 e2e (14 specs, chromium, 1 worker, 0 retries). Python: `apps/face/test_tokens.py`. | E2 `vitest.config.mts`, `vitest.server.mts`, `playwright.config.ts`; E3 the suites |
| CI/CD | GitHub Actions: `ci.yml` (push to `main`, PRs; one `verify` job on Node 24 with Postgres 16 + Redis, ~19 steps incl. migrate, drift, RLS, seed, typecheck, lint, format, unit, server, e2e on push/`main` PRs, build, `npm audit`); `deploy.yml` (manual, staging/production, deploy/rollback, refuses commits whose `verify` check is not green, `environment:` protection, SSH → `release.sh`); `build-images.yml` (manual, exact SHA → GHCR `web` and `worker` images). | E2 `.github/workflows/*` |
| Containers | Multi-stage `infra/Dockerfile` (node:22-alpine; `deps`, `development`, `build`, `production`, worker target), standalone Next output, non-root user. Compose base (postgres, redis, minio, mailpit, clamav, prometheus, alertmanager) + overlays `prod`, `azure` (caddy 80/443, migrate, face), `staging` (second project), `small-host`, `pgbouncer` (opt-in), `dev`. | E2 `infra/*` |
| Deployment | Single Ubuntu VM (Azure), Docker Compose, Caddy TLS, `scripts/release.sh` tagging images by commit with current/previous state and staging-first promotion. Host provisioning via `infra/cloud-init.yaml` + `infra/provision-host.sh`. | E2 `infra/*`, `scripts/release.sh`; E4 `docs/DEPLOY-AZURE.md` |
| Backup / restore | `scripts/backup.sh` (pg_dump + bucket mirror + manifest, optional GPG), `backup-ship.sh`, `backup-status.sh`, `restore-verify.sh`, `install-backup-schedule.sh` + systemd timers (02:30 nightly backup, 09:00 freshness, weekly restore-verify). Database half exercised off-deployment on 2026-08-20; object half not exercised; production status unknown. | E2 scripts + `infra/systemd`; E4 `docs/BACKUP-RECOVERY.md`; E6 production |
| Secrets | Environment variables (or `_FILE`) on the host; GitHub repository secrets for deploy; `FIELD_ENCRYPTION_KEY` envelope encryption for stored credentials; rotation scripts for field key and face token. No secret manager identified. | E1 `src/lib/env.ts`, `src/lib/security/envelope.ts`; E2 `deploy.yml`; E4 `docs/DEPLOY-AZURE.md` |

Negative-evidence note: "not found" statements above come from repository-wide
searches (`grep -r`) of `src`, `prisma` and `infra`. They do not prove absence
outside the repository.

## Components

### Web application (`apps/web`)

- Name: `master-app` (YOUHAN ONE web)
- Purpose: customer-facing SaaS — Platform Owner console, tenant workspaces
  with Sales CRM (leads, opportunities, calls, campaigns, real-estate
  inventory, commissions…) and HRMS (employees, attendance with face check-in,
  leave, payroll, performance, recruiting…). E1 module list: `src/services/*`,
  `src/lib/nav/workspaceNav.ts`.
- Location: `apps/web`
- Technology: Next.js 16.2.12 (Turbopack), React 19.2.8, TypeScript 5.9.3,
  Prisma 7.10.0, Zod 3.25.76, pino 9.14.0, BullMQ 5.81.2, ioredis 5.11.1,
  `@node-rs/argon2` 2.0.2, `@aws-sdk/client-s3`, nodemailer 9, `ws` 8,
  Tailwind 4.3.3, recharts, leaflet. Node `>=22` (`engines`); CI Node 24;
  container node:22-alpine; local Node v24.18.0. npm lockfile v3. (E2)
- Entry points: Next server (`src/app`, `src/proxy.ts` middleware,
  `src/instrumentation.ts` → `assertProductionConfiguration()`), worker
  `src/workers/index.ts` (`npm run worker`), live-stream WebSocket server
  `src/workers/liveStream.ts` (started by the worker when configured). (E1)
- Dependencies: PostgreSQL, Redis, S3-compatible store; optional SMTP, ClamAV,
  face service, provider APIs. (E1 `src/lib/env.ts`)
- Data handled: tenant business data (leads, contacts, accounts, deals,
  calls/recordings/transcripts, campaigns, documents), HR data (employee
  profiles, compensation, payslips, leave, attendance, biometric consent and
  face templates, encrypted attendance captures), platform identities,
  sessions, audit trails, integration credentials (envelope-encrypted). (E1
  schema)
- External dependencies: see `docs/architecture/INTEGRATIONS.md`.
- Authentication requirement: all `/api/v1` routes except `public/*`,
  `webhooks/*`, `auth/*` login-class routes and the `dev/outbox` (non-prod)
  route resolve a session or API key through the kernel. (E1
  `src/lib/api/handler.ts`; per-route review of the 38 raw handlers is a gap —
  see `docs/security/SECURITY_OBSERVATIONS.md` SEC-OBS-002)
- Authorization requirement: per-route `module`/`action` + scope; platform
  console routes require privileged platform roles with MFA. (E1)
- Security sensitivity: High (multi-tenant PII, biometrics, payroll,
  credentials).
- Production criticality: Critical (the product).
- Tests available: 152 Vitest spec files + 2 server + 14 Playwright. (E2/E3)
- Observability: pino, `/api/metrics`, `/api/health`, `/api/health/live`,
  Prometheus rules. (E1/E2)
- Known documentation: `apps/web/README.md`, `apps/web/SETUP.md`,
  `apps/web/docs/00…08`, `docs/*.md` (80 files). (E4)
- Known concerns: `apps/web/docs/00-ARCHITECTURE.md` §2 describes a
  route→service→repository layering with "route handlers never touch prisma";
  in code 136/173 route files import `@/lib/db` directly and no
  `src/repositories` exists. §5 lists queues `messaging`, `import`, `export`
  that do not exist in `src/lib/queue.ts`. Implementation wins; the doc is
  partially stale (**EVC-001**, **EVC-002** in `docs/EVIDENCE_CONFLICTS.md`).
- Unknowns: none at the repository level; runtime topology is E6.

### Face-recognition service (`apps/face`)

- Purpose: embeds/matches faces for HR attendance check-in. (E1 `main.py`,
  `face_engine.py`; E4 README)
- Technology: Python 3.12, FastAPI 0.115.6, uvicorn, onnxruntime 1.27,
  opencv-headless, numpy; InsightFace `buffalo_l` ONNX models downloaded at
  container start (`download_models.py`). (E2 `requirements.txt`,
  `Dockerfile`)
- Entry point: `uvicorn main:app --port 8000`; endpoints include `/health`
  and `/analyse` (called from `src/services/hr/face.ts`). (E1)
- Authentication: shared bearer token `FACE_SERVICE_TOKEN` with a
  `FACE_SERVICE_TOKEN_PREVIOUS` rotation window, constant-time comparison
  (`tokens.py`); `docs_url`/`redoc_url` disabled. (E1)
- Authorization: none beyond the token (single trusted caller). (E1)
- Data handled: face images/embeddings in transit; model files. Storage of
  templates is on the web side (`HrFaceTemplate`). (E1)
- Security sensitivity: High (biometric).
- Production criticality: High for attendance; the web app degrades with an
  explicit "engine unavailable" error when unreachable. (E1 `face.ts`)
- Tests: `apps/face/test_tokens.py` (token rules). (E3)
- Observability: `FaceServiceTokenStale` alert from web metrics; service logs
  to stdout. (E2)
- Known concerns: no Python dependency audit in CI (E2 `ci.yml` has only
  `npm audit`); `docs/DEPENDENCY-SECURITY.md` records this as residual risk.
- Unknowns: whether the production deployment runs this container
  (`docker-compose.azure.yml` defines `face`) — `UNKNOWN — requires
  runtime/infrastructure verification`.

### Mobile shell (`apps/mobile`)

- Purpose: Android/iOS store builds that load the web app in a WebView;
  native push registration via `@capacitor/push-notifications`. (E1
  `capacitor.config.js`, `www/index.html`; E4 README)
- Technology: Capacitor (`@capacitor/core`, `android`, `ios`,
  `push-notifications`), server URL from `MOBILE_SERVER_URL` at sync time;
  `cleartext: false`. (E2)
- Authentication: the web app's cookie session inside the WebView; the web
  side registers device tokens (`DeviceToken` model, `devices` routes). (E1)
- Security sensitivity: Medium (session in WebView, push tokens).
- Production criticality: Low–Medium. Whether store builds are published —
  `UNKNOWN — requires verification`.
- Tests: none identified in the repository.
- Known concerns: an earlier assessment in this workstream recommended a
  dedicated mobile token model before a native (non-WebView) client; not
  started, not approved.

### Windows launchers and root scripts

- `setup.ps1`, `start.ps1`, `stop.ps1`, `start-demo.cmd`: local provisioning
  and one-app launch on Windows (`README.md`). Not used in CI or production
  (E2/E4). `apps/web/scripts/*.mjs|sh` are the operator tools — see
  `docs/operations/DEPLOYMENT.md` and `docs/operations/BACKUP_RESTORE.md`.

### Infrastructure definitions (`apps/web/infra`, `infrastructure/`)

- Compose files, `Dockerfile`, `Caddyfile{,.staging,.intranet}`,
  `cloud-init.yaml`, `provision-host.sh`, `pgbouncer.ini`,
  `prometheus*.yml`, `alertmanager-entrypoint.sh`, `systemd/*` (6 units).
  `infrastructure/postgres/{roles,rls}.sql` are role/policy templates;
  `docs/RLS-ROLLOUT.md` (2026-08-05) says they are not auto-applied by the
  local launcher, while the migrations now carry `FORCE ROW LEVEL SECURITY`
  (26 migration files) — the templates are `Legacy / potentially inactive`
  (E1/E2 vs E4, recorded).

### Documentation set

- Root `docs/` (80 files incl. `evidence/`, `uat/`, two ADR folders `adr/`
  and `ADRs/`), `security/` (3, dated 2026-08-08), `testing/` (1),
  `apps/web/docs/` (10), `apps/web/README.md`, `apps/web/SETUP.md`,
  `apps/*/README.md`. Freshness ranges from 2026-08-03 to 2026-08-26; several
  short files from 2026-08-05 (`docs/DEPLOYMENT.md`, `THREAT-MODEL.md`,
  `AUTHENTICATION-DESIGN.md`, `TENANT-ISOLATION.md`, `RLS-ROLLOUT.md`,
  `SECURITY-REMEDIATION.md`) predate later work and are superseded in
  substance by `docs/DEPLOY-AZURE.md`, `docs/ENVIRONMENTS.md` and the code.
  `docs/OPERATIONAL-READINESS.md` (2026-08-26) states "NOT VERIFIED" for every
  item and still refers to "11 migrations" and asks for a drift CI step that
  `ci.yml` now has. `apps/web/docs/08-DESIGN-SYSTEM.md` ("Burgundy") and
  `docs/PREMIUM-UI-DESIGN-SYSTEM.md` describe the pre-redesign UI; the
  working tree carries a neutral/indigo redesign. (E4; conflicts EVC-003,
  EVC-004, EVC-005, EVC-007, EVC-011 — see `docs/EVIDENCE_CONFLICTS.md`)

## Route surface (E1)

`/api/v1` route files by first segment: calls 16 · workspaces 14 · projects 10
· campaigns 10 · auth 10 · platform 9 · listings 7 · events 6 · leads 5 ·
integrations 5 · webhooks 4 · targets 4 · social-leads 4 · site-visits 3 ·
requirements 3 · public 3 · practice 3 · documents 3 · tasks, sales-playbooks,
opportunities, objections, landing-pages, forms, follow-ups, devices,
conversations, contacts, commissions, automations, admin, activities,
accounts 2 each · whatsapp, testimonials, scorecards, reports, referrals,
posts, payouts, owners, notifications, leadership, geocode, exports, dialer,
dev, contests, commission-slabs, coaching, client-profiles, bookings,
assistant, allocation 1 each. Plus `/api/health`, `/api/health/live`,
`/api/metrics`. Public pages: `/f/[workspaceSlug]/[formKey]` (lead form),
`/l/[workspaceSlug]/[pageSlug]` (landing page), `/rsvp/[token]`,
`/testimonial/[token]`.

## Evidence Sources

E1:
- `apps/web/src/app/**` (route handlers, pages), `src/proxy.ts`,
  `src/instrumentation.ts`
- `apps/web/src/lib/**` (api, auth, security, env, db, queue, logger,
  metrics, storage, mailer, antivirus, integrations, ai, push)
- `apps/web/src/services/**`, `apps/web/src/workers/**`
- `apps/web/prisma/schema.prisma`, `prisma/migrations/`
- `apps/face/main.py`, `tokens.py`; `apps/mobile/capacitor.config.js`

E2:
- `apps/web/package.json`, `package-lock.json`, `tsconfig.json`,
  `next.config.ts`, `eslint.config.mjs`, `vitest*.mts`,
  `playwright.config.ts`, `.prettierrc.json`, `.prettierignore`
- `apps/web/infra/**`, `.github/workflows/*.yml`, `apps/web/scripts/*`
- `apps/web/.env*.example`, `.gitignore` files

E3:
- `apps/web/tests/**`, `apps/face/test_tokens.py`

E4:
- `README.md`, `apps/web/README.md`, `apps/web/SETUP.md`,
  `apps/web/docs/*.md`, `docs/*.md`, `security/*.md`, `testing/*.md`

Unverified (E6):
- Production topology, deployed commit, live env values, whether `face`,
  `clamav`, `pgbouncer` run in production, backup success, alert delivery,
  branch protection rules, GitHub environment reviewers, store-published
  mobile builds.
