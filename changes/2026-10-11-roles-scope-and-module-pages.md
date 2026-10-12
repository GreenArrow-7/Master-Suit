# Admin > Roles showed no scopes; a screen outside the plan went to the dashboard without a word

**What.** Admin > Roles shows each role's scope beside its name. A screen whose
product the workspace's plan lacks shows a page saying so instead of sending
the viewer to the dashboard, or opens the same screen under a product the plan
has. The API's refusal for a route that several products carry names all of
them.

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
  `· <scope>` from the role's `defaultScope`, the value the API returns, and
  `(up to <scope>)` when a grant reaches wider; `services/identity/roles.ts`
  (`listRoles`) adds `widestScope`; `app/globals.css` styles it
  (`.lf-roles__scope`, and the row head wraps).
- `lib/security/entitlements.ts`: `moduleNames` ("Sales or Real Estate",
  `Intl.ListFormat`), `hasAnyModuleEntitlement`; `assertAnyModuleEntitlement`
  refuses a set with every name in it. `route({ productModule })` and the page
  helpers both call it.
- `lib/workspace-page.ts`: `workspaceOwns(slug, module)` for the layouts.
- `components/workspace/NotInPlan.tsx`: the page, the one place every module
  layout sends a missing product. When the plan has the same screen elsewhere
  it redirects there (`sameScreenElsewhere`); otherwise it names the screen
  from the URL and every product that carries it, links back to the
  dashboard and, for a holder of `settings:MANAGE_CONFIGURATION`, says the
  platform provider sets the plan.
- `lib/nav/realtyShared.ts`: `sameScreenElsewhere(url)` replaces
  `realtyEquivalent` and `leadEagleEquivalent`. It maps `/sales/`, `/realty/`
  and `/lead-eagle/` among themselves (Sales, then Real Estate, then Lead
  Eagle) and People's every-plan screens to the workspace root.
- `components/workspace/RecheckOnNavigate.tsx`: inside `NotInPlan`, refreshes
  when the URL moves beneath it, because a soft navigation does not run a
  shared layout again.
- Layouts `sales/`, `realty/`, `lead-eagle/`, `people/` and a new
  `admin/lead-stages/layout.tsx` render `NotInPlan` where they redirected.
- Tests: `tests/permission/module-entitlement.spec.ts`,
  `tests/tenant/provision-lead-work.spec.ts`, a guard in
  `tests/permission/page-access.spec.ts`; e2e `lead-eagle-workspace.spec.ts`,
  `every-route.spec.ts`, `mobile.spec.ts`; the source checks in
  `tests/unit/realty-routes.spec.ts`, `tests/unit/lead-eagle-routes.spec.ts`,
  `tests/security/p2-regressions.spec.ts` (P2-15) and
  `tests/security/platform-crm-monitoring.spec.ts` follow the new code.

**Behaviour**

- Admin > Roles: "Company Administrator · Organization", "Manager ·
  Organization", "Team Lead · Team", "Agent · Own", "Telecaller · Own",
  "Viewer · Organization". A custom role shows its own scope, and "(up to
  Organization)" or similar when one of its grants reaches wider, as a role
  made with the New role form's default (Own) often does. At 375 px nothing
  scrolls sideways.
- A screen outside the plan stays at its URL and reads "<Screen> is part of
  <products>. This workspace's plan does not include it." with "Back to the
  dashboard". In a Lead-Eagle-only workspace `/sales/events` and
  `/realty/events` both name Sales or Real Estate, as the API does. HR
  screens without HR, Sales-only screens and Admin > Lead stages without a
  lead product do the same. Lead stages showed the error page ("Something went
  wrong on our side").
- A link to a screen the plan has under another folder opens it there: a
  `/sales/` or `/realty/` lead link in a Lead Eagle workspace goes to
  `/lead-eagle/`, `/realty/` or `/lead-eagle/` links in a Sales workspace go
  to `/sales/`, and People's check-in, attendance, requests, work locations
  and face enrolment go to `/check-in`, `/attendance`, `/attendance/requests`
  and `/admin/work-locations` in a workspace without HR. Only the `/sales/`
  case did so before; the rest went to the dashboard.
- A link followed from the plan page without a full load (the bell, the
  assistant) is decided again for its own URL.
- Unchanged: sign-in, password-change and monitoring-session redirects.
- The API answers 403 as before, naming the set: "Sales or Real Estate is not
  enabled for this company." (events, collections, commissions, proposals,
  portals), "Sales, Real Estate or Lead Eagle is not enabled for this company."
  (lead work). A single module's message is unchanged.

**Verified.** New cases fail on the old source and pass on the new one.

- First round, against `origin/main`'s `src/`: three layout cases failed with
  `Error: NEXT_REDIRECT`, the API case with
  `expected 'Real Estate is not enabled for this c…' to be 'Sales or Real Estate is not enabled f…'`,
  and the Roles screen with
  `expected [ 'Agent ', …(5) ] to deeply equal [ 'Agent · Own', …(5) ]`.
- Review round, against the first round's `src/` (`git stash`): 13 of 593
  failed in six specs. `/realty/events` in Lead Eagle:
  `expected 'Events is part of Real Estate.This wo…' to contain 'Events is part of Sales or Real Estat…'`.
  `/realty/leads` in Lead Eagle and `/people/check-in` without HR:
  `expected null to be '/ent-sales-670b5c53/check-in'` and the like. Lead
  Eagle's folder without a lead product:
  `expected 'Leads is part of Lead Eagle.This work…' to contain 'Leads is part of Sales, Real Estate o…'`.
  The custom role:
  `expected [ 'Agent · Own', …(6) ] to include 'Desk Lead · Own (up to Organization)'`.
  The plan page carried no path, and the rest were source checks of the new
  helper. On the new source those specs, with `platform-crm-monitoring` and
  `self-check-in-reachable`, pass 617 of 617.
- E2E, soft navigation: without `RecheckOnNavigate` the new
  `lead-eagle-workspace` step fails. After `router.push` from `/sales/events`
  to `/sales/opportunities` the heading still reads "Events is part of Sales
  or Real Estate." With it the spec passes 1/1, and the `/sales/leads/{id}`
  push lands on `/lead-eagle/leads/{id}`.
- `tests/permission`, `tests/platform`, `tests/unit`, `tests/tenant`,
  `p2-regressions`, `platform-crm-monitoring`: 111 files, 2,153 passed, 2
  skipped, 1 failed. `self-check-in-reachable.spec` refuses any source text
  naming the old check-in address, and two new comments did. Reworded, it
  passes. The retention specs, run one at a time: 4, 7 and 1 passed.
- E2E on the rig: `lead-eagle-workspace` 1/1, `every-route` 4/4, `mobile` 8/8.
- tsc, eslint and prettier are clean.

**Left open**

- Next renders the page beneath a layout's `NotInPlan`, unseen, and the
  page's own 403 still reaches the server console. Every page in a module
  folder asserts its module (guarded in `page-access.spec`), except the four
  People aliases of screens every plan has.
- The screen name comes from the URL ("Follow ups", "Site visits"), not from
  the navigation's label.
- A plan page shows briefly before a soft navigation's refresh replaces it.
