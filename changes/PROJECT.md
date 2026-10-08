# YOUHAN ONE — project state

Updated 2026-10-08. Production runs `main` at 6ebdb2e, released 8 Oct, with
98 migrations; `main` is ahead of production where the index says so.

## The product

Multi-tenant SaaS for UAE real-estate brokerages and sales teams: one platform,
and product modules a workspace is entitled to (`src/lib/modules/catalogue.ts`).
Paths below are under `apps/web/`.

| Module | Folder under `src/app/(workspace)/[workspaceSlug]/` | Screens | Covers |
|---|---|---|---|
| Sales | `sales/` | 73 | leads (spreadsheet import, close-out), contacts, accounts, opportunities, tasks, follow-ups; calls with AI coaching, analysis and audits; campaigns, inbox, forms, landing pages, social leads; dashboards, leadership (productivity, value, daily target); projects, listings, bookings, collections, commissions, proposals, portals |
| HRMS | `people/` | 32 | employees, users, roles, departments; face check-in, attendance, shifts, roster, leave, overtime; payroll, payslips, WPS; recruitment, performance, documents, compliance |
| Real Estate | `realty/` | 34 | the Sales property screens as a brokerage works them, plus Properties, allocation (data pool), events with QR passes, lead recycling |
| Lead Eagle | `lead-eagle/` | 23 | the lead-management product: Real Estate's lead screens without the money and marketing ones — dashboard, leads, follow-ups, calls, site visits, requirements, allocation, properties, projects, listings, reports. Leads arrive from Property Finder, Bayut, Dubizzle and Google Ads lead forms (Admin → Integrations → Lead sources; any lead module). Every lead module also has QR Capture and Cold Data, and Lead Stages under Administration → Settings |

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
  or field rule read that way silently reads as "no rule".
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
- **Permissions.** Roles live in the database. A new workspace gets one role,
  Company Admin, holding every permission; the admin builds the others in the
  role editor. Scopes run OWN < TEAM < BRANCH < REGION < ORGANIZATION; check with
  `atLeast(ctx, module, action, scope)` (`src/lib/security/rbac.ts`). HR's
  predicates are in `src/services/hr/access.ts`. A manager's authority over
  people stops at their reporting line (`reportingLine`, `src/services/hr/leave.ts`).
- **API kernel.** `route()` and `bareRoute()` in `src/lib/api/handler.ts`. Prisma
  P2002 answers 409 and P2025 404, a zod failure 422 — let the database say
  "already exists" or "not found" instead of reading first.
- **Attendance is not HR.** Check-in, the attendance record and attendance
  requests work in every workspace; everything else in HR needs HRMS.
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
