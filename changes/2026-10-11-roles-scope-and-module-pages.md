# Admin > Roles showed no scopes; a screen outside the plan went to the dashboard without a word

**What.** Admin > Roles shows each role's scope beside its name. A screen whose
product the workspace's plan lacks shows a page saying so instead of sending
the viewer to the dashboard, and the API's refusal for a route that several
products carry names all of them.

**Why.** M2 evidence pack (11 Oct), rows M2-03 1b and M2-05 1f/2d/4b:

- The #160 entry says Admin > Roles lists the starter roles "with their
  scopes", but the screen showed name, key, user count and a "default" badge.
  Only the roles API returned the scope.
- In a Lead-Eagle-only workspace every events page (`/sales/events`,
  `/realty/events` and their `/{id}` pages) went back to the dashboard with no
  message, and `GET /api/v1/events` answered 403 "Real Estate is not enabled
  for this company." `assertAnyModuleEntitlement` passed on the last refusal
  of the set (Sales or Real Estate), so it named Real Estate alone. Events stay
  out of Lead Eagle (owner, 5 Oct).

**Where** (under `apps/web/src/`)

- `app/(workspace)/[workspaceSlug]/admin/roles/page.tsx`: each row shows
  `· <scope>` from the role's `defaultScope`, the value the API returns;
  `app/globals.css` styles it (`.lf-roles__scope`, and the row head wraps).
- `lib/security/entitlements.ts`: `moduleNames` ("Sales or Real Estate",
  `Intl.ListFormat`), `hasAnyModuleEntitlement`; `assertAnyModuleEntitlement`
  refuses a set with every name in it. `route({ productModule })` and the page
  helpers both call it.
- `lib/workspace-page.ts`: `workspaceOwns(slug, module)` for the layouts.
- `components/workspace/NotInPlan.tsx`: the page. It names the screen from the
  URL and the products that carry it, links back to the dashboard and, for a
  holder of `settings:MANAGE_CONFIGURATION`, says the platform provider sets
  the plan.
- Layouts `sales/`, `realty/`, `lead-eagle/`, `people/` and a new
  `admin/lead-stages/layout.tsx` render `NotInPlan` where they redirected.
- Tests: `tests/permission/module-entitlement.spec.ts`,
  `tests/tenant/provision-lead-work.spec.ts`; e2e `lead-eagle-workspace.spec.ts`,
  `every-route.spec.ts`, `mobile.spec.ts`; the source checks in
  `tests/unit/lead-eagle-routes.spec.ts` and
  `tests/security/platform-crm-monitoring.spec.ts` follow the new call.

**Behaviour**

- Admin > Roles: "Company Administrator · Organization", "Manager ·
  Organization", "Team Lead · Team", "Agent · Own", "Telecaller · Own",
  "Viewer · Organization"; a custom role shows its own default scope. At 375 px
  nothing scrolls sideways.
- A screen outside the plan stays at its URL and reads "<Screen> is part of
  <products>. This workspace's plan does not include it." with "Back to the
  dashboard". In a Lead-Eagle-only workspace `/sales/events` names Sales or
  Real Estate and `/realty/events` names Real Estate. People screens without
  HR, Sales-only screens and Admin > Lead stages without a lead product do the
  same. Lead stages showed the error page ("Something went wrong on our side").
- Unchanged: a `/sales/` link that Real Estate or Lead Eagle carries still
  goes to the same screen there, and the sign-in, password-change and
  monitoring-session redirects are as they were.
- The API answers 403 as before, naming the set: "Sales or Real Estate is not
  enabled for this company." (events, collections, commissions, proposals,
  portals), "Sales, Real Estate or Lead Eagle is not enabled for this company."
  (lead work). A single module's message is unchanged.

**Verified.** Five new cases fail on the old source (the new tests run against
`origin/main`'s `src/`): three layout cases with `Error: NEXT_REDIRECT`, the API
case with `expected 'Real Estate is not enabled for this c…' to be 'Sales or
Real Estate is not enabled f…'`, and the Roles screen with
`expected [ 'Agent ', …(5) ] to deeply equal [ 'Agent · Own', …(5) ]`. On the
new code those two specs pass 47 of 47. The guard (a `/sales/leads` link still
reaches Lead Eagle) passes on both.

- `tests/permission`, `tests/platform`, `tests/unit`, `tests/tenant`,
  `p2-regressions`, `platform-crm-monitoring`: 111 files, 2,148 passed, 2
  skipped. One failure came from the rig: its Prisma client predated
  `OWNER_DEACTIVATED`. After `prisma generate`, `user-delete.spec` passes all
  21 cases. The retention specs, run one at a time: 4, 7 and 1 passed.
- E2E on the rig: `lead-eagle-workspace` 1/1 (the three screens above, the
  events API message, the roles' scopes), `every-route` 4/4 (it now also fails
  on this page for an entitled viewer), `mobile` 8/8 with Admin > Roles added.
- tsc, eslint and prettier are clean.

**Left open**

- `/people/attendance` and `/people/requests` without HR now say they are part
  of HR, though `/attendance` and `/attendance/requests` show the same screens.
  A redirect there, like the Sales layout's, would be better.
- Next renders a page beside its layout, so the page under a refusing layout
  still throws its own 403 into the server console (three lines in the e2e
  run). The viewer sees only `NotInPlan`, which answers 200.
- The screen name comes from the URL ("Follow ups", "Site visits"), not from
  the navigation's label.
- The list shows the role's own scope. Each grant carries its own, which an
  administrator may set wider or narrower in the matrix. The starter roles'
  grants match their roles' scopes, attendance aside.
