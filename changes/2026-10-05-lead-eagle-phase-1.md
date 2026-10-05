# Lead Eagle, phase 1: live in the platform portal

**What.** Lead Eagle is a product module the platform owner sells per workspace
(Plans, the New Workspace wizard, the Workspace editor), and a Lead-Eagle-only
workspace works end to end on the existing lead screens. Phase 1 of the
[plan](2026-10-05-lead-eagle-plan.md).

**Why.** Owner, 5 Oct: Lead Eagle is built inside YOUHAN ONE as the lighter,
lead-management product — leads, follow-ups, calls, assignment, attendance,
projects and listings; no collections, commissions, proposals, portal
publishing or events — named "Lead Eagle" in the menu.

**Where.**

- `prisma/schema.prisma`, migration `20261005200000_module_key_lead_eagle`:
  `ModuleKey` gains `LEAD_EAGLE` (migrations 92 → 93).
- `lib/modules/catalogue.ts`: the catalogue entry, which puts it in the portal.
- `lib/security/entitlements.ts`: `LEAD_MODULES` (Sales, Real Estate, Lead
  Eagle). 79 lead-work pages and API routes moved to it from
  `SALES_OR_REALTY`; the money and marketing ones stay.
- `app/(workspace)/[workspaceSlug]/lead-eagle/`: a layout gating
  `LEAD_EAGLE`, 21 one-line re-exports of the Sales pages, plus the Real Estate
  dashboard (which drops bookings and revenue under `/lead-eagle/`) and
  Properties.
- `lib/nav/realtyShared.ts` `LEAD_EAGLE_SHARED_ROOTS`, `leadEagleEquivalent`;
  `sales/layout.tsx` sends a `/sales/` link to Real Estate, else Lead Eagle.
- `lib/nav/workspaceNav.ts`: the Lead Eagle section (shown where it is the
  whole CRM — hidden when Sales or Real Estate is also owned; tabs can now hide
  for a list of modules); `activeModule` knows `lead-eagle`. `TopBar`,
  `MobileTabBar`, `SalesLink`, the Create menu and the live-call page follow.

**Behaviour.** A Lead-Eagle-only workspace sees a Lead Eagle menu (Dashboard;
Leads, Follow-ups, Calls, Site Visits, Requirements, Allocation; Properties,
Projects, Listings; Reports), the phone tab bar for it, and Create → Lead and
Call. Collections, commissions, proposals, portals, events and Sales-only
registers are refused, by the API as well as the menu.

**Verified.** `tests/unit/lead-eagle-routes.spec.ts` (re-exports, both sides of
the API boundary, the redirect), `module-entitlement.spec` (leads 200;
opportunities and collections 403), `workspace-nav.spec`, the full unit suite;
`tests/e2e/lead-eagle-workspace.spec.ts` creates a Lead-Eagle-only workspace
through the portal's wizard and works a lead in it.

**Left open.** Phases 2–6 of the plan. Release with 93 migrations:
`chain-release.sh <sha> 93`.
