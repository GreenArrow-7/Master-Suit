# Master Suite — Architecture & Network Configuration Assessment

**Revision 2 · 2026-08-20 · commit `f1dd84e`**

> **This is a second assessment, not an update of the first.**
> `docs/ARCHITECTURE-NETWORK-ASSESSMENT.md` is a point-in-time record of `aede392`
> and is deliberately left as written. Twenty-one commits have landed since,
> remediating its P0, P1, P2 and most of its P3 findings. This document assesses
> the tree as it stands now and reaches materially different conclusions —
> several of its predecessor's most serious findings no longer exist, and the
> weaknesses that remain are of a different character.
>
> Where a finding has moved, this document says so and names the change, so the
> two revisions can be read as a before and after rather than as two opinions.
>
> **Two findings have been closed since this was written: P0-1 / W-2, "metrics
> exist and nothing scrapes them", and P0-3 / M-5, "Redis has no AUTH".** The scores below are left as assessed at
> `f1dd84e` rather than rewritten, for the same reason revision 1 was left
> alone — an assessment that edits itself is no longer a record of anything.
> The places a reader would otherwise act on the stale finding are annotated
> inline. See `docs/OBSERVABILITY.md` for what now runs.

Everything below was read out of the codebase or measured against a live
database and a rendered Compose configuration. Where something cannot be
determined from the repository it is marked **UNKNOWN / NOT FOUND** rather than
inferred. No credential value appears anywhere in this document; where a secret's
handling is discussed, only its location and its risk are named.

---

## Executive summary

Master Suite is **one Next.js 16 application**, not a frontend and a backend. It
is 121,838 lines of TypeScript across 720 files, with a second process of the
same image draining BullMQ queues and a small Python sidecar doing face
recognition. One PostgreSQL database holds all 192 models for every tenant.

The security architecture is the strongest part of the system and has got
stronger since revision 1. Tenant isolation is enforced three times over —
repository, a Prisma client extension, and `FORCE ROW LEVEL SECURITY` on 173 of
193 tables — and the process refuses to boot if the database role it connects as
could bypass the third layer. That is now backed by a CI gate
(`scripts/check-rls.mjs`) that reads the live catalog, so the property is
checked rather than claimed. The application role has been reduced to `USAGE`
on `public` with `CREATE` revoked.

**The single most serious finding of revision 1 — that the worker container
could not start in the documented production deployment, so every queue went
unconsumed in silence — is fixed.** So are the retention sweep that silently
deleted nothing, the base Compose file that published an unauthenticated
database on `0.0.0.0` with `trust` authentication, and the total absence of
metrics.

What remains is not architectural. It is a small number of features whose schema
shipped without an implementation, one genuine security gap the framework will
not let the codebase close, and a deployment that is still a single virtual
machine with no failover. The most consequential remaining weakness is
**operational rather than technical**: this system now has good controls and no
evidence that anybody is watching them, because the metrics endpoint it grew has
no scraper pointed at it in any environment this repository describes.

> **Closed since this was written.** A Prometheus and an Alertmanager now run in
> both deployment overlays, and CI fails the build if either overlay stops
> starting them. That leaves the single virtual machine as the most consequential
> remaining weakness. See `docs/OBSERVABILITY.md`.

### What changed since revision 1

| Revision 1 finding                                                            | Status now                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker unrunnable in the production stack; every queue silently unconsumed    | **Fixed.** A `worker` image stage runs the TypeScript through `tsx`; the entrypoint asserts every consumer attaches and exits non-zero otherwise |
| Retention sweep deleted nothing (RLS-blind raw SQL) and logged success        | **Fixed.** Runs under `withPlatformTx`, deletes the object before the row, batches to exhaustion, scheduled daily                                |
| Base Compose: `trust` auth, `0.0.0.0` bindings, prod overlay unbootable alone | **Fixed.** scram-sha-256 and loopback everywhere; every `DATABASE_URL` names the NOBYPASSRLS role                                                |
| No metrics, traces or error reporting anywhere                                | **Fixed.** `GET /api/metrics`, Prometheus exposition, 10 alert rules. A scraper was still missing at `f1dd84e` (W-2), and is not now             |
| No staging environment                                                        | **Fixed.** `infra/docker-compose.staging.yml`, plus a gate that refuses a production migration unrehearsed in staging                            |
| Backups covered the database and not the object store; nothing scheduled      | **Fixed.** Both, encrypted, on three systemd timers, with a restore verifier                                                                     |
| AI spend uncapped and unattributed                                            | **Fixed.** Metered per workspace, capped on the shared key only                                                                                  |
| Per-tenant Postgres sequences (≈100k relations at 10k tenants)                | **Fixed.** One counter table; `CREATE ON SCHEMA public` revoked                                                                                  |
| Per-request permission build uncached                                         | **Fixed.** 13.28 ms → 0.15 ms, invalidated by a hook in the Prisma client                                                                        |
| `ai` worker concurrency 2 platform-wide                                       | **Fixed.** Global 6 with a per-tenant ceiling of 2                                                                                               |
| PgBouncer "incompatible with the RLS approach"                                | **That was wrong.** The whole suite passes through PgBouncer in transaction mode; a configuration now ships                                      |
| No rollback; no tagged artifact                                               | **Fixed.** Images tagged by commit, promotion from staging, one-command rollback                                                                 |
| Platform OWNER held unrestricted write into every tenant, permanently         | **Fixed.** Read-only until a reasoned, time-boxed break-glass grant                                                                              |
| `script-src 'unsafe-inline'`                                                  | **Not fixed, and blocked** — see M-1                                                                                                             |
| Single VM, no failover, no PITR                                               | **Unchanged** — see W-1                                                                                                                          |
| Lead scoring modelled, no engine                                              | **Unchanged** — a product decision, see D-1                                                                                                      |
| Billing modelled, no payment provider                                         | **Unchanged** — a product decision, see D-2                                                                                                      |

---

## Technology stack

Read from `apps/web/package.json`. Eighteen runtime dependencies, sixteen
development — unusually few for an application this size, and a deliberate
pattern: this codebase hand-rolls TOTP, the Prometheus exposition format, the
clamd wire protocol and its own CSV writer rather than taking a dependency.

| Layer               | Choice                                                              | Version            |
| ------------------- | ------------------------------------------------------------------- | ------------------ |
| Runtime             | Node                                                                | `>=22` (`engines`) |
| Framework           | Next.js, App Router, `output: 'standalone'`                         | 16.2.12            |
| UI                  | React / React DOM                                                   | 19                 |
| Styling             | Tailwind CSS 4 + a 4,575-line `globals.css` + 196-line `tokens.css` | 4.0                |
| ORM                 | Prisma + `@prisma/adapter-pg` over `pg`                             | 7.0 / 8.13         |
| Database            | PostgreSQL                                                          | 16-alpine          |
| Queues              | BullMQ over ioredis                                                 | 5.34 / 5.4         |
| Cache / queue store | Redis                                                               | 7-alpine           |
| Validation          | zod                                                                 | 3.24               |
| Logging             | pino                                                                | 9.5                |
| Mail                | nodemailer                                                          | 9.0                |
| Object storage      | `@aws-sdk/client-s3` against MinIO                                  | 3.700              |
| Passwords           | `@node-rs/argon2` (argon2id)                                        | 2.0                |
| Ids                 | `ulid` (request ids), `cuid` (records)                              | 2.3                |
| Tests               | Vitest (two configs) + Playwright                                   | 4.1.10 / 1.51      |
| Reverse proxy       | Caddy 2 (ACME HTTP-01)                                              | 2-alpine           |
| Face recognition    | FastAPI + onnxruntime, 233-line sidecar                             | `apps/face/`       |

**No client state library, and no data-fetching library.** No Redux, Zustand,
Jotai, TanStack Query or SWR. This is a consequence of the rendering model rather
than an omission — see §3.

---

## 1. Current system architecture

### 1.1 The shape

One deployable application with two entry points into the same source tree:

- **web** — `next build` standalone output, `node server.js`. Serves every
  screen (server components) and every API route.
- **worker** — the same `src/` run through `tsx`, entry `src/workers/index.ts`.
  Nine BullMQ consumers and two schedulers.

They share the database, Redis, and object storage. They do not talk to each
other directly: the web process enqueues, the worker drains.

```mermaid
flowchart TB
  subgraph edge["Public edge"]
    U["Browser"]
    C["Caddy 2 · :80/:443<br/>ACME HTTP-01 · blocks /api/metrics"]
  end

  subgraph app["Compose network (private)"]
    W["web · Next 16 standalone<br/>server components + /api/v1"]
    K["worker · tsx src/workers/index.ts<br/>9 consumers, 2 schedulers"]
    F["face · FastAPI + onnxruntime<br/>no DB, no tenant awareness"]
    AV["clamav · INSTREAM :3310"]
    M["MinIO · S3 API :9000"]
    R["Redis 7 · queues, rate limits, caches"]
    P["PostgreSQL 16<br/>173 tables FORCE RLS"]
  end

  subgraph out["Outbound, egress only"]
    G["Google Gemini<br/>generativelanguage.googleapis.com"]
    S["SMTP relay"]
    ME["Meta Graph API"]
    T["Telephony vendors<br/>Twilio · Plivo · Exotel · Knowlarity"]
  end

  U -->|HTTPS| C --> W
  W --> P
  W --> R
  W --> M
  W --> AV
  W --> F
  W -.enqueue.-> R
  R -.consume.-> K
  K --> P
  K --> M
  K --> G
  K --> S
  W --> G
  W --> ME
  T -->|inbound webhook| C
  ME -->|inbound webhook| C
```

### 1.2 How the pieces communicate

| From → To                  | Mechanism                                         | Notes                                                                                     |
| -------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Browser → web              | HTTPS through Caddy                               | Session in an httpOnly cookie; no token in JavaScript                                     |
| Server component → data    | **Direct function call**                          | 89 pages import `@/lib/db`, 45 import `@/services/*`. Zero pages fetch their own API      |
| Client component → API     | `authFetch` (`src/lib/auth/client.ts`)            | Single-flight refresh on 401, one retry, fail closed                                      |
| API route → business logic | `src/services/*`                                  | Routes validate and delegate; services know nothing about HTTP                            |
| web → worker               | BullMQ job on Redis                               | `enqueue()` hashes the payload into the job id, so a duplicate trigger converges          |
| Any → Postgres             | Prisma over `pg`, `connection_limit` in the URL   | Every query passes the tenant-guard extension                                             |
| Any → Redis                | ioredis, `lazyConnect`                            | Queues, rate-limit counters, entitlement cache, actor cache, OAuth state, face challenges |
| web/worker → MinIO         | AWS SDK v3, path-style                            | The web process streams objects itself; **no presigned URL is ever issued**               |
| web → face                 | HTTP on the Compose network, shared-secret header | Constant-time compare; refuses to start unauthenticated outside development               |
| web → clamav               | Raw INSTREAM on :3310                             | Hand-written protocol client                                                              |
| worker/web → Gemini        | HTTPS REST, `?key=`                               | No SDK — plain `fetch` against `v1beta/models/{model}:generateContent`                    |

### 1.3 Cross-cutting concerns, and where each lives

| Concern       | Implementation                                                                                     | File                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Configuration | zod-validated env, fails at boot not first use; `<KEY>_FILE` reads a secret from a file            | `src/lib/env.ts`                                     |
| Boot safety   | Refuses mock providers, an undeclared proxy, a superuser DB role, an environment/database mismatch | `src/lib/startup-check.ts`                           |
| Error model   | `AppError` → RFC 7807-ish problem document with a request id                                       | `src/lib/errors.ts`                                  |
| Logging       | pino, structured, stdout                                                                           | `src/lib/logger.ts`                                  |
| Metrics       | Hand-rolled Prometheus registry, token-gated endpoint                                              | `src/lib/metrics.ts`, `src/app/api/metrics/route.ts` |
| Audit         | `AuditLog` per tenant; `PlatformAuditEvent` for control-plane acts                                 | `src/lib/security/audit.ts`                          |
| Caching       | Redis only. Entitlements (60s), actor/permissions (60s + versioned invalidation)                   | `src/lib/redis.ts`, `src/lib/auth/actorCache.ts`     |
| Sessions      | Opaque 256-bit token, SHA-256 at rest, httpOnly cookie                                             | `src/lib/auth/session.ts`                            |
| Encryption    | AES-256-GCM with HKDF domain separation                                                            | `src/lib/security/envelope.ts`                       |

---

## 2. Application component map

### Frontend

| Component                   | Purpose                                                                | Location                                         | Auth                              | Production-ready | Known limitations                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Workspace shell             | Layout, navigation, workspace switch, MFA redirect                     | `src/app/(workspace)/[workspaceSlug]/layout.tsx` | Session                           | Yes              | Forces enrolment redirect for privileged roles — correct, but a hard redirect loop if `/profile/security` itself errors |
| Sales area (63 pages)       | Leads, opportunities, calls, campaigns, listings, commissions, reports | `src/app/(workspace)/[workspaceSlug]/sales/`     | Session + RBAC                    | Yes              | Two 1,000-line API dispatchers behind it (W-6)                                                                          |
| People/HR area (32 pages)   | Attendance, payroll, leave, recruitment, performance, documents        | `.../people/`                                    | Session + RBAC + HRMS entitlement | Yes              | Payroll is the highest-consequence surface and the WPS layout is one bank's dialect                                     |
| Admin area (8 pages)        | Users, roles, integrations, settings, audit                            | `.../admin/`                                     | Session + admin permissions       | Yes              | —                                                                                                                       |
| Platform console (10 pages) | Workspaces, plans, subscriptions, platform users, system health, audit | `src/app/(platform)/platform/`                   | Platform session                  | Yes              | Break-glass grant has no UI yet — the API exists, the button does not (M-4)                                             |
| Auth screens (5)            | Login, forgot/reset password, accept invite, enrol 2FA                 | `src/app/(auth)/`                                | Public                            | Yes              | —                                                                                                                       |
| Public token routes (4)     | Public forms, short links, RSVP, testimonial capture                   | `src/app/f`, `l`, `rsvp`, `testimonial`          | Bearer-in-URL                     | Yes              | Rate-limited per IP; tokens are the only credential                                                                     |
| `authFetch`                 | The browser's authenticated fetch                                      | `src/lib/auth/client.ts`                         | —                                 | Yes              | Single-flight refresh, one retry, fail closed                                                                           |
| UI kit                      | 7 primitives + area-specific components                                | `src/components/ui/`, `src/components/*`         | —                                 | Yes              | Thin for a 108-page product; most styling lives in `globals.css`                                                        |

### Backend

| Component           | Purpose                                                           | Location                             | Notes                                    |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| API kernel          | authn → limit → authz → validate → handle → audit                 | `src/lib/api/handler.ts` (265 lines) | **119 of 155 route files** go through it |
| Guarded prologue    | The same order for routes that must stream                        | `src/lib/api/guarded.ts`             | 8 routes. Rate limit cannot be omitted   |
| Platform guard      | Control-plane routes                                              | `src/lib/auth/platform.ts`           | 10 routes                                |
| Services layer      | Business rules, 22 domains                                        | `src/services/*`                     | No HTTP knowledge                        |
| Tenant guard        | Prisma extension: refuses an unscoped query, pins `app.tenant_id` | `src/lib/db.ts`                      | Also hooks permission-cache invalidation |
| Queue layer         | 12 declared queues, deterministic job ids                         | `src/lib/queue.ts`                   | 9 consumed, 3 not (M-3)                  |
| Fairness            | Per-tenant slot accounting, Lua-atomic                            | `src/lib/queueFairness.ts`           | Applied to `ai`                          |
| Filter compiler     | Allow-listed field → SQL                                          | `src/lib/api/filterTree.ts`          | Only `LEAD` registered (M-2)             |
| Visibility resolver | OWN/TEAM/BRANCH/REGION/ORGANIZATION → a `where`                   | `src/lib/security/visibility.ts`     | —                                        |
| Field security      | Per-role field masking on read                                    | `src/lib/security/fieldSecurity.ts`  | Applied to exports too                   |

### Database

| Component                       | Detail                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                          | PostgreSQL 16                                                                                                                                                                     |
| Models                          | 192 · 103 enums · 332 declared indexes · 100 unique constraints                                                                                                                   |
| Live catalog                    | 193 tables · 655 indexes · 404 foreign keys · 173 RLS policies                                                                                                                    |
| Tenant-owned                    | 181 models carry `tenantId`; 173 tables are `FORCE ROW LEVEL SECURITY`                                                                                                            |
| Bootstrap (deliberately no RLS) | 8 tables — `APIKey`, `IntegrationConnection`, `PasswordResetToken`, `PlatformAccessGrant`, `PlatformAuditEvent`, `RateLimitCounter`, `WorkspaceInvitation`, `WorkspaceMembership` |
| Migrations                      | 55, versioned, `prisma migrate deploy`                                                                                                                                            |
| Soft delete                     | 51 models carry `deletedAt`; the guard injects `deletedAt: null` on reads                                                                                                         |
| Audit fields                    | `createdAt` on 167 models, `createdById` on 75                                                                                                                                    |

### AI

| Component     | Location                  | Notes                                                            |
| ------------- | ------------------------- | ---------------------------------------------------------------- |
| Gemini client | `src/lib/ai/gemini.ts`    | Plain REST, no SDK. Per-workspace BYO key or the deployment key  |
| Redaction     | `src/lib/ai/redact.ts`    | Runs before anything leaves. Now catches numbers spoken as words |
| Analysis      | `src/lib/ai/analysis.ts`  | Schema-constrained output, claim-before-bill idempotency         |
| Call audit    | `src/lib/ai/audit.ts`     | Only against a scorecard the workspace wrote                     |
| Live coach    | `src/lib/ai/liveCoach.ts` | —                                                                |
| Assistant     | `src/lib/ai/assistant/`   | Tools run the caller's own permissions                           |
| Simulation    | `src/lib/ai/simulated.ts` | Labelled, never passed off as real                               |
| Metering      | `src/lib/ai/usage.ts`     | Per-workspace tokens, plan ceiling on the shared key             |

### Infrastructure

| Component               | Location                             | Notes                                                        |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Base stack              | `infra/docker-compose.yml`           | Loopback-only, scram-sha-256                                 |
| Production overlay      | `infra/docker-compose.prod.yml`      | Built image, commit-tagged                                   |
| Azure single-VM overlay | `infra/docker-compose.azure.yml`     | Caddy, nothing else published                                |
| Staging project         | `infra/docker-compose.staging.yml`   | Separate Compose project, own database and secrets           |
| PgBouncer (opt-in)      | `infra/docker-compose.pgbouncer.yml` | Transaction pooling, verified safe with this RLS model       |
| Backup schedule         | `infra/systemd/*` (6 units)          | Nightly backup, weekly restore verify, daily freshness check |
| Alerts                  | `infra/prometheus-alerts.yml`        | 9 rules                                                      |
| CI                      | `.github/workflows/ci.yml`           | 19 gates                                                     |

### External integrations

See §14.

### Security

| Component           | Location                                           |
| ------------------- | -------------------------------------------------- |
| RBAC engine         | `src/lib/security/rbac.ts`                         |
| Entitlements        | `src/lib/security/entitlements.ts`                 |
| Rate limiting       | `src/lib/security/ratelimit.ts` — 12 named buckets |
| Audit               | `src/lib/security/audit.ts`                        |
| Envelope encryption | `src/lib/security/envelope.ts`                     |
| CIDR parsing        | `src/lib/security/cidr.ts`                         |
| Boot gate           | `src/lib/startup-check.ts`                         |
| CSP and headers     | `src/proxy.ts`, `next.config.ts`                   |

### Administration

Platform console (`src/app/(platform)/`), `PlatformUser` with roles
`OWNER`/`SUPPORT`/`SECURITY_AUDITOR`, break-glass grants
(`src/lib/auth/platform-access.ts`), and `PlatformAuditEvent`.

---

## 3. Frontend architecture

### 3.1 The rendering model, and what follows from it

**Next.js 16.2.12 App Router, server components by default.** 245 `.tsx` files,
of which 91 carry `'use client'` — 37%. The other 63% run on the server.

The consequence is the single most important frontend fact in this codebase:

> **No page fetches its own API.** Zero of 108 workspace pages call
> `fetch('/api/...')`. 89 import `@/lib/db` and query Prisma directly; 45 import
> a service. Client components that need to mutate go through `authFetch` to
> `/api/v1`.

That is why there is no Redux, no TanStack Query and no SWR: there is no client
cache to manage, because the server renders the data into the page. It removes an
entire class of bug (stale client cache, over-fetching, waterfall requests) and
introduces a different one — see W-5.

### 3.2 Structure

```mermaid
flowchart TB
  RL["src/app/layout.tsx · root"] --> AUTH["(auth) · 5 pages"]
  RL --> WS["(workspace)/[workspaceSlug]/layout.tsx"]
  RL --> PL["(platform)/platform · 10 pages"]
  RL --> PUB["/f /l /rsvp /testimonial · token-addressed"]

  WS --> D["dashboard"]
  WS --> S["sales · 63 pages"]
  WS --> PE["people · 32 pages"]
  WS --> AD["admin · 8 pages"]
  WS --> T["tasks · notifications · profile"]

  WS -. "resolveWorkspacePage()" .-> GATE["resolveCtx → entitlement → membership<br/>redirect('/login') · MFA redirect"]
```

| Aspect               | Implementation                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing              | File-system, App Router, route groups for auth/workspace/platform                                                                                                 |
| Page gate            | `src/lib/workspace-page.ts` — `requirePageAccess()` / `resolveWorkspacePage()`; the layout redirects to `/login` and forces MFA enrolment for privileged roles    |
| State                | React local state only. Server state is the render                                                                                                                |
| API communication    | `authFetch` for client mutations; direct data access for server render                                                                                            |
| Session handling     | httpOnly cookie. **No token is ever held in JavaScript** — no `localStorage`, no in-memory token                                                                  |
| Error handling       | `error.tsx`, `not-found.tsx`, `forbidden.tsx` at the root and per area                                                                                            |
| Form validation      | zod schemas shared between the route and the form                                                                                                                 |
| Styling              | Tailwind 4 utilities over a design-token layer (`src/styles/tokens.css`, 196 lines) and a large hand-written component layer (`globals.css`, 4,575 lines)         |
| Build                | Turbopack, `output: 'standalone'`, `distDir` overridable so dev and local-prod builds do not evict each other                                                     |
| Client-side security | CSP from `src/proxy.ts`; five static headers from `next.config.ts`; `Permissions-Policy` allows geolocation and camera to self (attendance) and denies microphone |

### 3.3 The major user journeys

```mermaid
sequenceDiagram
  actor U as User
  participant L as /login
  participant API as /api/v1/auth/login
  participant DB as PostgreSQL
  participant WS as (workspace) layout
  participant P as Page (server component)

  U->>L: credentials
  L->>API: POST
  API->>DB: PlatformUser + argon2id verify
  API->>DB: PlatformSession (sha256 of a 256-bit token)
  API-->>U: Set-Cookie lf_session (httpOnly, SameSite=Lax)
  U->>WS: GET /{slug}/dashboard
  WS->>WS: resolveCtx → entitlement → membership → actor
  alt privileged role without MFA
    WS-->>U: redirect /profile/security
  end
  WS->>P: render
  P->>DB: Prisma (tenant guard pins app.tenant_id)
  P-->>U: HTML
```

Beyond sign-in the journeys are: **Dashboard → Leads** (grid with keyset
pagination and an allow-listed filter) **→ Opportunities → Follow-ups → Calls →
AI analysis** (see §10) **→ Reports** (read from the replica) **→ People/HR →
Administration**.

### 3.4 Frontend problems

- **W-5 · Business logic in pages.** 89 pages query Prisma directly. The tenant
  guard makes this _safe_, and it makes it hard to reuse: the same query
  reappears in a page, a service and an export. Concretely, the read path for a
  lead list exists in `sales/leads/page.tsx`, in `services/leads/` and in
  `api/v1/leads/export`.
- **W-6 · Two very large API dispatchers** behind the HR screens:
  `hr/[resource]/route.ts` (1,089 lines) and `hr/actions/[action]/route.ts`
  (974 lines).
- **M-5 · The UI component layer is thin** for the size of the product — 7
  primitives in `src/components/ui/` against 4,575 lines of hand-written CSS.
  Visual consistency is being held by CSS discipline rather than by components.

---

## 4. Backend architecture

### 4.1 The kernel, and how consistently it is used

`src/lib/api/handler.ts` is 265 lines and does six things in a fixed order:

```
1. Authenticate    resolveCtx — session cookie or API key
2. Rate limit      route-specific, or the per-session / per-API-key bucket
3. Authorize       entitlement, then permission, before the body runs
4. Validate        zod on params, query and body
5. Handle          the route's own function
6. Audit           on success, with the request id
```

Of 155 route files:

| Guard                           | Count | Which                                                                    |
| ------------------------------- | ----: | ------------------------------------------------------------------------ |
| Kernel `route({...})`           |   119 | Everything that answers JSON                                             |
| `resolveGuardedCtx`             |     8 | Streams and downloads — PDFs, CSV exports, the WPS bank file             |
| `requirePlatformOwner`          |    10 | Control plane                                                            |
| Session-resolving, hand-written |     2 | Sign-out, and the Meta OAuth callback — both pre-authorisation by nature |
| Intentionally unauthenticated   |    16 | See the table below                                                      |

That is **96% of the API behind one of three audited prologues**, up from the
78% revision 1 measured. The eight streaming routes were the interesting gap:
five of them had no rate limit at all, including the WPS export that dumps every
employee's IBAN. `resolveGuardedCtx` applies one by default and offers no way to
switch it off.

### 4.2 The unauthenticated surface, and what guards each

| Route                                     | Guard                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/login`                 | Per-IP (10/15min) **and** per-account (5/15min) buckets; timing equalisation; lockout |
| `POST /api/v1/auth/refresh`               | The cookie itself. Rotation; **replay of a rotated token revokes every session**      |
| `POST /api/v1/auth/reset-password`        | Single-use, hashed, expiring token                                                    |
| `POST /api/v1/auth/forgot-password`       | Per-IP (20/h) and per-address (3/h)                                                   |
| `POST /api/v1/auth/accept-invite`         | Hashed invite token; 30/10min per IP                                                  |
| `POST /api/v1/auth/enroll-2fa`            | Session + 10/5min per user                                                            |
| `GET /api/v1/auth/workspaces`             | Platform session cookie (`resolvePlatformCtx`)                                        |
| `POST /api/v1/auth/logout-all`            | Session cookie                                                                        |
| `POST /api/v1/webhooks/telephony[/{key}]` | Per-integration-key limit **before** any database work, then HMAC                     |
| `POST /api/v1/webhooks/meta/{key}`        | Per-key limit, then Meta signature verification                                       |
| `GET /api/v1/dev/outbox`                  | 404s unless `NODE_ENV=development`                                                    |
| `GET /api/metrics`                        | `METRICS_TOKEN`, `timingSafeEqual`, **404 when unset or wrong**                       |
| `GET /api/health`, `/api/health/live`     | Deliberately open; return no versions or hostnames                                    |

Nothing here is unguarded. The pattern throughout is that the _credential is the
thing in the URL or the cookie_, and the rate limit runs before the credential is
looked up — so an attacker cannot use the lookup itself as an oracle or a load
generator.

### 4.3 Dependency map

```mermaid
flowchart TB
  R["src/app/api/v1/** · 155 routes"]
  K["lib/api/handler.ts · kernel"]
  G["lib/api/guarded.ts"]
  PG["lib/auth/platform.ts"]
  SVC["src/services/** · 22 domains"]
  DB["lib/db.ts · Prisma + tenant guard"]
  RB["lib/security/rbac.ts"]
  VIS["lib/security/visibility.ts"]
  FS["lib/security/fieldSecurity.ts"]
  ENT["lib/security/entitlements.ts"]
  RL["lib/security/ratelimit.ts"]
  AUD["lib/security/audit.ts"]
  Q["lib/queue.ts"]
  AI["lib/ai/*"]
  ST["lib/storage.ts"]
  RED["lib/redis.ts"]
  PGDB[("PostgreSQL")]
  RDS[("Redis")]
  S3[("MinIO")]

  R --> K & G & PG
  K --> RB & ENT & RL & AUD
  G --> RB & ENT & RL
  K --> SVC --> DB --> PGDB
  SVC --> VIS & FS & Q & AI & ST
  ENT --> RED
  RL --> RED
  Q --> RED --> RDS
  ST --> S3
  DB -.invalidate.-> RED
```

`src/lib/db.ts` is the choke point every read and write passes through, and it
now carries three responsibilities: the tenant guard, pinning `app.tenant_id`
onto the connection for RLS, and invalidating the permission cache when a
role-shaped model is written. That third one is deliberately in the client rather
than at the write sites — there are dozens of places that touch a role, and the
failure mode of missing one is a revoked permission that still works.

### 4.4 Background jobs

Twelve queues declared; **nine consumed**:

| Queue           | Consumer | Purpose                                                          |
| --------------- | -------- | ---------------------------------------------------------------- |
| `automation`    | ✅       | The automation graph engine                                      |
| `distribution`  | ✅       | Lead assignment                                                  |
| `sla`           | ✅       | Escalation timers                                                |
| `media`         | ✅       | Pull recordings off the telephony vendor into object storage     |
| `ai`            | ✅       | Transcribe, analyse, audit — concurrency 6, per-tenant ceiling 2 |
| `notifications` | ✅       | Email fan-out behind the in-app notification                     |
| `campaign`      | ✅       | Campaign sweep (scheduler: every 60s)                            |
| `webhook`       | ✅       | Apply inbound webhook events                                     |
| `maintenance`   | ✅       | Retention sweep (scheduler: `0 3 * * *`)                         |
| `messaging`     | ❌       | Declared, no consumer                                            |
| `import`        | ❌       | Declared, no consumer — there is no importer                     |
| `export`        | ❌       | Declared, no consumer — exports stream synchronously             |

The worker asserts every consumer attaches within 10 seconds and **exits
non-zero** otherwise, and logs the unconsumed three at every boot so the gap is
stated rather than discovered. Schedulers are armed only after all consumers are
up, and are idempotent by scheduler id, so two worker replicas are safe.

---

## 5. Database architecture

### 5.1 Multi-tenancy: shared database, shared schema, row-level security

**Shared database / shared schema.** One PostgreSQL database, one `public`
schema, every tenant's rows in the same tables, discriminated by `tenantId` and
separated by row-level security.

Isolation is enforced **three times, independently**:

```mermaid
flowchart TB
  subgraph L1["Layer 1 · Repository"]
    A["Every query carries ctx.tenantId"]
  end
  subgraph L2["Layer 2 · Prisma client extension (lib/db.ts)"]
    B["Unscoped read or filtered write → TenantGuardError<br/>counted as masterapp_tenant_guard_trips_total"]
    C["Scoped query → batched $transaction:<br/>set_config('app.tenant_id', …, true) then the query"]
  end
  subgraph L3["Layer 3 · PostgreSQL"]
    D["FORCE ROW LEVEL SECURITY on 173 tables"]
    E["policy: tenantId = app.tenant_id OR app.platform_admin = 'on'"]
  end
  A --> B --> C --> D --> E
```

The policy body, read from the live catalog:

```sql
("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  OR (current_setting('app.platform_admin', true) = 'on')
```

Three properties make this stronger than the usual version of this pattern:

1. **`FORCE`**, not merely `ENABLE`. A table owner bypasses RLS unconditionally
   unless the table is forced, and no role attribute reveals it.
2. **The application connects as `master_saas_app`** — verified live as
   `rolsuper=f`, `rolbypassrls=f`, owning nothing, with `CREATE ON SCHEMA public`
   revoked and only `USAGE` retained. `startup-check.ts` refuses to serve
   otherwise.
3. **`set_config(..., true)` is transaction-local**, so the setting cannot leak
   to the next borrower of a pooled connection — and that is exactly what makes
   the schema safe behind PgBouncer in transaction mode (§9.4).

`scripts/check-rls.mjs` is a CI gate that reads `pg_class` and `pg_policy` and
fails if any tenant-owned table has lost its policy, its `FORCE` flag, the
`app.platform_admin` branch, or has gained a role-scoped policy. It is
catalog-driven rather than list-driven, so a table added since the last release
is covered the moment it exists.

**Eight bootstrap tables deliberately sit outside RLS**, each because the tenant
is resolved _from_ the row rather than known before it: an API key, an
integration key in a webhook URL, a password-reset token, an invitation, a
rate-limit counter, and three control-plane tables gated by
`requirePlatformOwner` instead.

### 5.2 Shape

| Property        | Value                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| Models / tables | 192 declared · 193 live (the extra is `_prisma_migrations`)              |
| Enums           | 103                                                                      |
| Indexes         | 332 declared · 655 live (Prisma implements `@@unique` as unique indexes) |
| Foreign keys    | 404, live                                                                |
| RLS policies    | 173                                                                      |
| Migrations      | 55                                                                       |
| Primary keys    | `cuid` throughout                                                        |
| Soft delete     | `deletedAt` on 51 models; injected by the guard on reads                 |
| Audit fields    | `createdAt` 167 · `createdById` 75                                       |

Index strategy is tenant-leading composites (`@@index([tenantId, …])`) with
keyset pagination everywhere — no `OFFSET` in a list path.

### 5.3 ER — the core

```mermaid
erDiagram
  Tenant ||--o{ User : "employs"
  Tenant ||--o{ Role : "defines"
  Tenant ||--o{ Lead : "owns"
  Tenant ||--o{ TenantReferenceCounter : "numbers"
  Tenant ||--|| TenantSubscription : "subscribes"
  Tenant ||--o{ ModuleEntitlement : "may use"
  Tenant ||--o{ WorkspaceUsage : "consumes"

  PlatformUser ||--o{ WorkspaceMembership : "belongs to"
  PlatformUser ||--o{ PlatformSession : "holds"
  PlatformUser ||--o{ AuthenticationFactor : "enrols"
  PlatformUser ||--o{ PasswordHistory : "has used"
  PlatformUser ||--o{ PlatformAccessGrant : "break-glass"
  WorkspaceMembership }o--|| Tenant : "into"
  WorkspaceMembership |o--|| User : "acts as"

  User }o--|| Role : "primary"
  User ||--o{ MembershipRole : "additional"
  Role ||--o{ RolePermission : "grants"
  RolePermission }o--|| Permission : "of"

  Lead ||--o{ Activity : "history"
  Lead ||--o{ FollowUpTask : "next steps"
  Lead ||--o{ Call : "conversations"
  Lead |o--|| LeadStage : "at"
  Lead ||--o{ Opportunity : "converts to"
  Call ||--o| Recording : "may have"
  Call ||--o| Transcript : "may have"
  Call ||--o| AIAnalysis : "may have"
  Call ||--o{ CallAudit : "scored by"

  SubscriptionPlan ||--o{ TenantSubscription : "sold as"
  SubscriptionPlan ||--o{ PlanLimit : "caps"
```

### 5.4 Transactions

Two helpers, and the distinction matters:

- `withTx(tenantId, fn)` — an interactive transaction pinned to one tenant. Sets
  `app.tenant_id` itself, because an interactive transaction owns a connection
  and the per-query wrapper must stand down inside it.
- `withPlatformTx(fn, { timeoutMs })` — the control plane. Asserts
  `app.platform_admin` instead of a tenant, because these legitimately span
  tenants or write for a tenant that does not exist yet.

---

## 6. Authentication & authorization

### 6.1 Sessions — opaque tokens, not JWTs

There is **no JWT anywhere in this codebase**, and that is a deliberate and
correct choice for this product: a revoked session must stop working now, and a
signed bearer token cannot be un-signed.

| Property        | Implementation                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Token           | 256 bits from `randomBytes(32)`, base64url                                                          |
| At rest         | SHA-256 hash only — the database never holds a usable token                                         |
| Transport       | `lf_session` cookie: `httpOnly`, `sameSite: 'lax'`, `secure` in production                          |
| In JavaScript   | **Never.** No `localStorage`, no in-memory copy                                                     |
| Rotation        | `POST /api/v1/auth/refresh`, called by `authFetch` on a 401                                         |
| Replay          | Presenting an already-rotated token is treated as **theft**: every session for that user is revoked |
| Concurrency     | Single-flight — ten components 401ing at once share one refresh                                     |
| Idle / absolute | `SESSION_IDLE_TIMEOUT_MINUTES` (60) and `SESSION_TTL_MINUTES` (480)                                 |

### 6.2 Passwords and second factors

- **argon2id** via `@node-rs/argon2`, m=19456 KiB, t=2, p=1 — configurable, and
  the defaults are at OWASP's recommended floor.
- **Reuse window**: `PasswordHistory` keeps 24 entries, each argon2-verified on
  change.
- **Maximum age**: `passwordExpired()`; a null `passwordChangedAt` reads as
  expired.
- **Lockout**: `MAX_FAILED_LOGINS` (5) / `LOCKOUT_MINUTES` (15), plus per-IP and
  per-account rate limits, plus timing equalisation so a missing account and a
  wrong password take the same time.
- **MFA**: RFC 6238 TOTP, hand-implemented (`src/lib/auth/mfa.ts`), 6 digits,
  30-second step, SHA-1 as authenticator apps expect, with drift tolerance. The
  secret is sealed with AES-256-GCM. **Privileged roles cannot skip enrolment** —
  the workspace layout redirects them to `/profile/security` until they do.

### 6.3 Authorization

Four independent dimensions, evaluated in order:

```mermaid
flowchart LR
  A["1 · Entitlement<br/>does this workspace pay for HRMS/SALES?"] -->
  B["2 · Permission<br/>module:ACTION on the actor's role"] -->
  C["3 · Scope<br/>OWN < TEAM < BRANCH < REGION < ORGANIZATION"] -->
  D["4 · Field security<br/>mask on read, including exports"]
```

The actor is the union of a primary role and every ACTIVE, in-window
`MembershipRole` assignment, each capped at its assignment's own scope — so a
Branch Manager role assigned for one branch does not confer its
ORGANIZATION-scoped reads everywhere. A deactivated role grants nothing wherever
it is held.

This build used to run on every request (three queries with deep includes). It is
now cached in Redis, **versioned rather than swept**: the key does not carry the
version, the value does, so invalidating a tenant is one `INCR`. Invalidation is
hooked into the Prisma client, so revocation is immediate; the 60-second TTL is a
backstop for a missed bump, not the mechanism.

### 6.4 Platform staff

`PlatformUser.platformRole` ∈ `{OWNER, SUPPORT, SECURITY_AUDITOR}`. Platform
staff hold no `WorkspaceMembership` — they are not employees of the customer — so
`buildSupportActor` synthesises one:

- **SUPPORT / SECURITY_AUDITOR** — every module's `VIEW` and `VIEW_REPORTS`,
  nothing else, and never `VIEW_SENSITIVE_FIELDS`.
- **OWNER without a break-glass grant** — the same read-only actor.
- **OWNER with a live grant** — full control until it expires.

A grant (`PlatformAccessGrant`) requires a stated reason of at least 12
characters, is capped at four hours, is scoped to one workspace, refuses to stack
with another, and writes `PLATFORM_WRITE_ACCESS_OPENED` on the **customer's own**
audit trail. Expiry is enforced on read, so nothing has to sweep it.

### 6.5 Sequence

```mermaid
sequenceDiagram
  actor U as Browser
  participant R as Route (kernel)
  participant S as resolveCtx
  participant DB as PostgreSQL
  participant RD as Redis

  U->>R: request + lf_session cookie
  R->>S: authenticate
  S->>DB: PlatformSession by sha256(token)
  DB-->>S: session + platformUser
  S->>DB: WorkspaceMembership (active tenant, ACTIVE, tenant not deleted)
  alt platform staff, no membership
    S->>DB: PlatformAccessGrant (live?)
    S-->>R: support actor — read-only, or full if granted
  else workspace user
    S->>RD: MGET rbac version + cached actor
    alt hit and version matches
      RD-->>S: actor
    else
      S->>DB: user+role+permissions, assignments, managed users
      S->>RD: SET actor with the current version, TTL 60s
    end
  end
  R->>RD: consume rate-limit token
  R->>R: entitlement → permission → zod
  R->>DB: handler, through the tenant guard
  R->>DB: AuditLog
  R-->>U: JSON + x-request-id
```

### 6.6 Weaknesses in the authentication path

|     | Finding                                                                                                                                                                                                                                                                                               | Severity          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A1  | Session identity is a bearer cookie with `SameSite=Lax`, and there is **no CSRF token**. Lax blocks cross-site POSTs from forms, which covers the classic attack, but a same-site subdomain compromise would not be stopped by it. There is no subdomain in the current deployment, so this is latent | 🔵 Low            |
| A2  | `TRUSTED_PROXY_CIDRS` accepts `none`, which collapses per-IP rate limiting into one shared bucket. Production **refuses to start** with it, so this only affects development                                                                                                                          | 🟢 Good (guarded) |
| A3  | The face service is authenticated by a shared secret in a header, compared in constant time. There is no mTLS or per-request signing on the Compose network                                                                                                                                           | 🟡 Medium         |
| A4  | Account enumeration on `/auth/forgot-password` is prevented by a uniform response; on `/auth/accept-invite` the invite token is the only credential and is rate-limited per IP                                                                                                                        | 🟢 Good           |

---

## 7. Network architecture

### 7.1 Every connection, with its trust boundary

|   # | From → To                | Protocol      | Port    | Transport security                                  | Auth                                 | Exposure                                       | Data                                                                                |
| --: | ------------------------ | ------------- | ------- | --------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
|   1 | Browser → Caddy          | HTTPS         | 443     | TLS, ACME HTTP-01, HSTS preload                     | Session cookie                       | **Public**                                     | Everything                                                                          |
|   2 | Browser → Caddy          | HTTP          | 80      | —                                                   | —                                    | **Public**                                     | ACME challenge + redirect to 443 only                                               |
|   3 | Caddy → web              | HTTP          | 3000    | **Plaintext**                                       | — (adds `X-Real-IP`)                 | Compose network                                | Everything                                                                          |
|   4 | web/worker → Postgres    | Postgres wire | 5432    | **Plaintext**, `sslmode=disable`                    | scram-sha-256                        | Compose network                                | Everything                                                                          |
|   5 | web/worker → Redis       | RESP          | 6379    | **Plaintext**                                       | **None**                             | Compose network                                | Queue payloads (contain `tenantId`, record ids), rate-limit counters, cached actors |
|   6 | web/worker → MinIO       | HTTP S3       | 9000    | **Plaintext**                                       | AWS SigV4                            | Compose network                                | Recordings, HR documents, payslips, biometric captures                              |
|   7 | web → clamav             | INSTREAM      | 3310    | **Plaintext**                                       | **None**                             | Compose network                                | Uploaded file bytes                                                                 |
|   8 | web → face               | HTTP          | 8000    | **Plaintext**                                       | Shared secret header, constant-time  | Compose network                                | Camera frames → biometric vectors                                                   |
|   9 | web/worker → Gemini      | HTTPS         | 443     | TLS                                                 | API key in the query string          | **Egress**                                     | Redacted transcripts and prompts                                                    |
|  10 | worker → SMTP relay      | SMTP          | 587/465 | STARTTLS or implicit TLS; **no plaintext fallback** | User/password                        | **Egress**                                     | Notification and reset mail                                                         |
|  11 | web → Meta Graph         | HTTPS         | 443     | TLS                                                 | OAuth token per tenant               | **Egress**                                     | Lead form reads, WhatsApp sends                                                     |
|  12 | web → telephony vendor   | HTTPS         | 443     | TLS                                                 | Vendor credential per tenant         | **Egress**                                     | Call control, recording fetch                                                       |
|  13 | Telephony vendor → Caddy | HTTPS         | 443     | TLS                                                 | Key in the path or header, then HMAC | **Public inbound**                             | Call events                                                                         |
|  14 | Meta → Caddy             | HTTPS         | 443     | TLS                                                 | Key in the path, then signature      | **Public inbound**                             | Lead and message events                                                             |
|  15 | Prometheus → web         | HTTP          | 3000    | **Plaintext**                                       | `METRICS_TOKEN` bearer               | Compose network **only** — Caddy 404s the path | Route map, rates, queue depths                                                      |

### 7.2 Diagram

```mermaid
flowchart TB
  subgraph internet["Internet — untrusted"]
    B["Browsers"]
    TV["Telephony vendors"]
    MT["Meta"]
  end

  DNS["DNS · A record → VM public IP<br/>(registrar UNKNOWN / NOT FOUND)"]

  subgraph vm["Single VM — the trust boundary"]
    subgraph pub["Published"]
      CAD["Caddy 2<br/>:80 ACME + redirect · :443 TLS<br/>blocks /api/metrics"]
      MC["MinIO console :9001<br/>127.0.0.1 only — SSH tunnel"]
    end
    subgraph priv["Compose network — nothing published"]
      WEB["web :3000"]
      WRK["worker (no HTTP surface)"]
      PGX[("Postgres :5432")]
      RDX[("Redis :6379 — no AUTH")]
      MIN[("MinIO :9000")]
      CLM["clamav :3310"]
      FCE["face :8000"]
    end
  end

  subgraph egress["Egress only"]
    GEM["Google Gemini"]
    SMTP["SMTP relay"]
    META["Meta Graph API"]
    TEL["Telephony APIs"]
  end

  B -->|HTTPS 443| DNS --> CAD
  TV -->|webhook| CAD
  MT -->|webhook| CAD
  CAD -->|HTTP 3000, plaintext| WEB
  WEB --> PGX & RDX & MIN & CLM & FCE
  WRK --> PGX & RDX & MIN
  RDX -.jobs.-> WRK
  WEB --> GEM & META & TEL
  WRK --> GEM & SMTP
```

### 7.3 What the picture shows

- **One public ingress.** Ports 80 and 443 on one Caddy. Nothing else is
  reachable from the internet — verified by rendering the production Compose
  configuration, which publishes exactly `0.0.0.0:80`, `0.0.0.0:443` and
  `127.0.0.1:9001`.
- **Everything behind the edge is plaintext.** Rows 3–8 above. On a single host
  the traffic never leaves the kernel's loopback and bridge interfaces, which is
  a real mitigation — and it is also the assumption that breaks first when
  anything moves to a second machine.
- **Redis has no password.** `requirepass` is not set in any Compose file. On the
  Compose network that is the same argument as above; it is the weakest instance
  of it, because Redis carries queue payloads and cached actor permissions.
  _Closed since this assessment: every Compose file sets `--requirepass`,
  including the development one, and the two deployment overlays require a real
  value rather than defaulting. CI gate 3d fails the build if a file drops it or
  if an env file's `REDIS_URL` stops matching its `REDIS_PASSWORD`._

---

## 8. Network configuration

Every port below was read from a **rendered** Compose configuration
(`docker compose config`), not from the source YAML, so overlay merges and
`!reset` / `!override` tags are resolved.

### LOCAL DEVELOPMENT

`infra/docker-compose.yml` alone. The application runs on the host
(`npm run dev`), infrastructure runs in Docker.

| Service                | Binding                                   | Notes                                                    |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------- |
| postgres               | `127.0.0.1:5432`                          | scram-sha-256                                            |
| redis                  | `127.0.0.1:6379`                          | no AUTH                                                  |
| minio                  | `127.0.0.1:9000` (API), `:9001` (console) |                                                          |
| mailpit                | `127.0.0.1:1025` (SMTP), `:8025` (UI)     | nothing leaves the machine                               |
| clamav                 | `127.0.0.1:3310`                          |                                                          |
| face                   | `127.0.0.1:8081` → 8000                   | `FACE_SERVICE_ENV=development`; token optional here only |
| web (if containerised) | `127.0.0.1:3000`                          |                                                          |

**Every binding is loopback.** `APP_URL=http://localhost:3000`. Cookies are not
`secure` (`NODE_ENV !== production`), which is required for HTTP localhost.

### STAGING

`base + prod + staging`, Compose project `master-suite-staging`.

| Service                          | Binding                 | Notes                                                                        |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| caddy                            | `127.0.0.1:8080` → 80   | **Plain HTTP, `auto_https off`, no public name.** Reached over an SSH tunnel |
| postgres                         | `127.0.0.1:5433` → 5432 | Published only so the production migrate gate can read this ledger           |
| mailpit                          | `127.0.0.1:8026` → 8025 | Staging deliberately does not send real mail                                 |
| minio                            | `127.0.0.1:9002` → 9001 | Console only                                                                 |
| web, worker, redis, clamav, face | not published           |                                                                              |

`APP_URL=http://localhost:8080`. Database `leadflow_staging` — the `_staging`
suffix is load-bearing: `startup-check.ts` refuses to boot unless `APP_ENV` says
`staging`.

### PRODUCTION

`base + prod + azure`.

| Service         | Binding                     | Notes                                    |
| --------------- | --------------------------- | ---------------------------------------- |
| caddy           | `0.0.0.0:80`, `0.0.0.0:443` | The only public listeners                |
| minio           | `127.0.0.1:9001`            | Console, over an SSH tunnel              |
| everything else | not published               | `docker compose exec` for administration |

| Setting               | Value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                | `${APP_DOMAIN}` from `.env.production` — required, `:?`                                                                                 |
| TLS                   | Caddy automatic, ACME HTTP-01, so :80 must reach the container                                                                          |
| HSTS                  | `max-age=63072000; includeSubDomains; preload`                                                                                          |
| Reverse proxy         | Caddy → `web:3000`, adds `X-Real-IP`                                                                                                    |
| Body cap              | 32 MB at Caddy; `UPLOAD_MAX_MB` (25) in the application                                                                                 |
| `/api/metrics`        | `respond 404` at the edge — reachable only inside the network                                                                           |
| CDN                   | **NOT PRESENT.** Static assets are served by the standalone Next server through Caddy                                                   |
| Load balancer         | **NOT PRESENT.** One container                                                                                                          |
| WAF                   | **NOT PRESENT**                                                                                                                         |
| Firewall (host/cloud) | **UNKNOWN / NOT FOUND.** No NSG, security-group or `ufw` configuration in the repository                                                |
| IP restrictions       | **NOT PRESENT** for the application. `TRUSTED_PROXY_CIDRS` is about trusting a proxy's `X-Forwarded-For`, not about restricting callers |
| Kubernetes            | **NOT PRESENT**                                                                                                                         |

### CORS

**No CORS headers are set anywhere in the codebase.** No
`Access-Control-Allow-Origin`, no cors middleware. This is correct for the
architecture: the browser and the API are the same origin, so no preflight ever
occurs, and the absence of a permissive header is a security property rather than
an omission. It does mean **no third-party browser client can call this API** —
if that is ever wanted it is a design decision, not a configuration change.

### Cookies

| Cookie       | Flags                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| `lf_session` | `httpOnly`, `sameSite=lax`, `secure` when `NODE_ENV=production`, path `/` |

### Security headers

From `next.config.ts` (static) and `src/proxy.ts` (per-request CSP):

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(self), microphone=()
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
  font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';
  object-src 'none'; base-uri 'self'; form-action 'self';
  upgrade-insecure-requests
```

`X-Frame-Options` is absent, superseded by `frame-ancestors 'none'`.
`script-src 'unsafe-inline'` is the one real gap — see M-1.

### Rate limits

Twelve named buckets in `src/lib/security/ratelimit.ts`, counted in Redis:

| Bucket               | Limit                                |
| -------------------- | ------------------------------------ |
| `loginPerIp`         | 10 / 15 min                          |
| `loginPerAccount`    | 5 / 15 min                           |
| `sessionUser`        | 1,200 / min                          |
| `apiKey`             | `API_RATE_LIMIT_PER_MIN` (600) / min |
| `publicForm`         | 5 / min per IP                       |
| `exportCreate`       | 10 / hour                            |
| `mfaConfirm`         | 10 / 5 min                           |
| `inviteLookup`       | 30 / 10 min per IP                   |
| `passwordResetPerIp` | 20 / hour                            |
| `passwordReset`      | 3 / hour per address                 |
| `webhook`            | 600 / min per integration key        |

### WebSockets

**NOT PRESENT.** No WebSocket endpoint, no Socket.IO, no SSE route. The live
dialer and live coach surfaces poll.

---

## 9. Cloud / infrastructure architecture

### 9.1 What the evidence actually supports

| Platform                            | Evidence                                                                                                                           | Verdict                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Docker / Compose**                | Five Compose files, a five-stage Dockerfile, `infra/systemd/`                                                                      | **Present and primary**                                                            |
| **Azure**                           | `docs/DEPLOY-AZURE.md`, `docker-compose.azure.yml`, `az storage blob upload-batch` in the backup runbook, `S3_REGION=me-central-1` | **Targeted**, as a plain VM. Nothing uses an Azure SDK, ARM template or Bicep file |
| **Caddy**                           | `infra/Caddyfile`, `Caddyfile.staging`                                                                                             | **Present**                                                                        |
| AWS                                 | `@aws-sdk/client-s3` — used as an **S3 protocol client against MinIO**                                                             | **Not an AWS deployment**                                                          |
| GCP                                 | `generativelanguage.googleapis.com` for Gemini                                                                                     | **API consumer only**                                                              |
| Kubernetes                          | —                                                                                                                                  | **NOT FOUND**                                                                      |
| Vercel / Netlify / Railway / Render | —                                                                                                                                  | **NOT FOUND**                                                                      |
| Cloudflare                          | —                                                                                                                                  | **NOT FOUND**                                                                      |
| Nginx / Apache                      | —                                                                                                                                  | **NOT FOUND** (Caddy instead)                                                      |
| Terraform / Pulumi / Bicep          | —                                                                                                                                  | **NOT FOUND** — there is no infrastructure-as-code                                 |

### 9.2 Infrastructure diagram

```mermaid
flowchart TB
  subgraph ops["Operator"]
    GH["GitHub · 19 CI gates"]
    SSH["SSH to the VM"]
  end

  subgraph vm["One Linux VM — docs/DEPLOY-AZURE.md sizes it 4 vCPU / 16 GB"]
    subgraph sys["systemd"]
      T1["master-suite-backup.timer · 02:30"]
      T2["master-suite-restore-verify.timer · Sun 04:00"]
      T3["master-suite-backup-status.timer · 09:00"]
    end
    subgraph proj["Compose project: production"]
      CAD["caddy"] --> WEB["web"]
      WRK["worker ×2"]
      PG[("postgres + pgdata volume")]
      RD[("redis + redisdata")]
      MI[("minio + miniodata")]
      CL["clamav + clamavdb"]
      FA["face + facemodels"]
      AT[("attendance volume — biometric captures")]
    end
    subgraph proj2["Compose project: master-suite-staging"]
      S["own postgres, redis, minio, caddy on 127.0.0.1:8080"]
    end
    BK["/var/backups/master-suite<br/>encrypted, 30-day retention"]
  end

  OFF["Off-host copy<br/>az storage blob upload-batch — MANUAL"]

  GH -.->|"git pull, no deploy trigger"| SSH --> proj
  T1 --> BK --> OFF
  T2 --> BK
```

| Layer      | What it is                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Compute    | One VM, Docker Compose. `deploy.replicas: 2` for the worker                                    |
| Database   | Self-hosted Postgres 16 in a container, on a named volume                                      |
| Storage    | Self-hosted MinIO in a container, on a named volume                                            |
| Networking | One Docker bridge per Compose project                                                          |
| DNS        | An A record to the VM. Registrar and zone **UNKNOWN / NOT FOUND**                              |
| SSL/TLS    | Caddy + Let's Encrypt, HTTP-01                                                                 |
| Secrets    | `.env.production` mode 600 on the VM; any key may instead be read from a file via `<KEY>_FILE` |
| Deployment | `scripts/release.sh` — commit-tagged images, promotion from staging, one-command rollback      |
| CI         | GitHub Actions, 19 gates. **No CD** — nothing deploys automatically                            |

### 9.3 Backups

|              |                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| What         | `pg_dump -Fc` **and** an `mc mirror` of the bucket, plus a manifest with checksums and row counts                                    |
| Encryption   | AES-256 via gpg; the scheduled unit **refuses to run** without a passphrase                                                          |
| Schedule     | systemd timers, `Persistent=true` so a missed window runs at next boot                                                               |
| Retention    | 30 days, pruned by the script, with a floor of three kept whatever their age                                                         |
| Verification | Weekly restore into a scratch database, six checks, then dropped                                                                     |
| Freshness    | A daily check that fails when the newest complete backup is over 48 h old — the only signal that catches a timer that stopped firing |
| Off-host     | **Manual.** The runbook gives the `az storage blob upload-batch` line; nothing runs it                                               |

### 9.4 Connection pooling

`infra/docker-compose.pgbouncer.yml` ships an opt-in PgBouncer in
`pool_mode = transaction`. Revision 1 recorded this as blocked on design work,
believing transaction pooling incompatible with the RLS approach. **That was
wrong**: `set_config(…, true)` is transaction-local, and a transaction pooler
pins one server connection for a transaction's duration, so the setting lands and
expires on the same connection. Verified by running the entire test suite through
PgBouncer 1.22 in transaction mode — all passed — and by demonstrating that the
_session_-level variant does leak, so the assertion is capable of failing.

---

## 10. AI architecture

### 10.1 Provider and model

**Google Gemini, over plain REST.** No SDK:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…
```

The model is **configurable per workspace**, falling back to `GEMINI_MODEL` and
then to `gemini-flash-latest` — a deliberate response to Google retiring model
ids on its own schedule.

### 10.2 Credential model

`geminiCredential()` returns one of three shapes, and the distinction drives both
billing and cost control:

| Source       | Meaning                            | Metered | Capped                                          |
| ------------ | ---------------------------------- | ------- | ----------------------------------------------- |
| `workspace`  | The tenant connected their own key | Yes     | **No** — their quota, their bill                |
| `deployment` | The platform's shared key          | Yes     | **Yes** — `ai_tokens_monthly` plan limit        |
| `simulated`  | No key at all                      | No      | n/a — labelled output, never passed off as real |

### 10.3 Flow

```mermaid
flowchart TB
  A["Call completes / user asks"] --> B["enqueue('ai', …) — job id = hash(payload)"]
  B --> C["ai worker · concurrency 6"]
  C --> D{"tenant already holds<br/>2 of 6 slots?"}
  D -->|yes| E["moveToDelayed + DelayedError<br/>counted as masterapp_queue_deferred_total"] --> C
  D -->|no| F["claimAnalysis — compare-and-swap<br/>so two clicks bill once"]
  F --> G["consent check — RecordingConsent"]
  G --> H["redact() — email, card (Luhn), phone,<br/>long digit runs, and numbers spoken as words"]
  H --> I["assertAiBudget — deployment key only"]
  I --> J["Gemini generateContent<br/>schema-constrained JSON"]
  J --> K["recordAiUsage → WorkspaceUsage ai_tokens:YYYY-MM"]
  K --> L{"human corrected<br/>any field?"}
  L -->|yes| M["write everything except those fields<br/>rawOutput keeps the model's full answer"]
  L -->|no| N["write all fields"]
  M & N --> O["AIAnalysis · notify the caller"]
  O --> P{"workspace has an<br/>active scorecard?"}
  P -->|yes| Q["enqueue('ai','audit')"]
```

### 10.4 What is sent, and what is not

`src/lib/ai/redact.ts` runs at the trust boundary and replaces matches with
**typed** placeholders (`[REDACTED_CARD]`, not `***`) so the model can still
summarise that a card was discussed:

| Rule               | Detail                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET`           | API-key-shaped strings, first so the digit rules cannot eat a prefix                                                                                                 |
| `EMAIL`            | —                                                                                                                                                                    |
| `CARD`             | 13–19 digits **passing Luhn**, so a 16-digit order reference survives                                                                                                |
| `PHONE`            | 8–15 digits with lookarounds, so a window inside a longer number is not partly redacted                                                                              |
| `NUMBER`           | Any remaining run of 9+ digits                                                                                                                                       |
| **Spoken numbers** | Runs of digit-words ("four two four two …"), ≥ 8 digits, understanding `double`/`triple`, and deliberately **not** treating "a hundred and fifty thousand" as digits |

The original transcript stays in the `Transcript` row, which is access-controlled
and swept by retention. Redaction is not reversible and does not rewrite the
record — the span is replaced where it stands.

### 10.5 Cost controls

| Control                        | Where                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| Per-workspace token accounting | `WorkspaceUsage` under `ai_tokens:YYYY-MM`                     |
| Monthly ceiling                | `PlanLimit` key `ai_tokens_monthly`, deployment key only       |
| Concurrency                    | 6 global, 2 per tenant                                         |
| Platform spend curve           | `masterapp_ai_tokens_total{feature,key_source}`                |
| Alert                          | `AiSpendSpiking` — shared key over 100k tokens/hour for 30 min |

### 10.6 What is **not** implemented

- **Lead scoring has no engine.** `ScoringRule` and `LeadScoreHistory` exist in
  the schema; **zero TypeScript files reference `ScoringRule`**. Lead lists order
  by a `score` column nothing computes.
- **Streaming** — every AI call is request/response.
- **Embeddings, vector search, RAG** — none.
- **Prompt-injection defence** for the assistant relies on the tools running the
  caller's own permissions rather than on input filtering. That is the right
  primary control; there is no secondary one.

---

## 11. Data flow analysis

### 11.1 Lead creation

```mermaid
sequenceDiagram
  participant SRC as "Source: form / Meta / manual / import"
  participant API as "POST /api/v1/leads (kernel)"
  participant SVC as services/leads/createLead
  participant DB as PostgreSQL
  participant Q as Redis queues
  participant W as worker
  participant A as Agent

  SRC->>API: payload
  API->>API: authn → limit → leads:CREATE → zod
  API->>SVC: input + ctx
  SVC->>DB: findDuplicates(email, phoneNormalized, fullName)
  alt duplicate and onDuplicate=BLOCK
    SVC-->>API: 409 with the existing reference
  end
  SVC->>DB: withTx(tenantId)
  DB->>DB: nextReference → UPDATE TenantReferenceCounter RETURNING
  DB->>DB: INSERT Lead (LD-000142) + Activity + AuditLog
  SVC->>Q: enqueue('distribution') when unowned
  Q->>W: assign by rule / round-robin / capacity
  W->>DB: Lead.ownerId, assignedAt, LeadAssignmentHistory
  W->>Q: enqueue('notifications')
  Note over DB: AI scoring does NOT happen — no engine exists
  A->>DB: works the lead → FollowUpTask → Opportunity
```

The public-form path (`/api/v1/public/forms`) differs deliberately: a duplicate
**attaches** to the existing lead rather than answering 409, because "that email
is already known to us" is an enumeration oracle when the caller is a stranger.

### 11.2 Call analysis

```mermaid
sequenceDiagram
  participant V as Telephony vendor
  participant WH as "POST /api/v1/webhooks/telephony/{key}"
  participant Q as Redis
  participant M as media worker
  participant S3 as MinIO
  participant AI as ai worker
  participant G as Gemini
  participant DB as PostgreSQL

  V->>WH: call.completed + recording URL
  WH->>WH: rate limit by key, THEN resolve integration, THEN verify HMAC
  WH->>DB: Call, WebhookEvent
  WH->>Q: enqueue('media','ingest')
  M->>V: fetch the recording
  M->>S3: putObject → Recording{storageKey, storageBucket, retainUntil}
  M->>Q: enqueue('ai','transcribe')
  AI->>DB: consent check (RecordingConsent)
  AI->>AI: transcribe → Transcript
  AI->>Q: enqueue('ai','analyse')
  AI->>AI: per-tenant slot · redact · assertAiBudget
  AI->>G: generateContent (schema-constrained)
  G-->>AI: summary, needs, objections, buying signals, risks, next steps
  AI->>DB: AIAnalysis (skipping any human-corrected field)
  AI->>DB: notify the caller
  AI->>Q: enqueue('ai','audit') if a scorecard exists
```

### 11.3 Employee / HR workflow

```mermaid
flowchart LR
  E["Employee"] --> L["Sign in · MFA if privileged"]
  L --> CI["Check-in"]
  CI --> F["face sidecar<br/>frames → embedding, shared-secret header"]
  CI --> G["GPS · MAX_GPS_ACCURACY_M"]
  F & G --> P["HrAttendancePunch + capture on the attendance volume"]
  P --> R["HrAttendanceRecord"]
  R --> OT["Overtime request → approval"]
  R --> PR["Payroll run: calculate → submit → approve → WPS SIF"]
  E --> T["Tasks · Targets · TargetProgress"]
  T --> PF["Performance review"]
  P & R & PF --> D["Management dashboards + reports (read replica)"]
```

Two things about this flow are worth naming. **Attendance fails closed**: with no
`FACE_SERVICE_TOKEN` the service refuses to start, and the attendance path
answers 503 naming what is missing rather than waving anybody through. And
**payroll is two-person**: `submitRun` and `approveRun` are separate permissions,
and only an approved run can be exported to a bank.

### 11.4 SaaS / provisioning workflow

```mermaid
sequenceDiagram
  participant PO as Platform owner
  participant PC as "Platform console"
  participant DB as PostgreSQL

  PO->>PC: create workspace
  PC->>DB: withPlatformTx — Tenant, TenantSubscription, ModuleEntitlement, WorkspaceUsage seeds
  PC->>DB: seed-role-defaults — Role + RolePermission from the catalogue
  PC->>DB: WorkspaceInvitation for the first admin (hashed token)
  Note over PC,DB: PlatformAuditEvent for every step
  PO->>PC: open the workspace (read-only)
  PO->>PC: break-glass grant — reason + ≤4h — only if a write is needed
```

Entitlement is checked on **every** request (`assertModuleEntitlement`, cached 60
seconds in Redis), so cancelling a module stops working within the minute rather
than at the next sign-in.

---

## 12. Security architecture

### 12.1 Findings

#### 🟢 Good — the controls that are genuinely strong

|     | Finding                                                                                                                                                                                                      | Evidence                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| G1  | **Three-layer tenant isolation, verified in CI.** Repository, Prisma extension, `FORCE RLS` on 173 tables. `check-rls.mjs` reads the live catalog on every push                                              | `src/lib/db.ts`, `scripts/check-rls.mjs`, CI gate              |
| G2  | **The process refuses to boot unsafely.** Superuser DB role, mock providers in production, empty or `none` trusted-proxy list, an `APP_ENV` that disagrees with the database name — each is a fatal at start | `src/lib/startup-check.ts`                                     |
| G3  | **No JWT.** Opaque 256-bit tokens, SHA-256 at rest, revocable now                                                                                                                                            | `src/lib/auth/session.ts`                                      |
| G4  | **Rotation detects theft.** Replaying a rotated token revokes every session for that user                                                                                                                    | `api/v1/auth/refresh`                                          |
| G5  | **No token in JavaScript.** httpOnly cookie only; a single XSS does not hand over a credential                                                                                                               | `src/lib/auth/client.ts`                                       |
| G6  | **argon2id at OWASP's floor**, with a 24-entry reuse history and a maximum age                                                                                                                               | `lib/auth/password.ts`, `services/identity/passwordHistory.ts` |
| G7  | **MFA cannot be skipped by privileged roles** — the layout redirects until enrolled                                                                                                                          | `(workspace)/[workspaceSlug]/layout.tsx`                       |
| G8  | **Egress redaction before any model call**, including numbers spoken as words                                                                                                                                | `src/lib/ai/redact.ts`                                         |
| G9  | **Uploads are scanned** (clamd INSTREAM) and the antivirus path **fails closed**                                                                                                                             | `src/lib/antivirus.ts`                                         |
| G10 | **Field-level security applies to exports**, so an export is not a way around masking                                                                                                                        | `api/v1/leads/export`, `lib/csv.ts`                            |
| G11 | **Platform write into a tenant is break-glass**, reasoned, ≤4h, on the customer's audit trail                                                                                                                | `lib/auth/platform-access.ts`                                  |
| G12 | **Rate limiting cannot be forgotten** on the streaming routes                                                                                                                                                | `lib/api/guarded.ts`                                           |
| G13 | **Secrets may come from files** rather than the environment, which is what a secret manager mounts                                                                                                           | `lib/env.ts` `<KEY>_FILE`                                      |
| G14 | **Every input is zod-validated** at the kernel, `.strict()` on bodies                                                                                                                                        |
| G15 | **SQL injection is structurally excluded** — Prisma parameterises; the four raw-SQL sites use placeholders and table names from a code-side map, never from a caller                                         |

#### 🟡 Medium

|     | Finding                                                                                                                                                                                                                                                     | Impact                                                                                                          | Recommendation                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M-1 | **`script-src 'unsafe-inline'`.** Next 16.2.12 does not stamp nonces onto script tags in a production build; a nonce makes browsers ignore `'unsafe-inline'` entirely, so the app renders and does nothing. Verified in a browser (`tests/e2e/csp.spec.ts`) | XSS is not contained by CSP. The mitigation is React's escaping plus no `dangerouslySetInnerHTML` in user paths | Blocked on framework support or a build step that hashes the inline bootstrap. Re-test on each Next upgrade |
| M-2 | **`FIELD_MAP` in `filterTree.ts` registers only `LEAD`.** Every other list route 400s on `filter` for every caller                                                                                                                                          | A documented API feature does not work                                                                          | Register the remaining resources, or remove `filter` from those routes' contracts                           |
| M-3 | **Three declared queues have no consumer** (`messaging`, `import`, `export`)                                                                                                                                                                                | A job enqueued to them is never run. Nothing enqueues to them today, so this is latent                          | Delete them, or build the consumers                                                                         |
| M-4 | **Break-glass has no UI.** The API exists; the platform console has no button                                                                                                                                                                               | An owner needing a write must call the API by hand, which is the kind of friction that gets a control removed   | Add the control to the workspace-open screen                                                                |
| M-5 | ~~**Redis has no AUTH.** `requirepass` is unset in every Compose file~~ **Closed** — set in every stack, and required rather than defaulted in both deployment overlays | On one host, contained by the bridge network. It carries queue payloads and cached actor permissions            | Set `requirepass`; it is one line and one URL change                                                        |
| M-6 | **Intra-VM traffic is plaintext** — Caddy→web, →Postgres, →Redis, →MinIO, →clamav, →face                                                                                                                                                                    | Contained today by everything being on one host                                                                 | Required before anything moves to a second machine                                                          |
| M-7 | **Face service authentication is a shared header secret** with no rotation path                                                                                                                                                                             | A leaked token is a biometric engine open to anything on the network                                            | Rotate on a schedule; consider mTLS when the sidecar leaves the host                                        |
| M-8 | **`next.config.ts` documents a CSP nonce and a `src/middleware.ts` that do not exist** — the file is `src/proxy.ts` and it deliberately has no nonce                                                                                                        | A reader auditing the CSP is told the opposite of the truth                                                     | One-line comment fix                                                                                        |

#### 🔵 Low

|     | Finding                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| L-1 | No CSRF token. `SameSite=Lax` covers the classic case; latent if a subdomain is ever added                                        |
| L-2 | ~~`Tenant.dataRegion` is written by the seed and read by nothing~~ **Closed** — dropped; the system does not do per-tenant residency and the column implied it did |
| L-3 | Two 1,000-line HR dispatch routes (`hr/[resource]`, `hr/actions/[action]`) — now type-safe via total permission maps, still large |
| L-4 | The WPS SIF layout is one bank's dialect; `SIF_LAYOUTS` is versioned but holds one entry                                          |
| L-5 | No `X-Frame-Options` — superseded by `frame-ancestors 'none'`, so this is informational                                           |

#### 🟠 High / 🔴 Critical

**None.** Revision 1's high and critical findings — the unrunnable worker, the
silently-failing retention sweep, the `trust`-authenticated database published on
`0.0.0.0`, uncapped AI spend — are all fixed. What remains at high severity is
architectural rather than a defect: see W-1.

### 12.2 Assessment by category

| Category              | Verdict                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication        | 🟢 Strong. Opaque tokens, theft detection, argon2id, TOTP, lockout, timing equalisation                                                           |
| Authorization         | 🟢 Strong. Four dimensions, total permission maps, cached with immediate invalidation                                                             |
| Tenant isolation      | 🟢 Strongest part of the system, and now CI-verified                                                                                              |
| API security          | 🟢 96% of routes behind one of three audited prologues                                                                                            |
| Input validation      | 🟢 zod at the kernel, `.strict()`                                                                                                                 |
| SQL injection         | 🟢 Structurally excluded                                                                                                                          |
| XSS                   | 🟡 React escaping is the real control; CSP does not contain it (M-1)                                                                              |
| CSRF                  | 🔵 `SameSite=Lax` only (L-1)                                                                                                                      |
| CORS                  | 🟢 No permissive header exists                                                                                                                    |
| SSRF                  | 🟡 The media worker fetches a vendor-supplied recording URL. The URL comes from a signed webhook, which is the mitigation; there is no allow-list |
| File upload           | 🟢 clamd scan, fails closed, size cap at two layers                                                                                               |
| Secrets               | 🟢 Never in the image (`.env*` dockerignored), mode 600 on the VM, `_FILE` supported, boot check rejects placeholders and low entropy             |
| Encryption at rest    | 🟡 Application-level AES-256-GCM for sensitive columns. **Disk encryption is UNKNOWN / NOT FOUND**                                                |
| Encryption in transit | 🟡 TLS at the edge, plaintext behind it (M-6)                                                                                                     |
| Audit                 | 🟢 `AuditLog` per tenant, `PlatformAuditEvent` for the control plane, `NEVER_LOG` field guard                                                     |
| Rate limiting         | 🟢 12 buckets, and unforgettable on the streaming routes                                                                                          |
| Brute force           | 🟢 Per-IP and per-account, lockout, timing equalisation                                                                                           |

---

## 13. Deployment architecture

### 13.1 Build

```mermaid
flowchart LR
  D["deps · npm ci"] --> B["build · prisma generate + next build<br/>throwaway env values; .env* dockerignored"]
  B --> P["production · standalone server<br/>USER leadflow uid 1001<br/>ARG GIT_SHA → ENV BUILD_COMMIT"]
  B --> W["worker · src/ + node_modules + tsx<br/>same stamp"]
  B --> M["migrate · one-off, has the Prisma CLI"]
  D --> DV["development · dev server, source by bind mount"]
```

The `build` stage supplies throwaway `APP_URL`, `DATABASE_URL`, `REDIS_URL`,
`S3_*` and two freshly-generated 32-byte keys, because `next build` evaluates
`lib/env.ts` while collecting page data. The keys are generated **per build**, so
an image cannot ship a known encryption key.

### 13.2 Release

```bash
scripts/release.sh staging       # build this commit, migrate, start
#   exercise it
scripts/release.sh production    # promote the tag staging is running
scripts/release.sh rollback production
scripts/release.sh status
```

| Property          | How                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact identity | `master-suite/web:<commit>` and `…/worker:<commit>`                                                                                                                                   |
| Promotion         | Production takes **the tag staging is running** and starts that image — the same bytes, not a rebuild of the same source                                                              |
| Migration order   | Migrations run **before** the new image starts (correct for additive; unsafe for a drop or rename, and the runbook says so)                                                           |
| Staging-first     | `scripts/check-staging-first.mjs` refuses any pending migration not already finished in staging **with the same checksum** — which also catches a migration rehearsed and then edited |
| Rollback          | Starts the previous tag. No rebuild, no registry. Reversible. **Deliberately does not roll the database back**                                                                        |
| Dirty-tree guard  | Refuses to build from a dirty tree — the tag would name a commit the image does not contain                                                                                           |
| Tree/tag guard    | Refuses to deploy tag X while the tree is at Y, because migrations come from the tree                                                                                                 |
| What is running   | `masterapp_build_info{commit,built_at,role}` on the metrics endpoint                                                                                                                  |

### 13.3 CI — 19 gates

`Install → generate .env → export RLS URL → migrate → schema drift → tenant
isolation (check-rls) → seed → typecheck → lint → format → README counts →
vitest (a skipped test fails) → integration server → Playwright → build → npm
audit`.

**There is no CD.** Nothing deploys on merge; `scripts/release.sh` is run by hand
over SSH.

### 13.4 Health

| Endpoint           | Purpose                  | Checks                                                                                                                                          |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health/live` | Liveness / restart probe | **Nothing**, deliberately — a liveness probe that checks dependencies teaches the orchestrator to kill healthy processes during a database blip |
| `/api/health`      | Readiness                | Postgres `SELECT 1`, Redis `PING`, each under 2 s. Returns 503 with `{database, redis}`. Never versions or hostnames                            |
| `/api/metrics`     | Prometheus scrape        | Token-gated, 404 without                                                                                                                        |

The Dockerfile `HEALTHCHECK` and the prod overlay both point at `/live`, which is
the correct pairing.

---

## 14. Third-party integrations

| Integration               | Purpose                                                | Direction | Authentication                                                     | Data                                   | Status                                                                 |
| ------------------------- | ------------------------------------------------------ | --------- | ------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------- |
| **Google Gemini**         | Transcript analysis, call audit, assistant, live coach | Outbound  | API key in the query string; per-workspace or deployment           | Redacted transcripts, campaign context | **Real, metered, capped**                                              |
| **Meta Graph API**        | Lead-form ingestion, WhatsApp Cloud sends              | Both      | OAuth per tenant; inbound webhook signature-verified               | Lead payloads, messages                | **Real**                                                               |
| **Twilio**                | Telephony                                              | Both      | Vendor credential per tenant; inbound HMAC                         | Call control, recordings               | **Real adapter**                                                       |
| **Plivo**                 | Telephony                                              | Both      | As above                                                           | As above                               | **Real adapter**                                                       |
| **Exotel**                | Telephony                                              | Both      | As above                                                           | As above                               | **Real adapter**                                                       |
| **Knowlarity**            | Telephony                                              | Both      | As above                                                           | As above                               | **Real adapter**                                                       |
| **Generic HMAC gateway**  | Telephony, any vendor that can send a header           | Inbound   | `x-integration-key` + HMAC                                         | Call events                            | **Real**                                                               |
| **SMTP (nodemailer)**     | Password resets, invitations, notifications            | Outbound  | User/password, STARTTLS or implicit TLS, **no plaintext fallback** | Mail bodies                            | **Real**                                                               |
| **Mailpit**               | Local and staging mailbox                              | Outbound  | None (loopback)                                                    | Mail bodies                            | **Real, for non-production**                                           |
| **MinIO (S3)**            | Recordings, HR documents, payslips, exports            | Both      | SigV4                                                              | Customer files                         | **Real**                                                               |
| **ClamAV**                | Upload scanning                                        | Outbound  | None (network-local)                                               | File bytes                             | **Real**                                                               |
| **face sidecar**          | Attendance face match                                  | Outbound  | Shared-secret header, constant-time                                | Camera frames → vectors                | **Real**                                                               |
| **Let's Encrypt**         | TLS                                                    | Outbound  | ACME account                                                       | Domain validation                      | **Real**                                                               |
| **Azure Blob Storage**    | Off-host backup destination                            | Outbound  | `az` CLI on the VM                                                 | Encrypted backup archives              | **Documented, manual**                                                 |
| **SMS**                   | —                                                      | —         | —                                                                  | —                                      | **NO ADAPTER.** `switch` has a `mock` case and a commented vendor slot |
| **E-signature**           | —                                                      | —         | —                                                                  | —                                      | **NO ADAPTER.** Same shape                                             |
| **Payment provider**      | Billing                                                | —         | —                                                                  | —                                      | **NOT PRESENT.** No Stripe, no checkout, nothing charges anybody       |
| **Transcription vendors** | Google / Deepgram / Whisper cases exist                | Outbound  | Per-provider                                                       | Audio                                  | **Cases present**; the default path is Gemini                          |

`SMS_PROVIDER`, `ESIGNATURE_PROVIDER` and `AI_PROVIDER` are checked at boot only
to reject the literal `mock`. Any other value passes and then throws
`Unknown provider` the first time the feature is used — so those two features are
**unavailable, not merely unconfigured**, and `.env.production.example` sets them
to `unconfigured` to make that visible.

---

## 15. Architecture diagrams

The ten requested diagrams are inline where they belong rather than collected
here: system (§1.1), network (§7.2), frontend (§3.2), backend dependency (§4.3),
ER (§5.3), multi-tenancy (§5.1), authentication (§6.5), lead lifecycle (§11.1),
AI (§10.3), deployment/build (§13.1) and infrastructure (§9.2).

---

## 16. Architectural strengths

Concrete, with the evidence.

**1 · Tenant isolation is defence in depth that is actually independent.** Most
"three layers" claims are one control described three ways. Here, layer 2 throws
before the query is sent and layer 3 would refuse it if layer 2 were removed —
demonstrated by the retention bug, where raw SQL bypassed the guard and Postgres
silently returned nothing rather than another tenant's rows. The failure mode was
_too little data_, which is the right direction to fail.

**2 · The boot check refuses to serve a misconfiguration.** `startup-check.ts`
kills the process for a superuser database role, a mock provider in production,
an undeclared reverse proxy, or an `APP_ENV` that disagrees with the database
name. Most systems discover these at the first request that needs them.

**3 · Comments explain the decision, not the code.** Nearly every non-obvious
line carries why the obvious alternative was rejected — why `set_config(…, true)`
and not `false`, why the liveness probe checks nothing, why `csvCell` prefixes an
apostrophe and why the WPS export must _not_. This is the single biggest reason
the codebase is auditable at 121k lines.

**4 · Failure modes are chosen deliberately and stated.** Antivirus fails closed.
Attendance without a face token answers 503 naming what is missing. The fairness
slot allocator fails _open_, because a queue that stops draining when bookkeeping
is unavailable trades a fairness problem for an outage. Each of those is argued in
place.

**5 · The queue layer is idempotent by construction.** `enqueue()` derives the
job id from a hash of the payload, so a double click or a replayed job converges
on one side effect. `claimAnalysis` is a compare-and-swap, so two clicks produce
one billable model call.

**6 · Money paths are two-person and evidence-based.** Payroll `submit` and
`approve` are separate permissions; only an approved run exports; the WPS control
record's totals are derived from the rows actually written rather than recomputed.

**7 · The migration history explains its own hazards.** `20260806000000` explains
why `FORCE` matters and what a table owner bypasses;
`20260820140000_reference_counter_table` states the concurrency trade it
introduces rather than only its benefit.

**8 · The test suite asserts behaviour, not shape.** `tests/tenant/retention.spec.ts`
seeds two tenants and asserts what is _gone_, because a test asserting "the sweep
completed" passed throughout the period the sweep deleted nothing.

**9 · Prometheus metrics measure the failures this system has actually had.**
Queue consumer count is read from Redis at scrape time, not incremented by the
enqueue path — because in the dead-worker failure the enqueue counter looked
perfectly healthy.

**10 · Small dependency surface.** 18 runtime dependencies for a product this
size. TOTP, the exposition format, the clamd protocol and the CSV writer are
hand-rolled and commented rather than pulled in — a defensible trade given each is
under 150 lines and each carries its reasoning.

---

## 17. Architectural weaknesses

### W-1 · Single point of failure, by construction

- **Problem** One VM holds the application, the worker, the database, the queue,
  the object store, the scanner, the biometric engine, and now a second full
  stack for staging.
- **Evidence** `infra/docker-compose.azure.yml`; the runbook's own "What this
  deployment is not".
- **Impact** Any host failure is a total outage. There is no failover and no
  point-in-time recovery — recovery is the nightly backup, so the worst case is
  losing up to a day.
- **Severity** 🟠 High
- **Recommendation** Managed Postgres with PITR, managed Redis, object storage
  off the VM. The application side is done and verified: `sslmode=require`,
  `rediss://user:pass@host` and any S3 endpoint are accepted unchanged. This is
  procurement and connection strings.

### W-2 · Metrics exist and nothing scrapes them

> **Closed after this assessment.** `infra/docker-compose.yml` now defines
> `prometheus` and `alertmanager` behind an `observability` profile that both
> deployment overlays clear, so a production or staging stack cannot be brought
> up without them. CI gate 3c (`npm run check:observability`) fails the build if
> either overlay stops clearing it, if the scrape job is renamed out from under
> `ApplicationDown`, or if a consumed queue drops out of `QueueHasNoConsumer`.
> The finding below is left as written, as the state at `f1dd84e`.

- **Problem** `GET /api/metrics` serves nine signal families and
  `infra/prometheus-alerts.yml` holds ten rules. **No Prometheus, Grafana,
  Alertmanager or scrape configuration exists anywhere in the repository or in
  any Compose file.**
- **Evidence** No `prometheus` service in any of the five Compose files; the
  alert file's own header gives a scrape config as an _instruction to the reader_.
- **Impact** Every failure the metrics work was built to catch — a dead worker, a
  tenant-guard trip, a backlog ageing, AI spend spiking — is still discovered by a
  customer. The instrumentation is a capability, not yet a control.
- **Severity** 🟠 High — this is now the largest gap between what the system can
  do and what it does.
- **Recommendation** A `prometheus` + `alertmanager` service in the Azure overlay,
  scraping `web:3000` on the compose network. It is roughly thirty lines of YAML
  and a mounted rules file that already exists.

### W-3 · Log shipping

- **Problem** pino writes structured JSON to stdout. Nothing collects it.
- **Evidence** No log driver configured on any service; `docs/DEPLOY-AZURE.md`
  says `docker compose logs` is what you have.
- **Impact** Logs die with the container, so post-incident analysis is limited to
  whatever is still in the buffer.
- **Severity** 🟡 Medium
- **Recommendation** A logging driver or a sidecar shipper. The log lines are
  already structured and carry a request id.

### W-4 · Attendance captures are on local disk

- **Problem** `ATTENDANCE_CAPTURE_DIR` writes biometric captures to a container
  volume.
- **Evidence** `src/services/hr/captureVault.ts`.
- **Impact** Two web replicas on one host share the volume and are fine; two
  hosts are not. This is the only thing standing between the current design and a
  stateless multi-replica web tier — everything else that was in memory (rate
  limits, entitlements, the permission cache) is in Redis.
- **Severity** 🟡 Medium
- **Recommendation** Move to the existing S3 client. It touches `captureVault`,
  the retention sweep that purges them, and needs a migration for captures already
  on disk.

### W-5 · Business logic in server components

- **Problem** 89 of 108 workspace pages query Prisma directly.
- **Evidence** `grep -rl "from '@/lib/db'" src/app/(workspace) --include=page.tsx`.
- **Impact** Safe — the tenant guard covers it — but the same read exists in a
  page, a service and an export, and they drift.
- **Severity** 🟡 Medium
- **Recommendation** Move read shapes into `src/services/*` as they are next
  touched. Not a rewrite.

### W-6 · Two very large dispatch routes

- **Problem** `hr/[resource]/route.ts` (1,089 lines) and
  `hr/actions/[action]/route.ts` (974 lines).
- **Evidence** Line counts.
- **Impact** Reduced since revision 1 — both permission maps are now total over
  their enums, so an undeclared resource or action is a compile error rather than
  a silent fall-through to the floor permission. What remains is readability.
- **Severity** 🔵 Low
- **Recommendation** Split by resource family when one is next changed.

### W-7 · Unbounded tables with no retention policy

- **Problem** `AuditLog`, `HrAttendancePunch` and `PlatformAuditEvent` are
  append-only and the retention sweep does not touch them.
- **Evidence** `src/lib/jobs/retention.ts` covers recordings, webhook events,
  sessions, captures and soft-deleted rows — not these three.
- **Impact** Monotonic growth. Partitioning is the _second_ step; without a
  policy it turns one growing table into many.
- **Severity** 🟡 Medium
- **Recommendation** Decide the retention period first — it is a compliance
  question, not an engineering one. Growth is now measured
  (`masterapp_table_rows_estimate`, `masterapp_table_bytes`) so the decision has
  numbers behind it.

### W-8 · Features whose schema shipped without an implementation

- **Problem** Lead scoring (`ScoringRule`, `LeadScoreHistory`, an `ORDER BY
score`) has **zero** code references. Billing (`SubscriptionPlan`,
  `TenantSubscription`, `BillingEvent`) has no payment provider.
- **Evidence** `grep -rn "ScoringRule" src/` returns nothing;
  `grep -riE "stripe|checkout"` returns nothing.
- **Impact** The product promises things it does not do. A lead list ordered by a
  score nothing computes is worse than one that does not claim to.
- **Severity** 🟡 Medium
- **Recommendation** Decide, then do one or the other. Both are listed under
  §20's decisions.

### W-9 · No infrastructure as code

- **Problem** The VM, its firewall, its DNS and its disks are configured by hand.
- **Evidence** No Terraform, Pulumi, Bicep or ARM anywhere.
- **Impact** The deployment cannot be recreated from the repository. A second
  environment is a person following a runbook.
- **Severity** 🟡 Medium
- **Recommendation** The Compose files and systemd units already describe most of
  it; what is missing is the host itself.

### W-10 · No CD, and one deployment host

- **Problem** CI has 19 gates and does not deploy. Release is a person over SSH.
- **Evidence** `.github/workflows/ci.yml` has no deploy job.
- **Impact** Deployment quality depends on somebody running `release.sh` rather
  than on the pipeline. Mitigated substantially by the script itself, which
  refuses a dirty tree, a tree/tag mismatch and an unrehearsed migration.
- **Severity** 🔵 Low
- **Recommendation** A manually-triggered deploy job calling the same script.

---

## 18. Scalability analysis

The code and the deployment scale very differently, and the gap has narrowed
since revision 1 — every one of the three code-level ceilings it identified has
been raised.

### 10 organizations — comfortable

Everything holds. One VM at 4 vCPU / 16 GB, `max_connections=200` against pools
of 20 (web) and 10 (worker), keyset pagination everywhere, tenant-leading
indexes. The binding constraint is memory: ClamAV's signature database and the
face models share RAM with Postgres, and staging now runs a second copy of both
on the same host.

### 100 organizations — comfortable

| Dimension  | Assessment                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database   | Fine. Tenant-leading composites keep every list query index-scanned                                                                                                                                                                   |
| API        | Fine. Server components mean most navigation is one round trip                                                                                                                                                                        |
| Auth       | **Was the first strain; no longer.** The permission build is cached — measured 13.28 ms → 0.15 ms                                                                                                                                     |
| AI         | **Was untenable at concurrency 2; no longer.** Global 6 with a per-tenant ceiling of 2, so one tenant's backlog occupies at most a third of the worker. Measured: a second tenant's job ran at position 40 of 41 before, 2 of 3 after |
| Storage    | Object storage on the VM disk is the practical limit here                                                                                                                                                                             |
| Monitoring | **Was the binding constraint at `f1dd84e`;** a scraper and an alert router have since been deployed (W-2)                                                                                                                              |

### 1,000 organizations — needs infrastructure, not code

| Dimension            | Assessment                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-tenant sequences | **Resolved.** One counter table; catalog growth is gone                                                                                                          |
| Connection pool      | **Resolved as a design question.** PgBouncer in transaction mode is verified compatible and ships as an overlay                                                  |
| Auth                 | Resolved by the cache                                                                                                                                            |
| AI                   | Fairness holds; the ceiling becomes vendor quota rather than architecture                                                                                        |
| Unbounded tables     | `AuditLog` and `HrAttendancePunch` need a retention policy, then partitioning (W-7)                                                                              |
| Entitlement cache    | The `SCAN`-based `invalidate()` is the wrong shape at this key count. The actor cache already uses versioned values instead; the entitlement cache should follow |
| Storage              | Must move off the VM                                                                                                                                             |
| Web tier             | Multi-replica needs attendance captures in object storage (W-4)                                                                                                  |
| Database             | Still one instance. Read replicas are wired (`prismaRead` serves reports and exports) but the primary is a single point                                          |

### 10,000 organizations — a different architecture

Requires: managed Postgres with read replicas and PITR; managed Redis; object
storage off-host; a stateless multi-replica web tier behind a load balancer;
partitioned audit and attendance tables; regional sharding if `Tenant.dataRegion`
is ever to mean anything. The tenant-isolation model itself scales — RLS does not
care how many tenants exist — but a single Postgres instance holding 10,000
customers' data does not.

### Bottleneck order

```mermaid
flowchart LR
  A["1 · Monitoring has no consumer<br/>(closed since this assessment)"] -->
  B["2 · Single VM, no failover<br/>(now — any scale)"] -->
  C["3 · Object storage on the VM disk<br/>(~50 orgs)"] -->
  D["4 · Attendance captures on local disk<br/>(blocks a 2nd web host)"] -->
  E["5 · AuditLog / punch tables unbounded<br/>(~1,000 orgs)"] -->
  F["6 · Entitlement cache SCAN sweep<br/>(~1,000 orgs)"] -->
  G["7 · Single database instance<br/>(~5,000 orgs)"]
```

Revision 1's items 4, 5, 6 and 8 — AI concurrency, per-request permission builds,
PgBouncer × RLS, and the per-tenant sequence catalog — are no longer on this list.

---

## 19. Production readiness

| Area                     |  Score |  R1 | Explanation                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | -----: | --: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**         | **86** |  82 | Boundaries are real and consistently held: one kernel, one Prisma client, one Redis client, one S3 client, business logic in `services/`. Now 96% of routes behind an audited prologue, with the streaming exceptions consolidated behind one function. Loses points for two 1,000-line dispatch routes, 89 pages querying Prisma directly, and a feature (lead scoring) whose schema shipped without its engine |
| **Security**             | **88** |  78 | The controls are excellent and several are better than typical commercial practice — boot-time RLS verification, replay-detecting rotation, egress redaction including spoken numbers, break-glass platform access, unforgettable rate limits, a CI gate over the live catalog. Held back by `script-src 'unsafe-inline'` (framework-blocked), plaintext intra-VM traffic, Redis without AUTH, and no CSRF token |
| **Scalability**          | **71** |  48 | Query patterns were always right. Every code-level ceiling revision 1 identified has been raised — sequences, permission builds, AI fairness, pooling. What remains is a single VM with no horizontal story and object storage on its disk                                                                                                                                                                       |
| **Database**             | **91** |  84 | 192 models, 655 live indexes, 404 foreign keys, RLS forced and policied on 173 tables and verified in CI, drift-gated, keyset pagination, `NOT VALID`/`VALIDATE` discipline, migrations that explain their own hazards. Loses points for no partitioning on unbounded tables and no retention policy for them                                                                                                    |
| **Network**              | **70** |  62 | The edge is right: Caddy, automatic TLS, HSTS preload, nothing but 80/443 published — verified by rendering the configuration. Safety no longer depends on layering files in the right order. Everything behind the edge is still plaintext and Redis still has no AUTH                                                                                                                                          |
| **AI**                   | **86** |  74 | Genuinely well-architected: per-tenant BYO keys, redaction at the boundary that now catches spoken numbers, schema-constrained output, claim-before-bill idempotency, honest labelled simulation, tools that run the caller's own permissions, per-workspace metering with a plan ceiling, per-tenant fairness. Loses points for lead scoring being modelled and unimplemented, and for no streaming             |
| **DevOps**               | **74** |  41 | Commit-tagged images, promotion of the exact artifact staging ran, one-command reversible rollback, a staging-first migration gate with checksum matching, encrypted scheduled backups with a weekly restore verification and a freshness check, 19 CI gates. Loses points for no CD, no infrastructure as code, and a manual off-host backup copy                                                               |
| **Multi-tenancy**        | **93** |  88 | Three independent layers, `FORCE` everywhere, a NOBYPASSRLS runtime role with `CREATE` revoked, transaction-local settings that survive a transaction pooler, and a CI gate that reads the catalog rather than a list. The bootstrap exemptions are each justified and enumerated                                                                                                                                |
| **Monitoring**           | **45** |  12 | From nothing to a complete instrumentation layer: Prometheus exposition, ten alert rules each matching a failure this codebase has actually had, build info, queue consumer counts read from Redis, table growth gauges. **Capped at 45 because nothing scrapes it.** The alert rules are a file, not a running system.                                                                                          |
| **Production readiness** | **73** |  46 | Deployable to a real customer today with an accepted single-host risk, provided somebody stands up a scraper. The remaining blockers are operational, not architectural.                                                                                                                                                                                                                                         |

**Overall: 73 / 100** (revision 1: 46).

> **Since this assessment.** Monitoring's cap was the missing scraper, and that
> is now closed: `prometheus` and `alertmanager` run in both deployment overlays
> and CI gate 3c fails the build if either stops starting them. Re-scored on
> that alone, **Monitoring is 78** — short of full marks for no tracing, no
> error reporting, no log shipping, and a monitoring stack sharing a host with
> what it watches — and **production readiness is 78**. The table is left at the
> numbers assessed against `f1dd84e`; an assessment that edits itself is no
> longer a record of anything. See `docs/OBSERVABILITY.md`.

---

## 20. Final architecture report

### Current architecture

One Next.js 16 application, server-rendered, with a second process of the same
image draining nine BullMQ queues and a Python sidecar doing face recognition.
One PostgreSQL 16 database holds 192 models for every tenant, isolated by
`tenantId` and enforced three times over. Redis carries queues, rate limits and
two caches. MinIO holds recordings, HR documents, payslips and biometric
captures. Google Gemini is the only AI provider, reached over plain REST.

### Current network

One public ingress: Caddy on 80 and 443, automatic TLS, HSTS preload. Everything
else lives on a private Compose network with nothing published — verified by
rendering the production configuration. Inbound webhooks from telephony vendors
and Meta arrive through the same Caddy and are rate-limited by key _before_ the
key is looked up. Outbound traffic is egress-only to Gemini, an SMTP relay, Meta
and telephony vendors. Behind the edge everything is plaintext, and Redis has no
password.

### Current security

**Secure:** tenant isolation, authentication, authorization, password handling,
MFA for privileged roles, session rotation with theft detection, audit trails,
rate limiting, upload scanning, AI egress redaction, secret handling, and a boot
gate that refuses to serve a misconfiguration. Several of these are better than
typical commercial practice.

**Not secure:** `script-src 'unsafe-inline'` leaves XSS uncontained by CSP
(framework-blocked, not neglected). Intra-VM traffic is plaintext. Redis has no
AUTH. There is no CSRF token beyond `SameSite=Lax`.

### Current risks — top 10

| #   | Risk                                                                                                               | Severity  |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | **Nothing scrapes the metrics.** Every failure the instrumentation was built to catch is still found by a customer | 🟠 High   |
| 2   | Single VM: no failover, no PITR, worst case a day of data                                                          | 🟠 High   |
| 3   | Logs die with the container                                                                                        | 🟡 Medium |
| 4   | `unsafe-inline` in `script-src`                                                                                    | 🟡 Medium |
| 5   | Off-host backup copy is manual — an untested step in the recovery path                                             | 🟡 Medium |
| 6   | `AuditLog` and `HrAttendancePunch` grow without a policy                                                           | 🟡 Medium |
| 7   | Attendance captures on local disk block a second web host                                                          | 🟡 Medium |
| 8   | Redis without AUTH, and plaintext intra-VM traffic                                                                 | 🟡 Medium |
| 9   | Lead scoring and billing are modelled and unimplemented — the product claims them                                  | 🟡 Medium |
| 10  | No infrastructure as code; the host cannot be recreated from the repository                                        | 🟡 Medium |

### Required changes before production

1. **Stand up a scraper.** Prometheus + Alertmanager in the Azure overlay,
   pointed at `web:3000`. The rules already exist.
2. **Automate the off-host backup copy**, and prove one restore end to end
   including the object half, which has still only been exercised for the
   database.
3. **Ship logs somewhere** that outlives the container.
4. **Set `requirepass` on Redis.**
5. **Decide lead scoring and billing** — build or remove. Shipping a product that
   orders by a score nothing computes is a support burden and a credibility one.

### Future architecture

Managed Postgres with PITR and a read replica (the application already reads
reports and exports from `prismaRead`); managed Redis with TLS and AUTH; object
storage off the VM, including attendance captures; a stateless multi-replica web
tier behind a load balancer; PgBouncer in front of the database (verified
compatible and already written); partitioned audit and attendance tables behind a
retention policy; a secret manager mounting files (`<KEY>_FILE` is already
supported); and infrastructure as code so the whole thing can be recreated.

None of that requires changing the tenant-isolation model, the authorization
model or the API surface, which is the strongest statement that can be made about
this architecture: **it is the deployment that needs to grow up, not the
application.**

### Priority roadmap

#### P0 — Critical · fix immediately

|      | Item                                                                                                                       | Reference |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| P0-1 | Deploy Prometheus + Alertmanager against `/api/metrics` — **done**, `docs/OBSERVABILITY.md`                                | W-2       |
| P0-2 | Automate the off-host backup copy and prove one **full** restore, including the object store                               | W-1, §9.3 |
| P0-3 | Set `requirepass` on Redis in every Compose file — **done**                                                                | M-5       |

#### P1 — Production · before paying customers

|      | Item                                                                                             | Reference |
| ---- | ------------------------------------------------------------------------------------------------ | --------- |
| P1-1 | Ship logs off the host                                                                           | W-3       |
| P1-2 | Register the remaining resources in `FIELD_MAP`, or remove `filter` from those routes' contracts | M-2       |
| P1-3 | Add the break-glass control to the platform console                                              | M-4       |
| P1-4 | Correct the CSP comment in `next.config.ts`                                                      | M-8       |
| P1-5 | Delete the three unconsumed queues or build their consumers                                      | M-3       |
| P1-6 | An SSRF allow-list for the vendor-supplied recording URL the media worker fetches                | §12.2     |
| P1-7 | Rotate `FACE_SERVICE_TOKEN` on a schedule                                                        | M-7       |

#### P2 — Scale · as volume grows

|      | Item                                                                                                  | Reference |
| ---- | --------------------------------------------------------------------------------------------------------- | --------- |
| P2-1 | Managed Postgres with PITR; managed Redis with TLS and AUTH; object storage off the VM                    | W-1       |
| P2-2 | Move attendance captures to object storage — **done**, the multi-replica blocker is now the load balancer | W-4       |
| P2-3 | Version the entitlement cache instead of `SCAN`-sweeping it, as the actor cache already does              | §18       |
| P2-4 | Retention policy for `AuditLog` / `HrAttendancePunch` / `PlatformAuditEvent`, then partition by month     | W-7       |
| P2-5 | Turn on the PgBouncer overlay                                                                             | §9.4      |
| P2-6 | Infrastructure as code for the host                                                                       | W-9       |
| P2-7 | A manually-triggered deploy job calling `release.sh`                                                      | W-10      |
| P2-8 | TLS or mTLS between services once anything leaves the single host                                         | M-6       |

#### P3 — Optimization

|      | Item                                                                                               | Reference |
| ---- | -------------------------------------------------------------------------------------------------- | --------- |
| P3-1 | Close the CSP gap when Next supports nonce propagation, or hash the inline bootstrap at build time | M-1       |
| P3-2 | Move page-level Prisma reads into `services/` as they are next touched                             | W-5       |
| P3-3 | Split the two HR dispatch routes                                                                   | W-6       |
| P3-4 | Implement SMS and e-signature adapters, or remove the settings that imply they exist               | §14       |
| P3-5 | A second SIF layout, once a second bank is onboarded                                               | L-4       |
| P3-6 | Remove `Tenant.dataRegion` or give it meaning — **removed**                                        | L-2       |
| P3-7 | A CSRF token, if a subdomain is ever added                                                         | L-1       |

#### Decisions this roadmap cannot make

|     | Question                                                                                                        | Why it is not an implementer's call                                 |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| D-1 | **Lead scoring** — build the rule engine, or delete `ScoringRule`, `LeadScoreHistory` and the `ORDER BY score`? | Both are defensible and they differ by weeks of work                |
| D-2 | **Billing** — connect a payment provider, or take the billing language off the product surface?                 | Nothing charges anybody today                                       |
| D-3 | **Audit retention** — how long, and may these tables be deleted at all?                                         | A regulator's answer, not a database's                              |
| D-4 | **Break-glass approval** — should a second person approve platform write access?                                | A platform with one owner cannot satisfy it and would be locked out |

---

_Assessed at commit `f1dd84e`, 2026-08-20. Measurements taken against a live
PostgreSQL 16 catalog, rendered Compose configurations for four stacks, and a
full test run of 1,349 tests across 107 files._
