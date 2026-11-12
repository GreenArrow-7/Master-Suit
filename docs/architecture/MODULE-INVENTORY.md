# Module inventory

What is actually implemented, with the evidence. Paths are relative to
`apps/web/` unless they start with `apps/`, `docs/`, `changes/` or `.github/`.

| | |
| --- | --- |
| Branch | `claude/ponytail-lite-0e416b` |
| Commit | `babbaa06db5620590e1308a6a1fa94054b304992` |
| Analysed | 12 Nov 2026 |

**Status** means: does the code exist and is it joined up end to end?

- **implemented** — screens, routes, services, models and tests all present.
- **partial** — the pieces exist but are not joined to each other or to the
  flow they are supposed to serve. The text says exactly what is missing.
- **documentation-only** — described in a document, not found in source.
- **not-found** — nothing in source.

**Status is not deployment.** A module can be `implemented` and still be
unusable in production because its credentials are absent. The last column of
the integrations table says which.

### Scale at this commit

| | Count |
| --- | --- |
| Pages (`page.tsx`) | 229 — workspace 213, platform console 16 |
| API route files | 256 — `v1` 241, `mobile` 12, `health` 2, `metrics` 1 |
| Prisma models | 231 across 9,280 schema lines |
| Service files | 152 |
| Worker files | 8, running 11 queues |
| Migrations | 126 |
| Spec files | 403 (`vitest` collects 337, ~3,517 cases; Playwright 63) |

---

## Summary

| Module | Status | Pages | Key services | Tests |
| --- | --- | --- | --- | --- |
| Platform administration & provisioning | implemented | 16 | `services/platform/createWorkspace.ts`, `provisioning.ts` | `tests/security/platform-admin-crud.spec.ts`, `tests/tenant/provision-lead-work.spec.ts` |
| Login, MFA, dual-password monitoring, sessions | implemented | 6 | `lib/auth/login.ts`, `credentials.ts`, `session.ts` | `tests/security/dual-credential-auth.spec.ts`, `platform-mfa.spec.ts` |
| Users, roles, permissions, subscriptions | implemented | 8 | `services/identity/roles.ts`, `accounts.ts`, `lib/security/rbac.ts` | `tests/permission/page-access.spec.ts`, `tests/platform/workspace-edit-entitlements.spec.ts` |
| Leads, allocation, follow-ups, activities, targets | implemented | 20+ | `services/leads/leadList.ts`, `services/distribution/assignLead.ts` | `tests/permission/lead-record-scope.spec.ts`, `tests/sales/allocation.spec.ts` |
| Contacts, accounts, opportunities, bookings | **partial** | 14 | `services/opportunities/*`, `app/api/v1/bookings/route.ts` | `tests/sales/bookings-route.spec.ts`, `opportunity-close.spec.ts` |
| Calls, recordings, coaching, ONE AI | implemented | 12 | `lib/ai/assistant/service.ts`, `tools.ts`, `lib/ai/provider.ts` | `tests/security/assistant-guardrails.spec.ts`, `tests/tenant/calls.spec.ts` |
| Commissions, collections, payouts, approvals | implemented | 10 | `services/money/{commissions,collections,payouts}.ts` | `tests/sales/payouts.spec.ts`, `collections.spec.ts`, `commissions.spec.ts` |
| Employees, teams, branches, reporting lines | implemented | 11 | `services/identity/accounts.ts`, `services/hr/access.ts` | `tests/hr/employee-record-scope.spec.ts` |
| Attendance, face check-in, shifts, leave, overtime | implemented | 13 | `services/hr/attendance.ts`, `leave.ts`, `face.ts` | `tests/hr/attendance-manager.spec.ts`, `tests/e2e/face-attendance.spec.ts` |
| Payroll, payslips, WPS | implemented | 4 | `services/hr/payroll.ts`, `wps.ts` | `tests/hr/payroll.spec.ts`, `tests/security/hr-action-authority.spec.ts` |
| Integrations | implemented, **mostly unconfigured** | 4 | `lib/integrations/registry.ts`, `connection.ts` | `tests/security/integration-connections.spec.ts` |
| Notifications & background workers | implemented | 3 | `workers/notifications.ts`, `services/crm/notify.ts` | `tests/integration/notification-digest.spec.ts` |
| Web shell, mobile, deployment | implemented (mobile = proof of concept) | — | `app/(workspace)/[workspaceSlug]/layout.tsx` | `tests/permission/page-access.spec.ts` |

Nothing in the requested scope came back **not-found**. One area is
**documentation-only**: a "monitoring grants" console screen, listed at
`changes/PROJECT.md:42`, does not exist — the endpoint has no UI caller.

---

## Platform administration and workspace provisioning — implemented

**Features.** Provisioning wizard, plan catalogue, subscriptions, module
entitlements, workspace status, break-glass access, AI Control Center, platform
audit stream, self-serve sign-up toggle, system health.

**Pages.** `app/(platform)/platform/` — `page.tsx`, `workspaces/`,
`workspaces/new/`, `workspaces/[workspaceId]/`, `plans/`, `subscriptions/`,
`settings/`, `audit/`, `ai-control/`, `ai-usage/`, `system-health/`, `users/`,
`security/`.

**APIs / services.** `app/api/v1/platform/workspaces/route.ts` (GET `:43`, POST
`:57`), `[workspaceId]/route.ts` (PATCH `:45`, entitlements `:120-140`),
`subscriptions/[subscriptionId]/route.ts` (plan change deletes entitlements
outside the new plan, `:67-88`), `plans/route.ts`,
`workspaces/[workspaceId]/{access,enter}/route.ts`. Services:
`services/platform/createWorkspace.ts`, `provisioning.ts`, `signup.ts`,
`identity.ts`.

**Models.** `Tenant:404`, `SubscriptionPlan:672`, `TenantSubscription:689`,
`ModuleEntitlement:712`, `SubscriptionModule:752`, `PlatformSetting:8656`,
`PlatformAuditEvent:3118`.

**Integrations.** Outbound mail only.

**Notable.** Workspace creation is one transaction writing the tenant,
subscription, entitlements, the full permission catalogue, a Company Admin role
built from **every** `Permission` row, the first user, membership and employee
profile (`createWorkspace.ts:42-253`). The comment at `:155-169` records why it
is derived rather than hand-listed: the old hand-maintained list had missed 36
of 61 modules.

---

## Login, MFA, dual-password monitoring, sessions — implemented

**Features.** One login path for web and phone, throttle, lockout, TOTP as a
second request, a second "monitoring" password for support staff, 90-day mobile
bearer sessions, device management, password policy and history.

**APIs / services.** `app/api/v1/auth/{login,enroll-2fa,refresh,logout,logout-all,forgot-password,reset-password,accept-invite}/route.ts`,
`app/api/v1/platform/credentials/route.ts`,
`app/api/mobile/auth/{sign-in,sign-out}/route.ts`. Services: `lib/auth/login.ts`,
`credentials.ts`, `session.ts`, `mfa.ts`, `services/identity/platformCredentials.ts`.

**Models.** `PlatformUser:1262` (`passwordHash`, `monitoringPasswordHash`,
`monitoringPasswordVersion`, `monitoringPasswordSetAt`), `PlatformSession:3063`
(`kind` FULL/MOBILE, `credentialPurpose`, `credentialVersion`),
`PlatformMfaChallenge:3200`.

**Notable — the dual password.** Nothing the client sends names a mode.
`matchCredential` runs exactly two Argon2id verifications every time, an empty
slot against a dummy digest, so neither timing nor result reveals which slot
matched (`lib/auth/credentials.ts:38-62`). Both matching is AMBIGUOUS and fails
closed. The purpose is fixed once and re-validated on every later request.

**Notable — the mobile boundary.** Verified intact in both directions:
`loadSession` requires `kind === 'WEB'` (`session.ts:274`), `resolveDeviceCtx`
requires `MOBILE` **and** that the token's `{tenantId}` prefix equals the row's
`activeTenantId` (`:333-345`), `resolveCtx` never parses an Authorization
header, and the refresh route refuses a MOBILE session outright
(`app/api/v1/auth/refresh/route.ts:60`).

---

## Users, roles, permissions, subscriptions — implemented

**Features.** Role editor with a permission matrix, effective-dated role
assignment, teams and reporting lines, invitations with hashed single-use
tokens, seat limits, temporary passwords, lock/unlock, deactivation with
hand-over, account erasure, password policy, MFA requirement.

**APIs / services.**
`app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route.ts`,
`identity/[action]/route.ts`, `identity/self/[action]/route.ts`,
`settings/[section]/route.ts`. Services: `services/identity/roles.ts`,
`accounts.ts`, `invitations.ts`, `accountDeletion.ts`; `lib/security/rbac.ts`,
`entitlements.ts`, `permissionCatalogue.ts`, `lib/workspace-page.ts`.

**Models.** `Role:3220`, `Permission:3249`, `RolePermission:3261`, `User:1176`,
`WorkspaceMembership:1451`, `MembershipRole:1587`, `WorkspaceInvitation:1395`.

**Integrations.** Mail for invitations and resets. **No billing provider is
wired** — plans and subscriptions are internal rows, with `BillingEvent:948` as
a local ledger.

**Notable.** Nobody can bind a person to a role they could not administer
themselves (`assertMayAdministerRole`, `lib/security/rbac.ts:160`).

---

## Leads, allocation, follow-ups, activities, targets — implemented

**Features.** Lead grid and stage board from one URL with keyset paging and
saved views, bulk bar, spreadsheet import with a dry run, merge, close-out,
cold data, allocation pool and triage queue, distribution rules, follow-ups by
due day and kind, activities, daily targets, SLA first-contact escalation,
lead scoring with decay.

**APIs / services.** `app/api/v1/leads/route.ts`, `[id]/route.ts`,
`export/route.ts`, `assign/route.ts`, `import/route.ts`, `triage/**`,
`allocation/route.ts`, `distribution-rules/**`, `follow-ups/**`,
`activities/**`, `targets/**`, `webhooks/leads/[key]/route.ts`. Services:
`services/leads/leadList.ts:166` (the one list query), `createLead.ts:147`,
`intake.ts:49`, `updateLead.ts`, `logCall.ts:44`, `nextFollowUp.ts`,
`services/distribution/{assignLead.ts:223,eligibility.ts:200,allocation.ts,triageQueue.ts}`,
`services/sla/checkLeadFirstContact.ts`.

**Models.** `Lead:3335`, `LeadStage:3303`, `LeadSource:3477`, `LeadPhone:3502`,
`LeadStageHistory:3744`, `LeadAssignmentHistory:3764`, `LeadScoreHistory:3786`,
`DistributionRule:4356`, `LeadTriageEntry:4523`, `Activity:4230`,
`FollowUpTask:6341`, `EmployeeTarget:6011`, `DataRecord:3651`.

**Notable — one query, genuinely shared.** The grid, the board and the export
all use `leadListQuery(ctx, params, rules)`; the board passes the *same* `where`
object to `groupBy` and to one `findMany` per stage.
`tests/unit/lead-named-filters.spec.ts:83` asserts the page source and the
export source both literally contain that call, so divergence fails CI. **One
qualification:** `GET /api/v1/leads` is a fourth, separate assembly
(`app/api/v1/leads/route.ts:55-104`) with none of the chips and no `wonIn`.
`GET /api/mobile/leads` does use the shared query.

**Notable — eligibility.** Eleven refusal codes decided in one place
(`services/distribution/eligibility.ts:200`): deleted, not active, membership
inactive, employment ended, on approved leave, marked unavailable, off shift,
quota reached, at capacity, not found. HR-sourced reasons are flattened to a
single `UNAVAILABLE` before being persisted, so a sales triage entry cannot leak
why someone is away.

---

## Contacts, accounts, opportunities, bookings — **partial**

Each object exists and works. They are **not wired to each other or to the lead
pipeline.** This is the single most important structural finding in the product.

**What is implemented.** Contacts, accounts and opportunities are CRUD over
`visibilityWhere` with full pages (`sales/{contacts,accounts,opportunities}/`
plus `[id]`, `[id]/edit`, `new`). Bookings have no page of their own — the
booking screen *is* `sales/collections/page.tsx`. Booking draft → confirm →
cancel works, and confirming takes the unit's row lock via
`moveUnitIn(… 'BOOKED')`, which is the double-sale control.

**What is missing, confirmed:**

| Break | Evidence |
| --- | --- |
| Nothing converts a lead into an opportunity | `createOpportunity` has one caller, `app/api/v1/opportunities/route.ts:95`. No convert endpoint, no lead-page action |
| A booking cannot reference an opportunity | `Booking:7683` has `leadId?`, `contactId?`, `accountId?` and **no `opportunityId`**. The only `opportunityId` columns in the schema are on `OpportunityProduct:4102` and `OpportunityCollaborator:4120` |
| Closing an opportunity WON creates nothing | `services/opportunities/updateOpportunity.ts:50-108` sets stage, probability and close date; no booking, no lead-stage change |
| Commission never follows a booking automatically | `app/api/v1/bookings/route.ts:203-270` writes status, unit state and the frozen team/branch/region, and enqueues nothing |
| A Lead-Eagle-only workspace has no path to a booking | Leads are `LEAD_MODULES`; bookings are `'SALES'` (`bookings/route.ts:41`), opportunities/contacts/accounts are `'SALES'`; commissions are `SALES_OR_REALTY` |
| The board's "won" count and the bookings list are independent | `wonIn` treats a `CONVERSION`-category stage move as won (`services/leads/leadList.ts:56-63`) with no reference to `Booking` |

**Models.** `Account:3863`, `Contact:3916`, `Opportunity:4031`,
`OpportunityStageHistory:4099`, `Pipeline:3982`, `PipelineStage:4006`,
`Booking:7683`, `UnitInventory:6923`.

**Integrations.** None of its own.

---

## Calls, recordings, coaching, ONE AI — implemented

**Features.** Call list and call page, log a call, live-coached call screen,
recordings with consent, transcription, AI analysis, quality audit scorecards,
coaching insights, objection playbooks, practice sessions, and ONE AI — a
tool-calling assistant with 16 CRM tools.

**APIs / services.** `app/api/v1/assistant/route.ts:27` (SSE),
`calls/route.ts`, `calls/[id]/{analysis,audit,coach,live,live-audio,recording,consent,transcript,dial}/route.ts`,
`coaching/route.ts`. Services: `lib/ai/assistant/service.ts` (6-round tool
loop), `tools.ts` (the 16 tools + `executeTool:1128`), `provider.ts` (the only
file that knows a provider's wire format), `gemini.ts` (credential resolution),
`analysis.ts`, `audit.ts`, `liveCoach.ts`, `usage.ts`, `allowance.ts`,
`cascade.ts`, `guardrails.ts`; `workers/ai.ts`, `workers/liveStream.ts`.

**Models.** `Call:6093`, `Recording:6151`, `RecordingConsent:6173`,
`Transcript:6192`, `AIAnalysis:6214`, `AuditScorecard:6271`, `CallAudit:6305`,
`AiBudget:8950`, `AiRoute:9014`, `AiEvent:9049`, `WorkspaceUsage:765`.

**Notable — the assistant's two access layers.** Each tool declares
`requires: readonly [module, action][]` as data, enforced once in `executeTool`
before anything runs; the loop calls `executeTool`, never `tool.execute`, so
even the fallback path cannot miss the check. Inside each executor, rows are
scoped with the same helpers the pages use (`leadScope`, `visibilityWhere`,
`eventListScope`). `tests/security/assistant-guardrails.spec.ts:155` asserts
every tool declares a requirement and `:161` that `getCalendar` demands exactly
what `GET /api/v1/events` demands. Write-style tools return a `proposedAction`
the UI must confirm; they never write.

**Notable — credential discipline.** A workspace's own key wins; the deployment
key is the fallback; but a workspace whose connection is in ERROR while holding
a stored key is **not** moved onto the deployment key — it drops to labelled
simulation with `reason: 'connection-broken'` (`lib/ai/gemini.ts:94-98`),
asserted by `tests/tenant/gemini-broken-connection-no-fallback.spec.ts`.

---

## Commissions, collections, payouts, approvals — implemented

**Features.** Commission ledger with frozen rules and negative reversals, slab
configuration with sign-off, receipts with verification, agency-fee amendments,
recovery cases, payout runs with netting and approval, reconciliation.

**APIs / services.** `app/api/v1/commissions/route.ts`,
`commission-slabs/route.ts`, `payouts/route.ts`, `collections/receipts/**`,
`collections/{recovery,fee-amendments}/**`, `commissions/reconciliation/route.ts`.
Services: `services/money/{commissions,payouts,collections,slabs,feeAmendments,recoveryCases}.ts`.

**Models.** `Commission:7992`, `Payout:8053`, `CommissionSlab:7767`,
`CommissionSlabBand:7807`, `AgencyFeeReceipt:7839`, `AgencyFeeAmendment:7959`,
`CollectionRecoveryCase:7894`.

**Integrations.** **None.** No payment gateway, no bank, no accounting system. A
payout is recorded as released; the transfer happens outside the system.

**Notable — separation of duties, enforced in the service.** `payouts.ts:185`
requires `payouts:APPROVE` to release money and `:191` refuses the builder
approving their own run; `collections.ts:457` refuses the recorder verifying
their own receipt. An APPROVED payout whose commissions changed drops back to
DRAFT.

**One gap, confirmed:** `accrueCommission` loads the booking by
`{ id, tenantId, deletedAt: null }` and `services/money/commissions.ts`
contains no `assertRecordVisible`, `assertBookingInScope` or `visibilityWhere`
— so `commissions:EDIT` at OWN scope can accrue against any confirmed booking
in the workspace. See [`FINDINGS.md`](FINDINGS.md).

---

## Employees, teams, branches, reporting lines — implemented

**Features.** Employee directory and profiles, departments and designations,
teams, onboarding checklists, lifecycle, offboarding with settlement.

**Notable.** `EmployeeProfile:1480` hangs off `WorkspaceMembership` by a unique
`membershipId`, and the reporting line is `managerMembershipId:1505` — not a
user field. **Two different paths create an employee**: `createStaffAccount`
(`services/identity/accounts.ts:812`) makes login + membership + profile in one
transaction and needs no HRMS entitlement; the HR dispatcher's `employees` POST
creates no profile at all and issues an invitation, the profile appearing on
acceptance (`services/identity/invitations.ts:284-301`).

`Branch:1065` has **no CRUD route** — rows are only read, by scope resolution
and P&L. Teams are administered under `users:MANAGE_USERS`, outside HR.

---

## Attendance, face check-in, shifts, leave, overtime — implemented

**Features.** Face check-in and check-out with liveness, consent, nonce and
geofence; attendance record and day roll-up; attendance requests and exceptions;
temporary work locations; Face Activity; shifts, roster, shift-change requests;
leave with balances and approver routing; overtime detection and claims;
holidays; work locations.

**Notable — what works without HRMS.** There is no single gate; there are four
enforcement points, each with its own exemption list:

| Point | File:line | Exempt from HRMS |
| --- | --- | --- |
| HR reads/writes | `app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts:124` | `work-locations`, `location-assignments`, `holidays` (`:118`) |
| HR workflow verbs | `.../hr/actions/[action]/route.ts:278` | nine verbs at `:221-232` |
| HR report export | `.../hr/reports/[reportKey]/export/route.ts:41` | `attendance-summary` only |
| Self-service | `.../hr/self/[action]/route.ts:50-59` | **everything — no entitlement assert at all** |
| Pages | `people/layout.tsx:29` | bypassed by four re-exports under `attendance/` |

**Notable — the manager limit.** `attendanceScope`
(`services/hr/attendance.ts:63-67`) has exactly three outcomes: everyone for an
ORGANIZATION reader, the `reportingLine` for a TEAM-and-above attendance
approver, else oneself. `reportingLine` is **direct reports only, one level**
(`services/hr/leave.ts:90-97`), unlike the lead-side `managedUserIds` which
descends every level. A second-line manager sees their reports' attendance but
not their reports' reports'.

**Integrations.** `apps/face`, a Python service called over HTTP from
`services/hr/face.ts:102` with a bearer token. Matching, liveness and the cosine
comparison are done **in the web app** on embeddings the service returns. Env:
`FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN`, `FACE_SERVICE_TOKEN_ROTATED_AT`,
`FACE_SERVICE_TIMEOUT_MS`. **Configured in this repo** and exercised by the
`face-e2e` CI job with `FACE_E2E=required`.

---

## Payroll, payslips, WPS — implemented

**Features.** Compensation history, adjustments, payroll runs
(create → calculate → submit → approve → lock → paid), payslips with PDF, WPS
SIF export, settlement figures on offboarding, payroll register report.

**Notable — maker-checker on the record, not the role.** Whoever is stamped
`preparedById` cannot approve the run even holding `payroll:APPROVE`
(`services/hr/payroll.ts:649-651`). An employee reads only their own payslip and
only once the run reaches APPROVED/LOCKED/PAID, and each view writes a
`DOCUMENT_ACCESSED` audit row. `lockRun` stamps the overtime claims and
adjustments the run consumed so they cannot be re-paid.

**Integrations.** UAE WPS/MOL as a **generated SIF file**, no live API; keyed on
`EmployeeProfile.wpsPersonId` and `bankAgentId`. No env var configures it.

---

## Integrations — implemented, mostly unconfigured

One registry declares every connectable provider, its credential fields, its
settings and its capabilities (`lib/integrations/registry.ts:105`). All
per-tenant credentials live in `IntegrationConnection:6378` and are decrypted in
exactly one module, AES-256-GCM per value (`lib/integrations/connection.ts:23`).
Business code never branches on a vendor name.

| External system | Resolver | State in this repo |
| --- | --- | --- |
| Twilio / Exotel / Knowlarity / Plivo | `resolveTelephony` (`lib/integrations/telephony/resolve.ts:110`) | pending credentials |
| WhatsApp Business (Meta Cloud API) | `connectionCredentials(tenantId,'meta')` | pending credentials |
| Google Calendar | `calendarAccessToken(…,'google')` | pending credentials + Google scope verification |
| Microsoft 365 / Outlook | `calendarAccessToken(…,'microsoft')` | pending credentials |
| Gemini / OpenRouter | `connectionCredentials(…,'gemini')` + env fallback | pending credentials; runs labelled simulation without one |
| Speech to text | `connectionCredentials(…,'transcription')` | pending credentials |
| Property Finder / Bayut / dubizzle | per-connection secret + `verifyDelivery` | pending partner agreements |
| Google Ads lead forms | same | pending credentials |
| Custom webhook | same | **configured** — the workspace issues its own secret |
| Portal emails | `parsePortalEmail` | pending an inbound-mail relay |
| Object storage (S3/MinIO) | `lib/storage.ts:25` from env | **configured** |
| Virus scanning (ClamAV) | `scanBuffer` (`lib/antivirus.ts:135`) | **configured** (`mock` by default) |
| Email (SMTP) | `sendMail` (`lib/mailer.ts:61`) | **configured** (`mock` by default) |
| Push (FCM + APNs) | `pushTargets` (`lib/push/send.ts:283`) | pending credentials |
| Face service (`apps/face`) | `services/hr/face.ts:102` | **configured** |

`changes/PROJECT.md:450-460` is the owner's own list of what is still waiting,
and it agrees with the code.

---

## Notifications and background workers — implemented

Every notice is a bell row; its push and email copies follow the recipient's
`User.notificationPrefs`. A push never fails a job — the bell row is already
written, so retrying would re-ring phones. Eleven queues exist as a value so
monitoring can iterate them (`lib/queue.ts:13`), `JOBS` is
`Record<QueueName, Jobs>` so an undrained queue is a compile error, and the
worker process exits non-zero unless every worker actually attached.

Queue inventory, schedules and the event → job → effect map are in
[`SYSTEM-MAP.md`](SYSTEM-MAP.md) §4.

---

## Web shell, mobile, deployment — implemented

One workspace layout is the shell: sidebar, top bar with the bell, work-area
tabs, mobile tab bar, command palette, assistant widget, offline banner, native
push bridge. Data loading is separated from rendering so a render error is not
mistaken for "not signed in".

**`apps/mobile`** is a Capacitor WebView pointed at the running server, so a web
deploy updates the phones and no screen or route is duplicated
(`apps/mobile/README.md:3`). A store build is needed only for native changes
(the CallWatch call-logging plugin, push, permissions, identifiers). **Its own
README marks these builds a development proof of concept, not for submission** —
`server.url` is documented as not for production and no release keystore
exists. Separately, the standalone Lead Eagle Expo app talks to `/api/mobile/*`
with a 90-day bearer and *is* a real store build.

**Workflows.** `ci.yml` is the gate on every push and PR — one `verify` job
running 11 named gates plus typecheck, lint, format, vitest, server specs,
Playwright (PRs to `main` only), `next build` and `npm audit`; plus a `face-e2e`
job. `build-images.yml` is manual, requires a full 40-char SHA, and tags images
by SHA, never `latest`. `android-apk.yml` and `ios-testflight.yml` are manual.
