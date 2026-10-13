# YOUHAN ONE — project state

Updated 2026-10-11. Production runs `main` at f9c0c1a, released 11 Oct, with
101 migrations; `main` is ahead of production where the index says so.

## The product

Multi-tenant SaaS for UAE real-estate brokerages and sales teams: one platform,
and product modules a workspace is entitled to (`src/lib/modules/catalogue.ts`).
Paths below are under `apps/web/`.

| Module | Folder under `src/app/(workspace)/[workspaceSlug]/` | Screens | Covers |
|---|---|---|---|
| Sales | `sales/` | 75 | leads (spreadsheet import, close-out), contacts, accounts, opportunities, tasks, follow-ups; calls with AI coaching, analysis and audits; campaigns, inbox, forms, landing pages, social leads; dashboards, leadership (productivity, value, daily target); projects, listings, bookings, collections, commissions, proposals, portals |
| HRMS | `people/` | 32 | employees, users, roles, departments; face check-in, attendance, shifts, roster, leave, overtime; payroll, payslips, WPS; recruitment, performance, documents, compliance |
| Real Estate | `realty/` | 40 | the Sales property screens as a brokerage works them, plus Properties, allocation (data pool), events with QR passes, lead recycling, website forms and landing pages |
| Lead Eagle | `lead-eagle/` | 29 | the lead-management product: Real Estate's lead screens without the money and marketing ones — dashboard, leads, follow-ups, tasks, calls, site visits, requirements, allocation, properties, projects, listings, reports. Leads arrive from Property Finder, Bayut, Dubizzle and Google Ads lead forms (Admin → Integrations → Lead sources; any lead module), and a lead can be recorded as a Referral with its referrer. Every lead module also has QR Capture, Cold Data, Targets, website forms and landing pages (public `/f/{ws}/{key}` and `/l/{ws}/{slug}`; `/embed.js` frames a form on the brokerage's own site), and Lead Stages, Sources (the source and sub-source catalogue, each entry's starting score, and the score decay) and Custom Fields under Administration → Settings; and on the lead page a requirement, interest links to projects and listings, and the workspace's custom fields |

Outside the modules: `check-in` and `attendance` (every workspace), `admin/`
(users, roles, work locations, settings, audit), `profile/`, and the platform
console in `src/app/(platform)/platform` (workspaces, plans, subscriptions, AI
Control Center, monitoring grants).

Also in the repo: `apps/mobile` (iOS and Android WebView shells — a web change
never needs a new store build), `apps/face` (the face-recognition service,
Python), `apps/web/infra` (compose files, Dockerfile, Prometheus), `docs/`.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Prisma 7 on
Postgres with row-level security, Redis and BullMQ, zod, vitest, Playwright.
Node 22 or newer (CI uses 24).

## Rules every change follows

- **Tenancy.** Every query names its tenant; `src/lib/db.ts` refuses one that
  does not, and Postgres row-level security backs it. A read that must span
  tenants goes through `withPlatformTx`, nothing else. Inside `withTx`, query
  through its `tx` only: the global client there runs on another connection
  with no tenant set, where row-level security returns nothing — a permission
  or field rule read that way silently reads as "no rule". The same guard
  hides soft-deleted rows only of the model queried: an `include` of a model
  with `deletedAt` filters it itself.
- **One record, several screens.** Real Estate reuses Sales' rows (`Lead`,
  `Call`, `SiteVisit`, `Booking`, `Project`, `Listing`, `UnitInventory`);
  `realty/` and `lead-eagle/` pages are one-line re-exports of `sales/` pages,
  and `tests/unit/realty-routes.spec.ts` and `lead-eagle-routes.spec.ts` guard
  that. Never add a parallel model.
- **Entitlement.** A page asserts its module with
  `resolveWorkspacePage(slug, { module, permission })` (`src/lib/workspace-page.ts`);
  an API route with `route({ productModule })` (`src/lib/api/handler.ts`).
  Shared screens assert a set: `LEAD_MODULES` (Sales, Real Estate, Lead Eagle)
  for lead work, `SALES_OR_REALTY` for money and marketing, `PRODUCT_MODULE_KEYS`
  for any module. A layout asserting a module covers everything beneath it, so a screen
  that must work without that module is re-exported from outside its folder.
  A module layout (`workspaceOwns`) shows `NotInPlan` for a module the plan
  lacks, never a silent redirect. `NotInPlan` sends the viewer to the same
  screen under a product the plan has (`sameScreenElsewhere`,
  `src/lib/nav/realtyShared.ts`), else names every product that carries it; the
  API's refusal names every module of the set ("Sales or Real Estate is not
  enabled for this company."). Next still renders the page beneath `NotInPlan`,
  so every page in a module folder asserts its module itself
  (`tests/permission/page-access.spec.ts`).
- **Permissions.** Roles live in the database. A new workspace gets one role,
  Company Admin, holding every permission; the admin builds the others in the
  role editor. Lead Eagle's arrival adds five editable starter roles (Manager,
  Team Lead, Agent, Telecaller, Viewer; `src/services/platform/provisioning.ts`).
  Scopes run OWN < TEAM < BRANCH < REGION < ORGANIZATION; check with
  `atLeast(ctx, module, action, scope)` (`src/lib/security/rbac.ts`). A record
  loaded by id is checked with `assertRecordInScope`
  (`src/lib/security/record-scope.ts`): out of scope answers 404, like a
  missing id. A lead's second owner (`secondaryOwnerId`) reaches it as its
  owner does: lead reads go through `leadScope` (placing a waiting lead from
  the Allocation queue excepted). A lead's requirement on its page and its
  interest links (projects, listings) are the lead's: written under
  `leads:EDIT` on its scope, an interest naming, and the lead page showing,
  only a project or listing the caller can see. HR's predicates are in `src/services/hr/access.ts`. A manager's authority over
  people stops at their reporting line (`reportingLine`, `src/services/hr/leave.ts`).
  A task is read under `tasks` wherever it shows, a lead's page included, and
  a follow-up under `leads` (`src/services/leads/nextFollowUp.ts`); a task is
  changed only where `tasks:VIEW` and `leads:EDIT` both reach its owner. The
  Follow-ups and Tasks lists and their APIs show everyone that scope covers, and
  the caller's own under Mine (`?view=mine`; `workListScope`). Cold data
  follows the same rule (`coldDataScope(ctx, action)`), and working a cold
  record logs a call on it (`Activity.dataRecordId`) that the daily target
  and the check-out gate count (`services/targets/dailyBoard.ts`); making it a
  lead moves those calls onto the lead. Targets (`api/v1/targets/**` but the
  Sales-only manual tally `targets/progress`, the Targets page under Sales,
  Real Estate and Lead Eagle) are every lead module's and follow the caller's
  `leads` scope; below ORGANIZATION nobody sets, changes or deletes their own
  (`targetReach`, `targetAssignees`). The daily board shows check-in times
  only under the viewer's `attendanceScope`. A
  record loaded by id outside the caller's scope answers 404, as a missing id
  does (`src/lib/security/record-scope.ts`). TEAM, BRANCH and REGION mean the
  caller's resolved owners (`resolveOwnerIds`), never the whole workspace, in a
  list and by id alike: every read of calls adds `callScope(ctx, action)` (a
  call is its caller's), every read of events `eventListScope(ctx, action)`
  (host or creator; an invitee reads), screens, counts and the assistant
  included. A call's or event's write checks it at the route's own action, and
  a page offers that write only where the same check passes.
  Whoever names a new owner for work (a task, follow-up, lead, cold record,
  capture link, social enquiry, an event's host or callers, a hand-over) is
  checked with `assertAssignableUser` / `assignableUserWhere`: an active
  member inside the caller's ASSIGN scope, 404 (or the route's own unknown-user
  answer) otherwise. A picker of people lists `assignableUsers`; a screen that
  also names people (who assigned or replied) keeps a separate list for that.
  The allocation queue's manual placement is the exception: only ORGANIZATION
  reaches a waiting lead, and its picker lists every active agent with their
  eligibility.
- **Identities.** A workspace path that attaches an existing platform identity
  (Add user, invite and accept, a new workspace) takes it through
  `assertIdentityReusable` and sets it ACTIVE with `activateIdentity`
  (`src/services/identity/accounts.ts`): a suspended, deactivated, deleted or
  erasing account answers 409, with one neutral message to a workspace
  administrator. A suspended or deactivated one comes back only through the
  platform console's reactivate, an erasing one when its owner withdraws the
  request, a deleted one never.
- **Sensitive fields.** A lead's phone numbers and email are masked for a role
  without `leads:VIEW_SENSITIVE_FIELDS` (`LEAD_SENSITIVE_FIELDS`,
  `src/services/leads/createLead.ts`). A screen or route that shows a lead or a
  number it holds serialises it through `applyFieldSecurity`, `asLeadPhone` or
  `maskCallNumbers` (a call's lead side), and builds `tel:` and `wa.me` links
  with `dialable()`, which refuses a mask. A notification names the lead, not
  its number. Cold Data shows a record's number as stored to its own agent and
  as a lead's phone reads to the role otherwise. Still outside it: the
  campaign dialer, event invitees and the inbox
  (`changes/2026-10-11-lead-contact-masking.md`).
- **API kernel.** `route()` and `bareRoute()` in `src/lib/api/handler.ts`. Prisma
  P2002 answers 409 and P2025 404, a zod failure 422 — let the database say
  "already exists" or "not found" instead of reading first.
- **Audit.** The rule for new code: every write should leave an AuditLog row,
  through the route's `auditEvent`, or `audit(ctx, …)`
  (`src/lib/security/audit.ts`) where the route cannot say enough. A write no
  person makes (a webhook, a worker) calls `audit({ tenantId, source }, …)` and
  shows as System. Not all existing writes do yet; the known gaps are listed in
  `changes/2026-10-11-report-export-audit.md`. A file out of the building needs
  EXPORT, not VIEW, and writes `EXPORT_REQUESTED`.
- **Attendance is not HR.** Check-in, the attendance record and attendance
  requests work in every workspace; everything else in HR needs HRMS.
- **Lead scores** move by event, each a LeadScoreHistory row and an audit row
  (`src/services/leads/scoring.ts`): a new lead starts at its source's
  `weight`, a logged activity adds its type's `scoreDelta` (taken back if the
  activity is deleted), and the nightly `lead-score-decay` job applies the
  workspace's first DECAY `ScoringRule` (off unless set). Each move locks the
  lead's row. The post-call AI temperature still sets the score outright.
- **Background jobs.** One `JOBS` table in `src/workers/jobs.ts`, keyed by queue;
  `src/workers/index.ts` starts a worker per queue. CI's observability gate reads
  that table, so keep it a literal.

## Testing and verifying

From `apps/web`:

| What | Command |
|---|---|
| Unit and integration (needs Postgres and Redis) | `npx vitest run [files]` |
| Specs that drive a running server | `npm run test:server` |
| Browser | `npx playwright test`; the demo-workspace specs need `E2E_DEMO_SLUG`, `E2E_DEMO_EMAIL`, `E2E_DEMO_PASSWORD` |
| Types, lint, format | `npx tsc --noEmit`, `npm run lint`, `npm run format:check` |
| Production build | `npx next build`, with `NODE_ENV` unset — `development` breaks prerendering |

CI (`.github/workflows/ci.yml`, one `verify` job) also gates the permission
catalogue, schema drift, tenant isolation, raw-SQL scope, observability drift,
Redis auth, the face token check, the backup round trip, the build and
`npm audit`, and fails on any skipped test. Browser tests run only on PRs to
`main` and on pushes to `main`.

House rules: one finding per commit; a behaviour fix comes with a test that
fails on the old code; a UI change is checked in a browser at phone and desktop
width.

## Releasing

1. Merge to `main` and wait for its CI.
2. Build the images: `gh workflow run build-images.yml -f sha=<full sha>`.
3. The owner runs the release: staging first, then the staging-first migration
   gate, backup and restore drill, production and the smoke test; it stops at
   the first failure. Claude cannot SSH to production, and merging is the
   owner's too unless allowed in Claude Code's settings.

## Requirements and status

The owner's list of 19 Sep (§1–§19: UI, roles, face check-in and check-out,
productivity, work-gated check-out, lead import, delete rights, live AI call
guidance, calls, call audit, measured value, tokenomics, narrative, guardrails,
success metrics, AI evaluation, budgets, model fallback) was accepted on 19 Sep
with named tests: `apps/web/docs/ACCEPTANCE-2026-09-19.md`. Built since: the
daily lead target, the app-wide redesign, the AI Control Center, CRM monitoring,
the Real Estate module, proposals and portals, attendance in every workspace.

Waiting on the owner:

- **Lead Eagle inside YOUHAN ONE** — every phase of the plan
  (`changes/2026-10-05-lead-eagle-plan.md`) is live: phase 1 since f89ae61,
  phases 2–6 since c46624f (8 Oct, #134 + #139). What waits on the owner:
  partner credentials for the portals and Google Ads, opening sign-up, and a
  real standalone database for the move tool, if one exists.
- **Self-serve sign-up** — built and closed: the platform owner decides whether
  to open it (console → Settings → Self-serve sign-up, trial days).
  Phase 2 is built: Google Ads lead forms work once connected; Property Finder,
  Bayut and Dubizzle deliver only to approved partners, so each needs its
  partner agreement and its signing secret. The standalone Lead Eagle has no
  deployment and no remote; its local database holds test and seed workspaces
  only (7 Oct). Phase 5's tool (`scripts/move-lead-eagle.ts`, dry run by
  default) moved the seed company on the rig; it runs for a real company when
  a copy of its database exists.
- **Real AI and telephony** — a Gemini API key; a Twilio account with Media Streams.
- **Store submissions** — iOS and Android, in the owner's store consoles.
- **Read-only CRM monitoring of every workspace** — built (v1.4.0), but nobody
  can be granted it until `openCoverage` takes a `kind`; that edit needs the
  owner's permission.
- **Product questions** — `docs/product/DECISIONS-REQUIRED.md`: 17 with no
  recorded answer; the file was last updated 12 Sep.
