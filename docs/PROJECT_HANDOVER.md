# YOUHAN ONE — project handover

Written 30 Oct 2026 against `main` at `4861a72f`. Everything here was read from
this checkout or from GitHub; anything that could not be verified is marked
**[unverified]**. No credential values appear in this file — only variable names.

> **Read `changes/PROJECT.md` first for architecture.** It is the project's
> living map (446 lines: every module, every rule, where code lives, how to test
> and release) and it is maintained with each change. This file does not repeat
> it. This file is the handover: what exists, where work stopped, what is next,
> and how to run it on a new machine.

---

## 1. Project overview

| | |
|---|---|
| **Product** | YOUHAN ONE — multi-tenant SaaS for UAE real-estate brokerages and sales teams |
| **Repository** | `GreenArrow-7/Master-Suit` (GitHub, private) |
| **Live site** | `https://one.youhan.in` |
| **Main branch** | `main` at `4861a72f` (30 Oct 2026) |
| **Production** | `4861a72f`, 126 migrations, released 19 Oct 2026; rollback target `532f9595` |
| **Phone apps** | Android `com.youhan.one1` (Play closed testing), iOS `com.youhan.one` (App Store, 1.2.0 awaiting review) |

### What it does

One web application sells several **product modules**; a workspace (a company)
is entitled to the ones its plan includes (`apps/web/src/lib/modules/catalogue.ts`):

| Module | Folder under `src/app/(workspace)/[workspaceSlug]/` | Covers |
|---|---|---|
| **Sales** | `sales/` | Leads, contacts, accounts, opportunities, tasks, follow-ups, calls with AI coaching, campaigns, forms, landing pages, dashboards, projects, listings, bookings, collections, commissions |
| **HRMS** | `people/` | Employees, roles, departments, face check-in, attendance, shifts, leave, overtime, payroll, payslips, WPS, recruitment, performance |
| **Real Estate** | `realty/` | The Sales property screens as a brokerage works them, plus properties, allocation, events with QR passes, lead recycling |
| **Lead Eagle** | `lead-eagle/` | The lead-management product: Real Estate's lead screens without the money and marketing ones. Sold as its own application, with its own sign-in door |

Outside the modules: `check-in` and `attendance` (every workspace), `admin/`,
`profile/`, and the platform console at `src/app/(platform)/platform`.

### Stack

- **Web:** Next.js **16.4.2** (App Router, Turbopack), React 19, TypeScript, Tailwind 4
- **Data:** Prisma **7** on PostgreSQL with forced row-level security; Redis + BullMQ for queues
- **Validation:** zod. **Tests:** vitest, Playwright. **Logging:** pino
- **Node:** `>=22` (`engines`); CI runs Node 24
- **Face service:** Python (`apps/face`), InsightFace `buffalo_l`
- **Phone apps:** Capacitor web-view shells (`apps/mobile`)
- **Storage:** S3-compatible (MinIO locally, object storage in production)
- **Email:** SMTP via nodemailer, with a `mock` provider for development

---

## 2. Project architecture

### Folder structure (repository root)

```
CLAUDE.md                  Entry point for AI assistants — points at changes/
README.md                  STALE: describes an older "Master SaaS" layout (see §5)
apps/
  web/                     The application (everything below is under apps/web)
    src/
      app/                 Next.js App Router
        (auth)/            Sign-in, password reset, sign-up
        (workspace)/[workspaceSlug]/   The tenant application (4 modules + admin, profile)
        (platform)/platform/           Platform owner console (workspaces, plans, AI Control Center)
        (monitoring)/      Monitoring grants
        api/               256 route.ts files: api/v1/** (web+API key), api/mobile/** (phone bearer)
        c/ f/ l/ li/ p/ s/ Public short links: forms, landing pages, shares, portals
      lib/                 Cross-cutting: db.ts (tenant guard), api/handler.ts (route()),
                           security/ (rbac, record-scope, audit), auth/, queue.ts, env.ts,
                           csv.ts, xlsx.ts, offline.ts, push/, modules/, nav/
      services/            Business logic by domain: leads, hr, distribution, sla,
                           notifications, integrations, leadership, money, ai, targets…
      components/          React components
      workers/             BullMQ workers: index.ts starts one per queue; jobs.ts is the JOBS table
    prisma/
      schema.prisma        231 models, 130 enums, ~9,280 lines
      migrations/          126 migrations (timestamped folders)
      seed/                Demo data
    tests/                 395 spec files: unit, integration, e2e, security, permission,
                           tenant, hr, sales, identity, platform, ai, perf, server, diagnostic
    scripts/               ~60 operational scripts (release.sh, backup*.sh, check-*.mjs, verify.mjs)
    infra/                 Docker Compose files, Dockerfile, Caddy, Prometheus, systemd units
    public/openapi.json    Generated; tests/unit/openapi.spec.ts gates it
  mobile/                  Capacitor shells (android/, ios/, www/) + CallWatch native plugin
  face/                    Python face-recognition service (FastAPI-style, Dockerfile)
changes/                   THE WORKING MEMORY — PROJECT.md + README.md index + 118 entries
docs/                      ~40 reference documents + adr/, product/, release/, uat/
security/                  Security notes
validation-evidence/       Baseline validation reports (Sept 2026)
setup.ps1 start.ps1 stop.ps1 start-demo.cmd   Windows helper scripts
```

### How the pieces talk

```
Browser / phone web view
        │  cookie session (lf_session)
        ▼
Next.js app (apps/web)  ──────────►  PostgreSQL (Prisma 7, RLS by app.tenant_id)
  proxy.ts (middleware)             ──►  Redis (sessions aux, rate limits, BullMQ)
  route() in lib/api/handler.ts     ──►  S3-compatible object storage
        │                           ──►  apps/face (HTTP, token-authenticated)
        │  enqueue
        ▼
BullMQ workers (src/workers)  — 11 queues:
  ai · media · webhook · notifications · sla · distribution ·
  automation · campaign · maintenance · reminders · calendar
        │
        ├──► FCM / APNs (push)
        ├──► SMTP (email)
        ├──► Twilio etc. (telephony, SMS)
        ├──► Google Calendar / Microsoft Graph
        └──► WhatsApp Business

Phone apps (apps/mobile) = web view of the same site
  + native CallWatch plugin (call detection)
  + push registration
Standalone Lead Eagle Expo app → /api/mobile/** (bearer device sessions)
```

### Database

- **231 models**, **126 migrations**. Multi-tenant by `tenantId` on nearly every model.
- **Row-level security is forced** in Postgres; `apps/web/scripts/check-rls.mjs`
  verifies every tenant table (202 tables at last run).
- `src/lib/db.ts` **refuses any query that does not name its tenant**. Cross-tenant
  reads go through `withPlatformTx` and nowhere else.
- Full model-by-model detail is in `apps/web/prisma/schema.prisma`; read it only
  for the models a task touches.

> The complete architecture — entitlement, permissions and scopes, audit, exports,
> offline outbox, notifications, lead scoring, attendance rules — is in
> **`changes/PROJECT.md` §"Rules every change follows"**. Do not re-derive it.

---

## 3. Features developed

The authoritative, per-requirement status is the tracker spreadsheet (§9.4).
Summary as of 30 Oct 2026: **288 of 298 audited requirements complete (96.6 %)**,
287 of them live in production.

### Complete and live

| Area | Highlights |
|---|---|
| **Auth & tenancy** | Sessions, MFA/TOTP + recovery codes, lockout and throttling, temporary passwords, suspended/deactivated accounts, platform service identities, API keys |
| **Users, roles, permissions** | Database-held roles, 5 Lead Eagle starter roles, scopes OWN<TEAM<BRANCH<REGION<ORGANIZATION, record-scope 404s, field-level masking |
| **Leads** | Grid + board, saved views, import with dry run, merge, close-out, custom fields, stages, sources with scoring and decay, cold data, allocation, duplicate detection |
| **Assignment & automation** | Distribution rules (weights, turns, conditions, language), availability and quotas, SLA first-contact escalation, automation rules (create task, notify, tag, assign, email/WhatsApp template, signed webhook) |
| **Follow-ups, tasks, calendar** | Due/overdue on the workspace clock, kinds, recurring tasks, reminders 10–15 min ahead, Google Calendar sync, Microsoft 365 (Outlook) sync |
| **Telephony & calls** | Provider-bridged calls, recordings into own storage, one-step call log, live AI coaching, call analysis and audits, Call Performance report, CallWatch handset detection (web half live) |
| **Communication** | WhatsApp templates, email templates, public share links, **SMS from the lead** (Twilio) |
| **Attendance** | Face check-in/out with liveness and geofence, shifts, roster, work locations, holidays, face activity, daily target gate |
| **HRMS** | Employees, departments, leave, overtime, payroll runs, payslips, WPS, recruitment, performance, documents, compliance |
| **Reports** | ~15 reports with filters, CSV **and Excel** export, scheduled report emails |
| **Inventory** | Projects, unit plans, units by floor, payment plans, listings, Trakheesi permits, media uploads |
| **Money** | Bookings, collections, commissions, proposals, portals |
| **AI layer** | Gemini provider with fallback, AI Control Center, budgets, guardrails, evaluation |
| **Platform console** | Workspaces, plans, subscriptions, entitlements, self-serve sign-up setting, monitoring grants, audit |
| **Mobile API** | `/api/mobile/**` — device sessions (90-day bearer), leads, calls, follow-ups, attendance with face, native push registration |
| **Non-functional** | RLS, audit log, retention windows, backups with off-site copy and restore drill, observability (Prometheus + alerts), offline outbox, Arabic RTL |

### Built but not yet on phones

- **M9-09 CallWatch** — the web half is live; the native plugin reaches phones
  only with app **1.3.0** (PR #224, draft).

### Built, waiting on an owner credential or action (10 items)

| ID | Module | Needs |
|---|---|---|
| M17-02, M20-08, PROD-14 | Notifications, Mobile | Firebase `google-services.json` + FCM service account; Apple push capability, profile, APNs `.p8` |
| OWN-01, M15-01, M20-01 | Auth, Attendance, Mobile | A device pass: sign in, place a call, face check-in/out on one Android and one iPhone |
| OWN-06, M9-07 | Telephony | A Twilio account on staging and one real call round trip with a recording |
| PLAN-08b | Assignment | Set "Self-serve sign-up (trial days)" to 14 in the platform console |
| M20-02 | Mobile | Build and submit the standalone Lead Eagle Expo app through EAS |

### Not built, decided against (recorded, reopenable)

Handset call-log reading beyond app-placed calls (Play policy risk), a native
rewrite of the phone app, and bearer device sessions beyond the mobile API — all
superseded by what shipped. See the tracker notes and `changes/PROJECT.md`.

---

## 4. Technical implementation

### The five contracts every change obeys

1. **Tenant guard** — `src/lib/db.ts`. Every query names its tenant.
   `update`/`findFirstOrThrow` by id alone is refused; use
   `updateMany({ where: { tenantId, id } })`. Inside `withTx`, query only through `tx`.
2. **`route()`** — `src/lib/api/handler.ts`. Every API route declares
   `{ module, action, productModule, params, query, body, rateLimit, auditEvent }`.
   `route.ts` files may export **only** HTTP handlers. `route({ mobile: true })`
   takes a device bearer and nothing else.
3. **Permissions and scope** — `src/lib/security/rbac.ts` (`atLeast`) and
   `record-scope.ts` (`assertRecordInScope`; out of scope answers **404**, never 403).
4. **Audit** — every POST/PATCH/PUT/DELETE either declares `auditEvent`, calls
   `audit(ctx, …)`, or is listed in `tests/unit/mutation-audit.spec.ts` with a reason.
   **This test fails the build otherwise.**
5. **Idempotency** — `Idempotency-Key` is honoured by `route()` and, for the call
   log, claimed inside the operation's own transaction
   (`claimKey`/`completeClaim`, `src/services/idempotency.ts`).

### Notable subsystems

| Subsystem | Entry point |
|---|---|
| Session and auth | `src/lib/auth/session.ts`, `login.ts`; device sessions on `PlatformSession.kind = MOBILE` |
| Entitlement | `src/lib/workspace-page.ts` (`resolveWorkspacePage`), `src/lib/modules/catalogue.ts` |
| Queues | `src/lib/queue.ts`, `src/workers/jobs.ts` (the `JOBS` table is read by CI's observability gate — keep it a literal) |
| Offline outbox | `src/lib/offline.ts` (`sendOrQueue`, `drain`), `OfflineBanner` |
| Exports | `src/lib/csv.ts` (BOM, formula blunting) and `src/lib/xlsx.ts` (own OOXML writer, no dependency) |
| Push | `src/lib/push/send.ts` — FCM and APNs direct, per-token APNs topic |
| Face | `src/services/hr/` + `apps/face` over HTTP with a rotating token |
| Calendar sync | `src/services/integrations/calendarSync.ts` (Google + Microsoft, `calendar` queue) |
| Lead scoring | `src/services/leads/scoring.ts` |
| SLA | `src/services/sla/checkLeadFirstContact.ts` |

### Third-party integrations

Gemini (AI) · Twilio and other telephony vendors · WhatsApp Business ·
Google Calendar · Microsoft Graph · Meta (social leads) · Google Ads lead forms ·
Property Finder / Bayut / Dubizzle (partner-gated) · FCM · APNs · S3-compatible
storage · SMTP · ClamAV (optional antivirus).

---

## 5. Development progress

### Completed

See §3. The 11 Oct 2026 requirements audit of 298 items is **96.6 % complete**,
and every complete item except M9-09's native half is live in production.

### Currently open

- **PR #224** (`build/mobile-1.3.0-push`) — **draft**. Phone app 1.3.0: iOS push
  entitlement, `MARKETING_VERSION` 1.3.0, Android `versionCode` 12 / `versionName`
  1.3.0. **Do not merge** until the Apple push profile and Firebase file exist.
  It is kept merged up with `main`.
- **iOS 1.2.0** — submitted 15 Oct, status *Waiting for Review*. An outdated
  Apple Developer Program License Agreement was blocking it; the owner accepted
  the new agreement on 27 Oct. Awaiting Apple.
- **Standalone Lead Eagle Expo app** — complete on branch `feat/youhan-one-api`
  in a **separate local repository** (§7.5). Never built through EAS.

### Known issues and limitations

| Issue | Detail |
|---|---|
| `changes/PROJECT.md` header is stale | It says "Updated 2026-10-11 … f9c0c1a … 101 migrations". The body is current; only the header line is wrong. Actual: `4861a72f`, 126 migrations |
| `changes/PROJECT.md` has duplicated paragraphs | Merge resolution kept both sides: "Attendance is not HR", "Real AI and telephony", "Store submissions" and a Reports sentence each appear twice. Harmless, worth tidying |
| Root `README.md` is stale | Describes an older "Master SaaS" layout and a `C:\Users\admin\Downloads\Master App\master-saas` path that no longer exists |
| Android CallWatch limitation | Android gives ordinary apps no answer signal for outgoing calls, so talk time is "time off hook"; ≥45 s counts as Connected and the agent can correct it |
| iOS CallWatch unverified | The Swift plugin has never been compiled — no macOS machine. **[unverified]** |
| Database pool | The pg adapter ignores `connection_limit` in the URL; every process holds 10 connections. `max` on `PrismaPg` is an operations decision |
| `docs/product/DECISIONS-REQUIRED.md` | 17 product questions with no recorded answer, last touched 12 Sep |
| E2E flakes (fixed, watch for regressions) | Socket reuse (#225), `next dev` route discovery (#226), body-never-arrived (#235) |

---

## 6. Important technical decisions

**Do not change these without a stated reason.**

1. **One record, several screens.** Real Estate and Lead Eagle pages are
   one-line re-exports of Sales pages. **Never add a parallel model.**
   Guarded by `tests/unit/realty-routes.spec.ts` and `lead-eagle-routes.spec.ts`.
2. **Out of scope answers 404**, never 403 — a 403 would confirm the record exists.
3. **Row-level security is forced**, not advisory, and the tenant guard is a
   runtime refusal, not a lint rule.
4. **No new dependency where a few lines do.** The XLSX writer
   (`src/lib/xlsx.ts`) is hand-written OOXML for exactly this reason.
5. **Exports are CSV with a BOM, or XLSX on the same route** — both under the
   same permission and the same `EXPORT_REQUESTED` audit row.
6. **The phone apps are web views.** A web change never needs a store build; only
   a native change (the CallWatch plugin, push) does.
7. **Own branding only.** Never copy a competitor's name, logo, colours or layout.
8. **`changes/` is mandatory.** Every change ships its entry in the same PR, plus
   a row at the top of `changes/README.md`, and corrects `changes/PROJECT.md`
   where it becomes wrong. *A change without its entry is not finished.*
9. **Merge only after CI passes on the exact commit being merged.** If `main`
   moved, merge it in and wait again.
10. **Next.js is pinned** to an exact version (`16.4.2`), not a range — 16.0–16.3
    had a dev-server route-discovery race (vercel/next.js#97897).
11. **Commit trailer:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
    **PR body ends with:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

### Coding conventions

- Prettier and ESLint gate `apps/web` in CI (`npm run format:check`, `npm run lint`).
  No literal BOM or non-breaking space in source (`no-irregular-whitespace`).
- Comments explain *why*, not *what*, and are written in full sentences.
- One finding per commit. A behaviour fix ships with a test that fails on the old code.
- A UI change is checked in a browser at phone (390 px) and desktop width.

---

## 7. Environment and execution

### 7.1 Requirements

- Node **≥22** (CI uses 24), npm
- Docker Desktop (PostgreSQL, Redis, MinIO, Mailpit)
- Git
- Optional: Python 3 (for `apps/face`), Android SDK + JDK 17 (for Android builds),
  macOS + Xcode (for iOS builds — **not available on the current machine**)

### 7.2 First run

```bash
cd apps/web
npm ci                      # postinstall runs prisma generate
npm run secrets             # writes generated secrets into .env
npm run docker:up           # postgres, redis, minio, mailpit
npx prisma migrate deploy
npm run db:seed
npm run dev                 # http://localhost:3000
```

`npm run setup` does secrets + docker + migrate + seed in one step.
`npm run worker` starts the BullMQ workers (a second terminal); several features
are inert without it.

### 7.3 Environment variables

`apps/web/.env.example` lists **82 keys with empty values** — copy it to `.env`.
**Never commit real values.** Groups (names only):

| Group | Variables |
|---|---|
| Core | `NODE_ENV` `APP_ENV` `PROCESS_ROLE` `APP_URL` `ALLOWED_ORIGINS` |
| Database | `DATABASE_URL` `MIGRATION_DATABASE_URL` `DATABASE_REPLICA_URL` |
| Cache/queue | `REDIS_URL` |
| Crypto | `FIELD_ENCRYPTION_KEY` `WEBHOOK_SIGNING_PEPPER` |
| Sessions | `SESSION_TTL_MINUTES` `SERVICE_SESSION_TTL_MINUTES` `SESSION_IDLE_TIMEOUT_MINUTES` `MAX_FAILED_LOGINS` `LOCKOUT_MINUTES` `TRUSTED_PROXY_CIDRS` |
| Password hashing | `ARGON2_MEMORY_KIB` `ARGON2_TIME_COST` `ARGON2_PARALLELISM` |
| Storage | `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` |
| Email | `EMAIL_PROVIDER` `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `EMAIL_FROM` |
| AI | `GEMINI_API_KEY` `GEMINI_MODEL` `GEMINI_FALLBACK_MODEL` |
| Integrations | `META_APP_ID` `META_APP_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `MICROSOFT_CLIENT_ID` `MICROSOFT_CLIENT_SECRET` `WHATSAPP_PROVIDER` |
| Push | `FCM_PROJECT_ID` `FCM_CLIENT_EMAIL` `FCM_PRIVATE_KEY` `APNS_KEY` `APNS_KEY_ID` `APNS_TEAM_ID` `APNS_BUNDLE_ID` `APNS_SANDBOX` |
| Face | `FACE_SERVICE_URL` `FACE_SERVICE_TOKEN` `FACE_SERVICE_TOKEN_ROTATED_AT` `FACE_TOKEN_MAX_AGE_DAYS` `FACE_SERVICE_TIMEOUT_MS` `FACE_MATCH_THRESHOLD` `FACE_SAMPLES_REQUIRED` `FACE_ENROLMENT_MIN_SPREAD` |
| Attendance | `MAX_GPS_ACCURACY_M` `MIN_PUNCH_INTERVAL_SECONDS` `MAX_OFFLINE_SYNC_HOURS` `ATTENDANCE_CAPTURE_DIR` `ATTENDANCE_CAPTURE_RETENTION_DAYS` |
| Retention | `AUDIT_LOG_RETENTION_DAYS` `ATTENDANCE_PUNCH_RETENTION_DAYS` `PLATFORM_AUDIT_RETENTION_DAYS` `AI_EVENT_RETENTION_DAYS` |
| Limits & ops | `METRICS_TOKEN` `API_RATE_LIMIT_PER_MIN` `EXPORT_MAX_ROWS` `UPLOAD_MAX_MB` `LOG_LEVEL` `SLOW_QUERY_MS` |
| Other | `RECORDING_URL_ALLOWED_HOSTS` `ANTIVIRUS_PROVIDER` `CLAMAV_HOST` `CLAMAV_PORT` `ANTIVIRUS_TIMEOUT_MS` `LIVE_STREAM_WS_URL` `LIVE_STREAM_PORT` `ACCOUNT_DELETION_EXECUTION_ENABLED` |

Validation lives in `src/lib/env.ts`; optional keys are genuinely optional and a
feature reads "not configured on this deployment" when its keys are absent.

### 7.4 Commands

| Task | Command (from `apps/web`) |
|---|---|
| Dev server | `npm run dev` |
| Workers | `npm run worker` |
| Types | `npx tsc --noEmit` |
| Lint / format | `npm run lint` · `npm run format:check` |
| Unit + integration | `npx vitest run [files]` |
| Server-driven specs | `npm run test:server` |
| Browser | `npx playwright test` |
| Production build | `npx next build` (with `NODE_ENV` **unset**) |
| Gates CI also runs | `npm run check:rls` `check:permissions` `check:drift` `check:observability` `check:redis-auth` `check:test-data` |

Before `tsc`, delete stale route types: `rm -rf apps/web/.next/dev/types`.

### 7.5 Build and release

**CI** (`.github/workflows/ci.yml`) has two jobs: `verify` (gates, unit,
integration, E2E, build, `npm audit`) and `face-e2e` (face sidecar + the real
face engine spec). Browser tests run only on PRs to `main` and pushes to `main`.

**Release** (the owner runs step 3 — Claude cannot SSH to production):

1. Merge to `main`, wait for its CI.
2. `gh workflow run build-images.yml -f sha=<full 40-char sha>`
3. `& "C:\Program Files\Git\bin\bash.exe" /c/ymw/chain-release.sh <40-char sha> <migration count>`
   — staging, staging-first migration gate, backup + restore drill, production, smoke.
   It stops at the first failure and prints `CHAIN DONE <sha>` on success.
4. Logs land at `C:/ymw/{stage,preflight,deploy,ship,smoke}-<7-char sha>.log`.
   The preflight's `[backup-status]` lines are the production backup evidence.

**Phone apps:** `.github/workflows/android-apk.yml` and `ios-testflight.yml`;
a local Android build script exists at `C:/ymw/build-one1-vc12.mjs`.

### 7.6 Things that do NOT travel with the repository

| Item | Where it lives now | Note |
|---|---|---|
| Requirements tracker | `C:\ymw\lr\Lead-Eagle-Tracker.xlsx` | **Copy this** — it is the per-requirement status of record |
| Owner checklist | `C:\ymw\lr\Owner-steps-18-Oct.md` | **Copy this** — the 10 open items, step by step |
| Release scripts | `C:\ymw\chain-release.sh`, `prod-smoke.mjs` | Owner-run; hold host details |
| Dev rigs | `C:\ymw\{fix,pt,m2,ev,and-it}` + `C:\ymw\*-run.mjs` | Extra worktrees, each with its own database and Redis, for parallel work. Rebuildable; not required |
| Standalone Lead Eagle app | `C:\Users\admin\Music\Youhan One\Lead Eagle` (repo) and its worktree `C:\ymw\le-expo` on branch `feat/youhan-one-api` | **Separate git repository with no remote.** The YOUHAN ONE-ready app only exists here — copy it or push it somewhere |
| Signing material | Android keystore, Apple certificates, APNs key | Never in the repo |

---

## 8. Pending tasks and roadmap

### Blocked on the owner (nothing to code)

| # | Task | Unblocks |
|---|---|---|
| 1 | Firebase `google-services.json` + FCM service-account key; Apple push capability, regenerated profile, APNs `.p8`; `FCM_*`/`APNS_*` on production | Merge PR #224, build app 1.3.0, close M17-02, M20-08, PROD-14 — and delivers CallWatch to phones |
| 2 | Apple approves iOS 1.2.0 | The device pass (OWN-01, M15-01, M20-01) |
| 3 | Twilio account on staging + one real call with a recording | OWN-06, M9-07, and switches on Send SMS |
| 4 | Platform console → Settings → Self-serve sign-up = 14 days (and restore the setting mis-set on 10 Oct) | PLAN-08b |
| 5 | EAS build + store submission of the standalone Lead Eagle app | M20-02 |
| 6 | *(optional)* Microsoft Entra app registration; Google OAuth client | Outlook sync, Google Calendar sync |

Dependencies: 1 → app 1.3.0 → part of 2's device pass. 3 → SMS verification.
5 depends on 1 (push) and on the mobile API already being live (it is).

### Code work that could start today

- Tidy `changes/PROJECT.md`: fix the stale header line and remove the four
  duplicated paragraphs.
- Rewrite the root `README.md`, which still describes the old layout.
- Work through `docs/product/DECISIONS-REQUIRED.md` once the owner answers.
- `openCoverage` needs a `kind` before read-only CRM monitoring can be granted
  (needs the owner's go-ahead).

---

## 9. Current development position

### 9.1 Where work stopped

Feature work stopped **cleanly**. The last code change merged was **PR #237**
(`4861a72f`, 19 Oct): phone attendance through the mobile API plus native push
registration. It was released to production the same day and re-verified 20 Oct
(smoke 18/18, off-site backup verified).

Since 19 Oct the work has been **App Store administration**, not code: diagnosing
why iOS 1.2.0 sat in *Waiting for Review* (an unaccepted Apple Developer Program
License Agreement, accepted 27 Oct).

### 9.2 The last completed implementation

PR #235 + #237 together delivered: the `/api/mobile/**` API with device sessions,
phone attendance with a face on check-in **and** check-out, native push token
registration, Play-safe CallWatch, backup evidence in every release preflight,
the real face engine in CI, and two production bug fixes (a lost offline change
on reconnect; a call-log deadlock).

### 9.3 What the next task should be

**There is no pending code task.** The next action is owner-side (§8). When the
push keys arrive, the sequence is:

1. Put `google-services.json` and the FCM service-account key where the build
   expects them; set `FCM_*` / `APNS_*` on production.
2. Merge PR #224 after CI passes **on its exact head commit**.
3. Build Android 1.3.0 (`versionCode` 12) and iOS 1.3.0; submit both.
4. Mark M17-02, M20-08 and PROD-14 complete in the tracker.

### 9.4 Files to touch next

| Purpose | File |
|---|---|
| Phone app version bump (already prepared) | `apps/mobile/android/app/build.gradle`, `apps/mobile/ios/App/App.xcodeproj/project.pbxproj`, `apps/mobile/ios/App/App/App.entitlements` — **on branch `build/mobile-1.3.0-push`, do not redo** |
| Tracker | `C:\ymw\lr\Lead-Eagle-Tracker.xlsx` (sheets: Summary, Owner actions, Items, Releases, Progress) |
| Project state | `changes/PROJECT.md` |

### 9.5 Unfinished work that must be continued, not recreated

1. **PR #224** — already written and kept merged up with `main`. Merge it; do not
   rebuild the version bump.
2. **Standalone Lead Eagle Expo app**, branch `feat/youhan-one-api` in the separate
   Lead Eagle repository — sign-in with 2FA, leads, calls, follow-ups, face
   check-in/out, push, own artwork, verified by typecheck + Android bundle + its
   own node tests. **It has no remote: back it up before changing machines.**
3. **`changes/` entries** — 118 of them. They are the project's memory; read the
   relevant one instead of re-reading code.

---

## 10. Instructions for the next AI assistant

See **`AI_INSTRUCTIONS.md`** — the short version is kept there so it can be pasted
at the start of a session. In one line: read `changes/README.md` → `PROJECT.md` →
the entry for the area you are touching, open only the files your task needs, and
ship a `changes/` entry with every change.
