# Reassessment and functional-preservation plan

Date: 2026-08-03

## Decision

Stop the replacement-style redesign. Preserve the original HRMS and LeadFlow
workflow surfaces and place a neutral premium SaaS control plane and workspace
shell above them. Migration proceeds feature-by-feature only when the original
workflow, data rules, permissions and regression tests are demonstrably intact.

## Current broken-functionality list

1. Slugged Sales pages use generic tables and a reduced lead form instead of the
   original `LeadGrid`, `LeadDetail`, assignment, stage, activity, task, call,
   campaign and reporting workflows.
2. Most original LeadFlow routes remain only at unscoped compatibility URLs such
   as `/leads` and `/opportunities`; the workspace shell does not wrap them.
3. The generic Sales resource route is read-only for opportunities, accounts,
   contacts, activities, tasks, calls and campaigns.
4. The slugged Sales calendar is a task table, and the Sales report is four row
   counts. Neither preserves the original UI or behavior.
5. HRMS pages use a new reduced Prisma model and generic forms instead of the
   original biometric, geofence, leave approval, lifecycle, document and RBAC
   workflows.
6. The copied Python HRMS is not in the current runtime. Its presence does not
   make its features available at port 3000.
7. HR attendance is manual record entry; the original face/liveness challenge,
   preflight, offline queue, geofence and review flow is unavailable.
8. Leave submission exists, but balances, policies, cancellation, approval,
   rejection, calendar and carry-forward are unavailable.
9. Document pages store metadata only; upload, encrypted storage, authorization,
   download, expiry and retention are unavailable.
10. The workspace sidebar omits many reviewed HRMS and LeadFlow functions and is
    not permission-filtered at item level.
11. The shared shell lacks a workspace switcher, subscription badge, global
    search, help, complete user/security menu, breadcrumbs and polished responsive
    behavior.
12. `/platform/settings` is missing. The owner dashboard lacks required trial,
    suspended, module-mix, usage, billing, registration, security and status views.
13. The original LeadFlow regression suite is not a green gate: request helpers
    invoke Next dynamic APIs without request context, several endpoints are 501,
    and the RLS test submits invalid multi-statement prepared SQL.
14. The original HRMS aggregate test is affected by Windows temp-directory access
    for face/vault tests. The business tests pass, but the 18 temp-file setup errors
    must be eliminated before claiming a green baseline.
15. HRMS SQLite data has not been imported into tenant-owned PostgreSQL tables.
    New tables are not the same as a verified data-preserving migration.
16. RLS policies exist and the acceptance test proves `SET ROLE` behavior, but the
    local application connection still uses the migration owner rather than a
    dedicated non-bypass runtime login with per-transaction tenant context.

## Shared workspace model

The canonical hierarchy is:

```text
PlatformUser
  └─ WorkspaceMembership ── MembershipRole ── Role ── RolePermission
       ├─ Tenant / Workspace
       │    ├─ TenantSubscription ── SubscriptionModule
       │    ├─ ModuleEntitlement
       │    ├─ WorkspaceUsage
       │    ├─ EmployeeProfile and HRMS records
       │    └─ LeadFlow records
       └─ PlatformSession (active workspace)
```

- `Tenant.id` remains the canonical workspace identifier already used by
  LeadFlow. Every HRMS import receives this same ID as `tenantId`.
- `PlatformUser` owns email, password hash, authentication factors and sessions.
- `WorkspaceMembership` owns company status, primary-admin identity and the
  compatibility link to the existing LeadFlow `User` record.
- `EmployeeProfile` is the shared directory identity. Original HRMS employee
  fields are extended onto tenant-owned HR records rather than creating a second
  company or user.
- `TenantSubscription`, `SubscriptionModule`, `ModuleEntitlement`, `PlanLimit`
  and `WorkspaceUsage` are the commercial enforcement boundary.

## Shared authentication model

1. `/login` authenticates `PlatformUser` once.
2. Owner role routes directly to `/platform` and never asks for a workspace slug.
3. A company user selects an active membership (automatically when only one) and
   receives one `PlatformSession` carrying the active tenant and membership.
4. LeadFlow's existing authorization context is adapted from the membership's
   compatibility `User`, preserving its role rank, permission and visibility
   behavior without a second password or session.
5. HRMS browser calls go through workspace-aware Next BFF routes. The BFF passes a
   short-lived signed internal principal and canonical tenant ID to any temporarily
   retained private Python domain endpoint; the Python service does not authenticate
   customers or issue customer tokens.
6. TOTP/recovery is migrated into `AuthenticationFactor` and applied at the shared
   identity layer before the legacy HRMS bearer/refresh path can be retired.
7. Workspace, membership, employee or user suspension invalidates applicable
   sessions immediately.

## Subscription and module model

- Plans define normalized enabled modules and default user, employee and storage
  limits.
- A workspace subscription records state, trial/period dates and module rows.
- Module entitlements are checked server-side before every HRMS or Sales handler.
- Disabling a module hides its navigation and returns 403 from its APIs, but does
  not delete records.
- Workspace overrides can lower or raise licensed limits with an owner audit event.
- Usage is measured from authoritative records, not client counters, before create
  operations and on a scheduled reconciliation job.

## Platform Owner page plan

| Route | Preserve/build behavior |
|---|---|
| `/platform` | Operational overview with workspace state, module mix, users, employees, usage, billing summary, registrations, security events and system status |
| `/platform/workspaces` | Searchable company ledger with plan, state, modules, usage and renewal/trial dates |
| `/platform/workspaces/new` | Existing transactional create flow, improved validation and logo/admin invitation handling |
| `/platform/workspaces/{id}` | Company profile, subscription, modules, usage, administrators, security events and suspend/archive controls |
| `/platform/plans` | Create, version, update and deactivate plans without mutating historical subscriptions |
| `/platform/subscriptions` | Filterable lifecycle and module view with manual reconciliation controls |
| `/platform/users` | Platform identities, memberships, security state and session revocation |
| `/platform/audit` | Immutable, filterable platform events and export |
| `/platform/system-health` | Database, Redis, queue, storage, worker and provider health with history |
| `/platform/settings` | Configurable platform name/logo/favicon/primary colour/support email |

## UI integration plan

### Subject and users

An operational control system for multi-company HR and revenue teams, used by
office administrators on desktop and field staff on mobile. Its job is to expose
company context and licensed modules without making familiar HRMS and LeadFlow
workflows relearned.

### Token direction

- Command navy `#102A43`: neutral global shell and owner control plane.
- Workspace blue `#1F5E8C`: active workspace and navigation focus.
- Cloud `#F5F7FA`: application canvas.
- Graphite `#243B53`: primary copy and dense operational data.
- HR teal `#087F8C`: HRMS module cue, inherited from the original HR experience.
- Sales burgundy `#7A263A`: LeadFlow module cue, retained only inside Sales.

Typography: self-hosted **Instrument Sans** for navigation/body, **IBM Plex Sans
Condensed** for operational headings, and **IBM Plex Mono** for references,
timestamps and audit values. Until font files are approved, use deterministic
system fallbacks without network-loaded fonts.

### Layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Master SaaS | Workspace switcher | Search | Help | Alerts | Profile │
├───────────────┬─────────────────────────────────────────────────────┤
│ Workspace     │ Breadcrumbs                    Subscription / usage │
│ Overview      ├─────────────────────────────────────────────────────┤
│ People / HRMS │ Original module page header + original actions      │
│ Sales CRM     │ Original filters, forms, tables, detail workflows   │
│ Administration│                                                     │
└───────────────┴─────────────────────────────────────────────────────┘

Mobile
┌─────────────────────────────┐
│ Menu | Workspace | Alerts   │
├─────────────────────────────┤
│ Breadcrumb / module marker  │
│ Original workflow, stacked  │
│ Bottom-safe primary action  │
└─────────────────────────────┘
```

Signature element: a slim dual-module context rail beneath the global header. It
shows the active workspace, licensed HRMS/Sales modules and current module colour
without recoloring the whole product. This encodes real hierarchy rather than
adding decoration.

Self-critique: an earlier wine/brass global shell made the platform look like a
Sales skin, and generic large-number cards made every dashboard interchangeable.
The revised shell is neutral and restrained; module identity appears only where it
helps orientation. Owner data is presented as an operational ledger and compact
summary strip, not decorative hero metrics.

## Existing components and logic to reuse

LeadFlow, unchanged wherever possible:

- `LeadGrid`, `LeadDetail`, `LeadForm`, `StageRail` and filter-tree compiler.
- `AccountForm`, `ContactForm`, `OpportunityForm` and their detail/list pages.
- `CalendarView`, `ViewSidebar`, `CallActions`, `AnalysisPanel` and campaign detail.
- `TopBar` notification behavior, `Badge`, `EmptyState`, `Skeleton`, `MetricCard`.
- All existing route handlers, validation schemas, visibility scopes, field
  projection, soft deletion, audit, provider and worker services.

HRMS, preserving workflows while adapting transport and persistence:

- `checkin.html` challenge/camera/offline-queue flow and attendance rules.
- `attendance.html` daily/review workflows.
- `leave.html` balances/apply/pending/decision/calendar interaction.
- `people.html` onboarding, checklists, documents, offboarding and settlement.
- `locations.html` geofence CRUD, assignments, temporary and exception decisions.
- `users.html`, `roles.html`, `security.html` and their permission-aware controls.
- Python leave, lifecycle, rules, RBAC, TOTP, document, face and face-vault domain
  services, temporarily behind authenticated internal endpoints where needed.

## Components that genuinely require improvement

- A new global SaaS shell, workspace switcher, breadcrumbs, subscription/usage
  context, global search and complete account/security/help menus.
- A workspace-aware link helper so reused LeadFlow views emit slugged URLs without
  rewriting business components.
- A shared BFF transport adapter for preserved HRMS browser workflows.
- Platform Owner settings, operational overview and usage/subscription detail.
- Common accessible loading, error, permission-denied and empty-state contracts.
- Responsive shell behavior around the original module layouts; module-specific
  content is adjusted only where measured overflow or accessibility requires it.
- Test harnesses and fixtures. These are prerequisite infrastructure fixes, not
  product redesign.

## Regression-testing plan

1. Freeze hashes of the untouched source applications and record intentional
   differences.
2. Make the original HRMS business suite green using a workspace-owned pytest
   temp directory; run face/model tests separately and record model availability.
3. Repair only the copied LeadFlow test harness in `master-saas`: provide a real
   Next request context, replace 501 helper stubs with real handlers, split RLS SQL
   into a transaction and run against a disposable tenant database.
4. For each matrix row, add a preservation contract that executes the original
   and unified workflow against equivalent fixtures and compares persisted state,
   authorization result and audit events.
5. Add browser scenarios at desktop and 375px mobile for the original critical
   workflows before changing their visuals.
6. Required vertical scenario: owner creates Manath Homes with Business modules;
   administrator logs in once, creates a department and employee, assigns the
   Sales role, creates/assigns a lead, creates an opportunity, submits/approves
   leave, views attendance and audit; all records share one tenant ID.
7. Create Leadersfort and prove employee, lead, document and audit isolation at
   API, repository and PostgreSQL RLS layers.
8. Test HR-only, Sales-only and Business entitlement behavior with data retained
   after disabling/re-enabling a module.
9. Run typecheck, production build, migration rehearsal and PowerShell launcher
   checks only after functional regression is green.

## Data-migration plan

1. Put source systems in a controlled read-only window and create checksummed
   backups of Sales PostgreSQL, `manath_homes.db`, HR documents, encrypted face
   captures/templates and encryption-key metadata. Never migrate the sole copy.
2. Create a staging schema. Import HRMS rows without transforming in place and
   attach a batch ID, source table, source primary key and checksum.
3. Select/create the target workspace explicitly. Never infer a tenant from a
   hard-coded company name.
4. Match HRMS employees to `PlatformUser` by normalized verified email, then by a
   reviewed employee-code map. Ambiguous matches enter a review table.
5. Map original tables in dependency order: employees/sites/roles/permissions;
   locations and assignments; leave types/balances/requests/holidays; checklists
   and documents; face templates; punches/days/challenges; audit/session history.
6. Preserve original identifiers in `sourceSystem`/`sourceId` mapping records.
   Every target HR row receives the selected canonical `tenantId`.
7. Copy files to tenant-prefixed object keys and verify byte hashes before marking
   a document migrated. Re-encrypt only through an approved key-rotation process.
8. Reconcile source/target counts, sums, status distributions, orphan references,
   document hashes and employee ownership. Execute negative cross-tenant probes.
9. Run a shadow read comparison, then a staged cutover. Invalidate all legacy
   customer sessions when shared login becomes authoritative.

## Rollback plan

- Original `HRMS` and `Sales Lead Flow` directories remain untouched and runnable.
- All shared-schema changes are additive until a feature's preservation contract
  passes. No source column/table is dropped in the migration milestone.
- Each data import uses a batch ID. Before cutover, rollback deletes only rows from
  that verified batch after confirming the target workspace and backup paths.
- During cutover, source writes are paused. If reconciliation, browser regression
  or security checks fail, disable the unified route, restore source write access
  and invalidate only sessions issued during the failed window.
- After shared sessions or post-cutover writes exist, rollback requires a
  maintenance window, dual-write reconciliation and explicit user approval; it is
  not an automated destructive script.
- Visual changes stay behind the shared shell/module adapter boundary so reverting
  the shell does not revert or alter module records.

