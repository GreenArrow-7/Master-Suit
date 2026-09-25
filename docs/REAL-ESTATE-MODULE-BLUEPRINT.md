# Real Estate module — blueprint

Drafted 2026-09-24 from inspection of the tree. No code written yet.

## The finding that shapes everything

**This is not a greenfield build.** The Sales module already contains most of a real-estate
brokerage. The schema has `Developer`, `Project`, `ProjectMedia`, `UnitPlan`, `UnitInventory`,
`Listing`, `ListingMedia`, `SiteVisit`, `Booking`, `ClientRequirement`, `Lead` (+ stages, history,
assignment history), `Call`, `CallAudit`, `FollowUpTask`, `Activity`. The screens exist too:
`listings`, `projects`, `site-visits`, `requirements`, `collections/[bookingId]`, `commissions`,
`allocation`, `clients`, `leads`, `calls`, `follow-ups`.

Property matching is built: `matchesForRequirement` in `services/inventory/demand.ts`, already shared
by the Requirements screen and the live-call coach, and it returns `whyMatch` reasons per match.

So the work is **module extraction, navigation and dashboard**, plus four genuine gaps. Treating it
as a from-scratch build would duplicate a working domain model and split the data.

---

## 1. Existing functionality to reuse

| Need | Reuse |
|---|---|
| Leads, stages, assignment, history | `Lead`, `LeadStage`, `LeadStageHistory`, `LeadAssignmentHistory`, `LeadTriageEntry` |
| Buyer requirement | `ClientRequirement` (purpose, propertyTypes, micromarketIds, bedrooms, area, budget, possessionBy, furnishing) |
| Matching | `matchesForRequirement` — deterministic today, which is what was asked for |
| Property / inventory | `Project`, `UnitInventory`, `UnitPlan`, `Developer`, `Listing`, `ListingMedia`, `ProjectMedia` |
| Site visits | `SiteVisit` + its screens |
| Deals / bookings | `Booking`, `collections/[bookingId]`, `commissions` |
| Calls, recordings, transcripts, AI | `Call`, `CallAudit`, live coaching workspace |
| Follow-ups | `FollowUpTask`, `follow-ups` screen |
| Documents | existing document upload/download with scope refusals |
| Auth, workspace, roles, scope | `requirePageAccess`, `can`, `scopeFor`, `visibilityWhere`, `SCOPE_RANK` |
| Notifications | `NotificationOutbox` + worker (kinds `LEAD_ASSIGNED`, `CALL_FOLLOW_UP`, `LEAD_TRIAGE_OVERDUE` already exist) |
| Audit | `auditLog` / `audit()` |

## 2. Stays outside Real Estate

Attendance, leave, payroll, employee master — HRMS owns these. Real Estate reads `Employee` for
agent identity, team and manager and **must not** create a second employee table. Platform console,
billing, entitlements, and the generic Sales pipeline (non-property B2B) stay where they are.

## 3. Missing entities — the genuine gaps

1. **Data Pool** — no equivalent exists. `LeadTriageEntry` is an assignment queue, not a cold list.
2. **Proposal** — absent.
3. **Lead recycling** — absent (no `recycl*` anywhere).
4. **Off-Plan view** — no entity needed; it is a filtered view over `Project` + `UnitInventory`.

## 4. Schema changes

Phase 1 needs exactly one:

- `enum ModuleKey { HRMS SALES }` → add `REAL_ESTATE`. Additive enum value; safe, non-destructive.

Later phases:

- `DataPoolRecord` (tenantId, name, phone, email?, source, campaign?, ownerId?, status, notes,
  importBatchId, convertedLeadId?, timestamps) + an index on (tenantId, status, ownerId).
- `Proposal` + `ProposalItem` (lead, agent, listings/units, generated document ref).
- Recycling needs **no new table** — a nullable `recycledAt`/`recycleEligibleAt` on `Lead` plus the
  existing assignment history preserves provenance without duplicating the lead, as specified.

## 5. Navigation

New top-level section, own areas, same `workspaceNav.ts` structure:

```
REAL ESTATE
  Dashboard · Leads · Data Pool · Properties · Projects · Listings
  Off-Plan · Follow-ups · Calls · Site Visits · Deals · Reports
```

Routes under `(workspace)/[workspaceSlug]/realty/…` — a distinct prefix so `activeModule()` can tell
it from `sales/` and `people/`. **Note:** `activeModule()` and `MobileTabBar` currently understand
two products; both need a third branch. This is the one piece of "global navigation architecture"
that genuinely must change.

## 6. Dashboard layout

Three bands, every tile linking to a filtered screen:

- **Today** — Today's Follow-ups, Today's Site Visits, Callbacks, New Leads
- **Pipeline** — Total Leads, Site Visits Scheduled/Done, Bookings, Won Deals, Leads by Source
- **Money & inventory** — Revenue Today / 7 Days / Total, Available Inventory, Top Agents, Recent Activity

Role-aware via existing scope: `scopeFor(ctx, 'leads', 'VIEW')` already yields OWN/TEAM/BRANCH/ALL,
so agent/leader/manager views fall out of the current infrastructure rather than new code.

## 7. Lead workflow

Reuse `LeadStage` — it is **configurable**, so the requested lifecycle (NEW → ASSIGNED → CONTACTED →
CALLBACK → QUALIFIED → SITE_VISIT_SCHEDULED → SITE_VISIT_DONE → NEGOTIATION → BOOKING → WON/LOST)
ships as seeded stages for a real-estate workspace, not hardcoded enums.

## 8. Data Pool workflow

`DataPoolRecord` → agent calls → interest → **Convert to Lead**, carrying source, agent, notes,
campaign, timestamps and call history; `convertedLeadId` links the two so no duplicate contact is
created. Dedupe on convert via the existing `findDuplicates` / `normalizePhone`.

## 9. Property / inventory model

No new model. `Developer → Project → UnitPlan/UnitInventory`, with `Listing` for resale/rental and
`ListingMedia`/`ProjectMedia` for images. Off-Plan is a view filtered on project status + handover.

## 10. Site visit workflow

`SiteVisit` exists with the approval state machine. Add outcome capture on completion that offers
"create next follow-up" inline — one interaction, per the UX rule.

## 11. Buyer matching

`ClientRequirement` → `matchesForRequirement` → shortlist → proposal → site visit. Deterministic, as
specified. No AI matching in this scope.

## 12. Deal workflow

`Booking` + `commissions`. No accounting in this module.

## 13. Permissions

Follow the existing catalogue convention (module + action, enforced server-side by
`requirePageAccess` / `assertPermission` — hiding a button is not authorization). New modules:
`realty_leads`, `realty_datapool`, `properties`, `projects`, `listings`, `sitevisits`,
`requirements`, `deals`, `realty_reports`. Reuse `calls`, `documents`, `tasks` as-is. Grants added to
`prisma/seed/roles.ts` for brokerage roles; **no role gains a permission it does not already hold in
spirit**, and `employee`-class roles gain nothing.

## 14. Reusable UI

`ListHeader`, `ConfigurableGrid`, `ColumnEditor`, `gridCells`, `CallLink`, `Badge`, `EmptyState`,
`SalesLink` (needs a `RealtyLink` sibling or a module-aware base), `MetricCard`, the `lf-*` design
tokens, `forbidden.tsx`. No new design language.

## 15. Phase 1 scope — exactly

1. `ModuleKey.REAL_ESTATE` migration + entitlement seeding.
2. Nav section + areas in `workspaceNav.ts`; `activeModule()` and `MobileTabBar` third branch.
3. Route group `(workspace)/[workspaceSlug]/realty/` with `layout.tsx` + `dashboard/page.tsx`.
4. Permission catalogue entries + role grants.
5. Dashboard reading existing tables only — **no new domain tables in Phase 1**.
6. Module enable/disable honoured by `assertModuleEntitlement`.

## 16. Files

**Create:** `prisma/migrations/<ts>_module_key_real_estate/migration.sql`;
`src/app/(workspace)/[workspaceSlug]/realty/{layout,dashboard/page}.tsx`;
`src/services/realty/dashboard.ts`; `tests/unit/realty-nav.spec.ts`;
`tests/tenant/realty-dashboard.spec.ts`.

**Change:** `prisma/schema.prisma` (enum); `src/lib/nav/workspaceNav.ts`;
`src/components/workspace/MobileTabBar.tsx`; `src/lib/security/permissionCatalogue.ts`;
`prisma/seed/roles.ts`; `tests/unit/workspace-nav.spec.ts` (coverage of the new area).

## 17. Tests

- Nav: every Real Estate screen has a link of its own (extend the registry check added in #102).
- Entitlement: a workspace without `REAL_ESTATE` sees no Real Estate nav and the routes refuse.
- Scope: agent sees own, leader sees team, manager sees all — asserted against seeded roles.
- Dashboard figures counted from rows, per workspace, two tenants.
- E2E: module appears, dashboard loads, a tile navigates to its filtered screen.

## 18. Migrations

Phase 1: one additive enum value. Non-destructive, no data movement, no backfill.
Later: `DataPoolRecord`, `Proposal`/`ProposalItem`, nullable recycle columns on `Lead` — all additive.

## 19. Risks

1. **Duplicating the domain.** The biggest risk by far. If Real Estate gets its own Lead/Property
   tables, the data splits and the call coach, matching and reports stop working. Mitigation: reuse,
   and treat Real Estate as a presentation + workflow layer over the existing schema.
2. **`activeModule()` / `MobileTabBar`** assume two products; a third is a real change to code that
   decides phone navigation. Covered by tests before anything else lands.
3. **Sales and Real Estate overlap.** Both will show leads and listings. Whether a workspace runs
   one or both is an owner decision (below).
4. **Enum migration ordering** — the value must exist before any row or seed references it.
5. Nine-column grids overflow on narrow screens (observed: 1114px table in a 656px container). The
   new module must not repeat it; use the compact-card pattern at phone width.

## 20. Owner decisions required

**D1 — Do Sales and Real Estate coexist in one workspace, or is Real Estate an alternative to
Sales?** This decides whether the nav shows both (and whether leads appear twice), or whether
entitlement makes them mutually exclusive. It changes Phase 1's nav and entitlement work and I
should not guess it.

**D2 — For an existing workspace like `manath-homes`, which is already doing brokerage inside Sales:
migrate it to Real Estate, or leave it on Sales and offer Real Estate to new workspaces?** A
migration path for live data is a different (and larger) piece of work than a new module.

Everything else in this brief is answerable from the tree and needs no decision.
