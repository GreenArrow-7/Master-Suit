# Database

Current observed state. No connection strings or credentials appear here.

## Technology and access layer

- PostgreSQL 16 (`postgres:16-alpine` locally and in Compose overlays;
  `postgres:16` in CI). E2 `infra/docker-compose.yml`, `.github/workflows/ci.yml`.
- Prisma 7.10.0 with the `pg` driver adapter (`@prisma/adapter-pg`,
  `connectionTimeoutMillis: 5000`), preview features
  `fullTextSearchPostgres`, `relationJoins`. E1 `src/lib/db.ts`,
  `prisma/schema.prisma` generator block.
- `prisma.config.ts` loads `.env` itself (so `prisma` CLI works without a
  shell export) and defines the migration datasource. E2.
- Two connection roles by design: `DATABASE_URL` (application,
  `NOBYPASSRLS`, owns nothing) and `MIGRATION_DATABASE_URL` (owner, used by
  `prisma migrate` only). Boot refuses the same string for both and verifies
  at runtime that the connected role is not `BYPASSRLS`/superuser. E1
  `src/lib/startup-check.ts`; E4 `docs/ENVIRONMENTS.md` §Enforcement.
- Optional read replica: `prismaRead` uses `DATABASE_REPLICA_URL` when set,
  otherwise the primary; used by export routes. E1 `src/lib/db.ts`,
  `src/app/api/v1/exports/[resource]/route.ts`, `leads/export/route.ts`.
- Optional PgBouncer overlay (`infra/docker-compose.pgbouncer.yml`,
  `pgbouncer.ini`) — shipped, deliberately not enabled (DOCUMENTED
  `docs/OBSERVABILITY.md`). E2/E4.

## Schema

- `apps/web/prisma/schema.prisma`: 7,727 lines, **201 models**, **105
  enums**, 435 `@@index`, 104 `@@unique`; 188 models carry `tenantId`; 53
  carry `deletedAt` (soft delete). E1.
- Legacy: `prisma/schema.pre-unified.prisma` and
  `prisma/legacy-migrations/20260729083313_init` are the pre-unification
  LeadFlow CRM schema — `Legacy / potentially inactive`; not referenced by
  `prisma.config.ts`. E1/E2. The role/policy templates in
  `infrastructure/postgres/` and `docs/RLS-ROLLOUT.md` belong to the same
  era and contradict the current migrations — **EVC-004**.

### Major entity families (E1, model names)

| Family | Models (selection) |
|---|---|
| Tenancy & billing | `Tenant`, `SubscriptionPlan`, `TenantSubscription`, `ModuleEntitlement`, `PlanModule`, `PlanLimit`, `SubscriptionModule`, `WorkspaceUsage`, `BillingEvent`, `OrganizationSetting`, `PlatformSetting` |
| Org structure | `Region`, `Branch`, `Territory`, `Department`, `Team`, `UserTeam` |
| Identity | `User` (workspace user), `PlatformUser`, `PlatformSession`, `PlatformServiceCredential`, `WorkspaceInvitation`, `WorkspaceMembership`, `MembershipRole`, `AuthenticationFactor`, `PasswordHistory`, `PasswordResetToken`, `PlatformAccessGrant`, `APIKey`, `DeviceToken` |
| Access control | `Role`, `Permission`, `RolePermission`, `FieldPermission` |
| Audit | `AuditLog` (enum `AuditEvent`, 30 values), `PlatformAuditEvent`, `RateLimitCounter` |
| Sales core | `Lead` (+ `LeadStage`, custom fields, stage/assignment/score history, tags, `ScoringRule`, `DuplicateRule`), `Account`, `Contact`, `Opportunity` (+ pipelines, stages, collaborators, products, loss reasons), `Activity`, `Task`, `FollowUpTask`, `DistributionRule`, `AllocationRequest`, `EmployeeTarget`, `TargetProgress` |
| Engagement | `Campaign`, `MarketingList`, `EmailCampaign`, `MessageTemplate`, `Conversation`, `Communication`, `CommunicationProvider`, `Form`, `FormSubmission`, `LandingPage`, `Event`, `EventInvitee`, social (`SocialComment`, `SocialReply`, `MetaLeadFormRouting`), `Post`, `Contest`, `Nomination`, `Referral`, `Testimonial` |
| Calls & AI | `Call`, `Recording`, `RecordingConsent`, `Transcript`, `AIAnalysis`, `AuditScorecard`, `CallAudit`, `CoachingNote`, `Objection`, `PracticeSession`, `SalesPlaybook`, `DetectedRequirement`, `DialerSession` |
| Real estate | `Developer`, `Micromarket`, `Project`, `UnitPlan`, `UnitInventory`, `Owner`, `Listing`, `Mandate`, `ClientRequirement`, `SiteVisit`, `Booking`, `ClientProfile` |
| Money | `CommissionSlab`, `CommissionSlabBand`, `Commission`, `Payout` |
| HR | `EmployeeProfile`, `Designation`, `HrShift`, `HrRosterEntry`, `HrOvertimeRequest`, `HrCompensation`, `HrPayrollRun`, `HrPayslip`, `HrReviewCycle`/`HrReview`/`HrGoal`/`HrPip`, recruiting (`HrRequisition`, `HrCandidate`, `HrInterview`, `HrOffer`), `HrAttendanceRecord`, `HrAttendancePunch`, `HrLeaveType`/`HrLeaveRequest`/`HrLeaveBalance`, `HrHoliday`, `HrEmployeeDocument`, `HrWorkLocation`, `HrChecklistTask`, `HrOffboardingCase`, `BiometricConsent`, `HrFaceTemplate` |
| Service & files | `Ticket`, `TicketComment`, `SLA`, `CannedResponse`, `Document`, `ImportJob`, `ExportJob`, `Notification`, `SmartView`, `SavedFilter`, `Dashboard`, `Report` |
| Integrations | `IntegrationConnection` (credentials envelope-encrypted), `WebhookEvent` |

Relationships are declared in the schema (`@relation`, cascades such as
`AuditLog.tenant onDelete: Cascade`). A full ER diagram is not maintained;
`scripts/schema-stats.mjs` keeps the README counts honest (CI step "README
schema counts"). E1/E2.

## Tenant isolation in the data layer (E1, E3)

1. Every service query carries `ctx.tenantId`.
2. `src/lib/db.ts` extends the Prisma client with a tenant guard: a query on
   a tenant-owned model without a tenant filter throws `TenantGuardError`
   (metric `TenantGuardTripped` alert). `GLOBAL_MODELS` and
   `GLOBAL_UNIQUE_FIELDS` list the exceptions. Queries are pinned by a
   batched `$transaction([ set_config('app.tenant_id', …, true), query ])` so
   the setting lives on the same pooled connection.
3. PostgreSQL `FORCE ROW LEVEL SECURITY` policies on tenant tables keyed on
   `current_setting('app.tenant_id')`; platform routes run under
   `app.platform_admin`. Policies are created in migrations (26 migration
   files contain `FORCE ROW LEVEL SECURITY`); `scripts/check-rls.mjs`
   asserts coverage against the live catalogue in CI; a local run in this
   workstream reported 181 forced tables (TESTED locally, catalogue is the
   authority).
4. `scripts/check-raw-sql-scope.mjs`: raw SQL (33 `$queryRaw/$executeRaw`
   sites in `src`) against RLS tables must be inside a tenant transaction.

TESTED — `tests/tenant/*` (isolation, rls, pooling, reference, scope,
visibility-where-merge …), `tests/security/*`.

## Migrations

- `prisma/migrations/` — 65 migrations from `20260803000000_baseline` to
  `20260904080000_platform_scoped_password_reset`, plus
  `migration_lock.toml`. Applied with `prisma migrate deploy` (never
  `migrate dev`/`db push` outside a laptop). E2 `package.json` scripts, CI.
- Drift gate: `prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --exit-code` (`npm run check:drift`) runs in CI. E2.
- Staging-first gate: `scripts/check-staging-first.mjs` compares
  `_prisma_migrations` in the target with staging and refuses a production
  migration not already finished in staging with the same checksum; wired
  into the `migrate` Compose profile (`docker-compose.azure.yml`). E1/E2.
- No down migrations exist; `release.sh rollback` explicitly does not touch
  the database. E1 `scripts/release.sh`.
- Known history: schema drifted ahead of migrations once
  (`docs/KNOWN-LIMITATIONS.md`); the drift gate was the response. E4.

## Transactional patterns

- `$transaction` used in 14 places for multi-row writes; the tenant guard
  pins `app.tenant_id` per transaction; interactive transactions are tracked
  by an async-local flag so nested pinned queries do not deadlock. E1
  `src/lib/db.ts` comments and `runPinned()`.
- Idempotency and `If-Match` concurrency are documented API conventions
  (`apps/web/docs/03-API.md`); the storage of idempotency keys was not
  traced in Phase A — `INFERRED — requires verification`, **EVC-008**.

## Configuration mechanism

`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SHADOW_DATABASE_URL` (declared in
`.env.example`), `DATABASE_REPLICA_URL`, `SLOW_QUERY_MS`; `<KEY>_FILE`
variants supported (`src/lib/env.ts`). Values are never committed. E1/E2.

## Backup / migration information

See `docs/operations/BACKUP_RESTORE.md` and `docs/operations/ROLLBACK.md`.
Database size, connection counts and current migration ledger in production:
`UNKNOWN — requires runtime/infrastructure verification`.

## Evidence Sources

E1: `apps/web/prisma/schema.prisma`, `prisma/migrations/*`,
`src/lib/db.ts`, `src/lib/startup-check.ts`, `src/lib/env.ts`,
`scripts/check-rls.mjs`, `scripts/check-raw-sql-scope.mjs`,
`scripts/check-staging-first.mjs`, `scripts/release.sh`.
E2: `prisma.config.ts`, `package.json`, `infra/docker-compose*.yml`,
`infra/pgbouncer.ini`, `.github/workflows/ci.yml`, `.env.example`.
E3: `apps/web/tests/tenant/*`, `tests/permission/rls.spec.ts`,
`tests/security/*`.
E4: `docs/ENVIRONMENTS.md`, `docs/KNOWN-LIMITATIONS.md`,
`docs/OBSERVABILITY.md`, `apps/web/docs/02-DATA-MODEL.md`,
`apps/web/docs/03-API.md`.
Unverified: production database size, replica presence, PgBouncer use,
idempotency-key storage.
