# Backend

Current observed state. VERIFIED unless labelled otherwise.

## Framework and entry points

- The backend is the same Next.js 16 process as the frontend: route handlers
  under `src/app/api/**/route.ts` (173 files), plus server components that
  call services directly. E1.
- `src/instrumentation.ts` runs `assertProductionConfiguration()` once per
  server process (`src/lib/startup-check.ts`): refuses to boot in production
  when `APP_ENV` disagrees with the database-name marker, when
  `DATABASE_URL === MIGRATION_DATABASE_URL`, when the connected role has
  `BYPASSRLS`/superuser, when tenant tables lack forced RLS, or when a mock
  provider is configured. E1.
- `src/proxy.ts` (Next 16 "proxy", the middleware slot): per-request CSP
  header and `x-pathname` request header. E1.
- Worker process: `src/workers/index.ts` (`npm run worker`,
  `PROCESS_ROLE=worker`) starts one BullMQ worker per queue, arms the
  maintenance and campaign schedulers, optionally the live-stream WebSocket
  server, and closes workers on SIGTERM/SIGINT. E1.

## API structure

- Versioned path `/api/v1/*` (path-versioned, additive-only — DOCUMENTED in
  `apps/web/docs/03-API.md` §2; no `/api/v2` exists). Operational endpoints:
  `/api/health` (DB + Redis, 503 when degraded), `/api/health/live`,
  `/api/metrics` (Prometheus, token-gated). E1.
- Three handler styles coexist (E1 counts):
  1. `route(spec, handler)` from `src/lib/api/handler.ts` — 136 files.
  2. `guarded(...)` from `src/lib/api/guarded.ts` — 10 files.
  3. Raw `export async function GET/POST…` — 38 files (health, metrics,
     webhooks, public forms, some auth routes and others). Each raw handler
     must implement its own checks; a per-route audit of these 38 is listed
     as a gap (SEC-OBS-002).

### The `route()` pipeline (E1 `src/lib/api/handler.ts`)

1. `requestId` = incoming `x-request-id` or a new ULID; echoed on every
   response.
2. Credential: `Authorization: Bearer lf_svc_…` → platform service actor;
   any other `Bearer …` → API key (`authenticateApiKey`); otherwise the
   `lf_session` cookie via `resolveCtx()`. Routes with `auth: 'public'`-class
   specs skip this (see spec fields in the file).
3. Rate limits: optional per-route `rateLimit`, plus API-key
   (`API_RATE_LIMIT_PER_MIN`) or session-user ceilings (`limits` in
   `src/lib/security/ratelimit.ts`, Redis fixed windows).
4. Entitlement: `assertModuleEntitlement(tenantId, module)` (Redis-cached 60 s).
5. Permission: `assertPermission(ctx, module, action)` unless the spec is
   `selfService`.
6. Parsing: `params`, `query`, `body` Zod schemas → 422 problem+json with
   field errors (`Invalid()` in `src/lib/errors.ts`).
7. Handler runs with `{ ctx, params, query, body, requestId }`; may return a
   `Response`, JSON, or nothing (`{ ok: true }`).
8. Audit: `auditEvent` in the spec writes an `AuditLog` row; audit failures
   are logged, never converted into 500s for the caller.
9. Errors: `toResponse()` maps `AppError`/`ZodError`/unknown to
   `application/problem+json` (RFC 9457) with `requestId`; 5xx are logged at
   error level with secrets scrubbed (`scrubSecrets`).

## Services

`src/services/<domain>/*.ts` — 24 domains (accounts, automation, campaigns,
clients, contacts, crm, dialer, distribution, engagement, hr (23 files),
identity, integrations, inventory, leadership, leads, meta, money,
opportunities, platform, shared, sla, social, targets, visits). Functions take
`Ctx` first where the actor matters (e.g. `createLead(ctx, input)`,
`updateLead(ctx, id, input)`, `deleteLead(ctx, id)` in `src/services/leads`).
79 service files import `@/lib/db` directly; there is no repository layer.
E1.

## Middleware-like layers

| Concern | Where | Evidence |
|---|---|---|
| CSP / request headers | `src/proxy.ts` | E1 |
| Static security headers | `next.config.ts` `headers()` | E2 |
| Origin / CSRF posture | `src/lib/security/origin.ts`; cookies `sameSite: 'lax'` | E1 |
| Client IP behind proxy | `clientIp()` in `src/lib/auth/session.ts`, `TRUSTED_PROXY_CIDRS`, `src/lib/security/cidr.ts` | E1 |
| Rate limiting | `src/lib/security/ratelimit.ts` (Redis `INCR`+`PEXPIRE` fixed window) | E1; E3 `tests/security/ratelimit` |
| Body size | Caddy `request_body max_size 32MB`; `UPLOAD_MAX_MB` in env; `src/lib/api/read-body.ts` | E1/E2 |
| Antivirus on uploads | `src/lib/antivirus.ts` (ClamAV INSTREAM or mock) | E1 |

## Validation

Zod 3 everywhere at the boundary: route specs (`params/query/body`), env
(`envSchema`), pagination (`pageQuery`: `limit` 1–200 default 50, opaque
base64url cursor), filter trees (`src/lib/api/filterTree.ts`, `where.ts`).
E1.

## Error handling

`AppError(status, code, message)` with `toProblem(requestId)`; helpers
`Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `Invalid`,
`TooManyRequests`, `MethodNotAllowed`. Cross-tenant or invisible records
return 404 by design. Detail: `docs/standards/ERROR_HANDLING.md`. E1.

## Background processing

- Queues (`src/lib/queue.ts`): `automation` (5 attempts, exp 2 s),
  `distribution` (3, exp 1 s), `sla` (3, fixed 30 s), `campaign` (3, exp
  30 s), `webhook` (5, exp 10 s), `maintenance` (1), `media` (6, exp 15 s),
  `ai` (4, exp 30 s), `notifications` (5, exp 10 s); `removeOnComplete 1000`,
  `removeOnFail 5000`; `queueHasWorkers()` for alerting. E1.
- Workers (`src/workers/*.ts`): one module per queue; `maintenance` runs with
  `concurrency: 1`; others use the BullMQ default (INFERRED — no explicit
  value found). Schedulers: `retention-daily` (cron pattern), a
  quarter-hourly maintenance job, `campaign-sweep` every 60 s. E1.
- Retention: `src/lib/jobs/retention.ts` with `AUDIT_LOG_RETENTION_DAYS`,
  `ATTENDANCE_CAPTURE_RETENTION_DAYS`, `ATTENDANCE_PUNCH_RETENTION_DAYS`,
  `PLATFORM_AUDIT_RETENTION_DAYS`. E1/E2.
- Live call streaming: `src/workers/liveStream.ts` — a `ws` server with
  per-call token auth publishing to Redis pub/sub consumed by an SSE route.
  E1.

## Major business modules

Identity & sessions; tenancy & subscriptions/plans/entitlements; access
control & audit; leads (stages, custom fields, scoring, duplicates,
allocation/distribution rules); accounts/contacts/opportunities/pipelines;
activities/tasks/follow-ups; calls, recordings, transcripts, AI analysis,
scorecards, coaching, practice; campaigns, marketing lists, email campaigns,
message templates, social (Meta) leads/comments; conversations/communications
(WhatsApp, telephony); forms & landing pages; events/RSVP; real-estate
inventory (developers, projects, units, listings, mandates, requirements,
bookings); commissions, slabs, payouts; client profiles, testimonials,
referrals, contests, nominations; HR (profiles, shifts, roster, overtime,
compensation, payroll, reviews, PIPs, recruiting, attendance, leave,
holidays, documents, work locations, checklists, offboarding, biometrics);
tickets/SLA; documents; dashboards/reports/exports/imports; integrations &
webhooks; notifications & device tokens. E1 `prisma/schema.prisma` model
list and `src/services/*`.

## Conflicts recorded

`apps/web/docs/00-ARCHITECTURE.md` §2 ("route handlers … never touch
`prisma` directly", repository layer, `actions.ts`) and §5 (queue table) do
not match the code above — registered as **EVC-001** and **EVC-002** in
`docs/EVIDENCE_CONFLICTS.md`. The documented `Idempotency-Key` / `If-Match`
handling was not located in the code (**EVC-008**).

## Evidence Sources

E1: `apps/web/src/lib/api/handler.ts`, `guarded.ts`, `pagination.ts`,
`src/lib/errors.ts`, `src/lib/env.ts`, `src/lib/startup-check.ts`,
`src/instrumentation.ts`, `src/proxy.ts`, `src/lib/queue.ts`,
`src/workers/*.ts`, `src/lib/jobs/retention.ts`, `src/services/**`,
`src/app/api/**/route.ts`, `prisma/schema.prisma`.
E2: `next.config.ts`, `infra/Caddyfile`, `.env.example`.
E3: `apps/web/tests/security/guarded-prologue.spec.ts`, `ratelimit.spec.ts`,
`tests/permission/queue-fairness.spec.ts`.
E4: `apps/web/docs/03-API.md`, `apps/web/docs/00-ARCHITECTURE.md`.
