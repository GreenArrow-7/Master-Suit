# Cold data follows the lead scope; a cold call is a logged call that counts toward the daily target and the check-out gate

**What.** Lead Eagle audit rows M5-05 and M5-06 (owner's brief of 12 Oct),
branch `fix/cold-data-scope-and-calls`.

- `coldDataScope(ctx, action)` is the lead rule (`visibilityWhere` on the
  record's owner): TEAM, BRANCH and REGION are the caller's resolved owners,
  ORGANIZATION everything, an unassigned record ORGANIZATION's to hand out —
  as follow-ups and tasks read theirs. It was own-or-all.
- Working a cold record — picking what the call found — writes an outbound-call
  `Activity` on the record (`Activity.dataRecordId`, new), audited in the same
  transaction, and the call counts toward the daily calling target and the
  check-out gate exactly as a call to a lead does. Making the record a lead
  moves its calls onto the lead (re-pointed, not copied), audited.
- Targets are lead work: `api/v1/targets/**` and the Targets page admit every
  lead module, `/lead-eagle/targets` and `/realty/targets` re-export the page,
  and Targets sits beside Reports in the Lead Eagle and Real Estate menus. The
  targets a caller sets, lists, changes and deletes follow their `leads` scope.

**Why.**

- M5-05: a team lead's Cold Data screen showed only their own records, the
  list hand-over moved only those, and a teammate's record answered 404 by id
  — while the lead list beside it showed the team's
  (`2026-10-10-cold-data-assign-and-make-lead.md`, Left open).
- M5-06: the outcome was recorded, the call was not: nothing counted a cold
  call toward "100 calls a day", so an agent working a bought list all day was
  refused check-out under `checkoutRequiresDailyTarget`, and the Targets page
  (and its API) refused a Lead-Eagle-only workspace outright ("Sales is not
  enabled for this company."). M5-03 ("activities re-pointed, not copied")
  was complete only because no call was logged; once one is, conversion has
  to carry it.

**Where** (under `apps/web/`)

- `prisma/schema.prisma`, `prisma/migrations/20261012100000_activity_data_record/` — `Activity.dataRecordId` (nullable, FK to `DataRecord` on delete cascade, index `(tenantId, dataRecordId, occurredAt desc)`); `DataRecord.activities`. Additive; the release count goes from 101 to 102.
- `src/services/leads/coldData.ts` — `coldDataScope(ctx, action = 'VIEW')` (with no grant for the action, your own); `CALL_OUTCOMES`; `logColdCall(ctx, id, body)`: the status change, the `call_out` activity (type upserted as the intake and the move tool do) and its `RECORD_CREATED` audit row in one `withTx`, then `recordTargetProgress` for `CALLS_ATTEMPTED` and, for the first call to that record in the workspace's day, `LEADS_CALLED`.
- `src/app/api/v1/cold-data/[id]/route.ts` — PATCH at the EDIT scope; a status other than `NOT_CONTACTED` goes through `logColdCall`. `cold-data/assign` at ASSIGN, the Cold Data page at VIEW.
- `src/app/api/v1/cold-data/[id]/convert/route.ts` — the record at the EDIT scope; after the intake, one `withTx` marks it converted, re-points its calls to the lead, sets the lead's `lastActivityAt` and writes a `RECORD_UPDATED` audit row on the lead (`lead.cold_calls_attached`, the record and the number of calls) when there were any.
- `src/services/targets/dailyBoard.ts` — `leadsCalled` adds distinct `(ownerId, dataRecordId)` activities of the day, so `pending`, `completion` and `dailyTargetShortfall` (the check-out gate) count cold calls. The `Promise.all` block is re-indented by prettier; `git diff -w` shows the six real lines.
- `src/app/api/v1/targets/route.ts`, `targets/[id]`, `targets/my`, `targets/progress`, `targets/daily`, `targets/daily/[userId]` — `productModule: LEAD_MODULES`. POST checks the person under `assertAssignableUser(leads, ASSIGN)`; GET lists under `visibilityWhere(leads, VIEW)` on `userId`; PATCH and DELETE reach a target under `visibilityWhere(leads, ASSIGN)` on `userId`, 404 outside it.
- `src/app/(workspace)/[workspaceSlug]/sales/targets/page.tsx` — `module: LEAD_MODULES`; the team section lists `assignableUsers(leads, ASSIGN)` and the targets of those people. `lead-eagle/targets/page.tsx` and `realty/targets/page.tsx` re-export it.
- `src/lib/nav/realtyShared.ts` (`targets` in `REALTY_SHARED_ROOTS` and `LEAD_EAGLE_SHARED_ROOTS`), `src/lib/nav/workspaceNav.ts` (Targets beside Reports under Lead Eagle and under Real Estate; the Real Estate tab carries the Lead Eagle path as an alias, as its other tabs do).
- Tests: `tests/sales/cold-call-activity.spec.ts` (new), `tests/sales/cold-data.spec.ts`, `tests/permission/lead-record-scope.spec.ts`, `tests/unit/lead-eagle-routes.spec.ts`, `tests/unit/realty-routes.spec.ts`, `tests/unit/workspace-nav.spec.ts`, `tests/e2e/lead-eagle-workspace.spec.ts` (one step).

**Behaviour.**

- Team, branch and regional leads see, work, hand on and convert the cold
  records of the people in their team, branch or region (the Lead Eagle Team
  Lead included), and the lists' counts cover the same set. Another team's
  record answers 404 by id, as a missing one; nothing changes on it. An agent
  at OWN scope sees no change. An unassigned record is still only an
  ORGANIZATION role's to hand out, so a list arrives with the administrator,
  as before; a team lead's list hand-over moves the team's records of that
  list and leaves unassigned ones alone (unchanged from #165).
- Picking an outcome on the Cold Data screen (Not reachable, Not interested,
  Interested, Wrong number) is a logged call: an "Outbound call" activity on
  the record, owned by the caller, with the outcome and the note, and an audit
  row. A note alone, a hand-over, or resetting to Not contacted logs nothing.
  A second pick on the same record is a second call (an attempt) but counts
  the record once in the day's "leads called". The calls show in the
  Activities list and the activity reports as outbound calls with no lead.
- Make lead moves the record's calls onto the lead's timeline (into the
  existing lead when the number already had one), and the new lead does not
  count as "handed over today and not worked" at check-out: its calls were
  the work.
- The daily board's "called", "pending" and completion count cold records
  beside leads, so `checkoutRequiresDailyTarget` lets an agent out once the
  day's cold calls meet the target and refuses them with the shortfall before
  that ("today's calling target is 1 lead short").
- Lead-Eagle-only and Real-Estate-only workspaces can set, read and delete
  targets, and the Targets screen opens at `/lead-eagle/targets` and
  `/realty/targets` (beside Reports). A cold call moves "Client calls to
  attempt" and "Leads to call today" there; the other metrics are unchanged.
- Targets follow scope: a Team Lead sets, changes and deletes targets only for
  people in their team (404 otherwise, as an unknown person) and the page
  offers only them and lists only their targets; `GET /api/v1/targets`
  answers the caller's `leads:VIEW` scope (a `userId` outside it lists
  nothing). Sales administrators at ORGANIZATION see no change. A Sales team
  manager, who could set a target for anyone and list the workspace's, now
  reaches their team's.

**Decisions taken** (defaults the brief accepted)

- An unassigned record stays ORGANIZATION's (the follow-ups/tasks rule, and
  #165's pinned behaviour), not "claimable by anyone with ASSIGN at TEAM" as
  the lead page's `includeUnassigned` does.
- The outcome pick is the call: no second "Log call" control. The Outcome
  select already said "what the call found"; `NOT_CONTACTED` is the reset.
- Scoping targets (POST, PATCH, DELETE, GET, the page's picker and team list)
  came with opening them to Lead Eagle, whose starter Team Lead holds
  `leads:ASSIGN` at TEAM and would otherwise set anyone's quota.
- Cold calls count `CALLS_ATTEMPTED` and `LEADS_CALLED`; `CALLS_CONNECTED` and
  the board's answered/cold/warm split stay call-row only (which outcomes
  count as "connected" for a cold record is the owner's call).
- Real Estate carries Targets too: the page admits every lead module, and
  main's `sameScreenElsewhere` (#168) treats every Lead Eagle root as a Real
  Estate one, so a Lead Eagle root without a `/realty/` page would send a
  Real-Estate-only workspace to a missing screen.
- Check-out's `checkoutRequiresLeadWork` (leads handed over today) still reads
  leads; a cold call reaches it through Make lead, which counts the lead as
  worked.

**Verified.** On the rig's scratch database (`C:/ymw/m2`, 102 migrations):

- `tests/sales/cold-call-activity.spec.ts` (10): the target set through the
  API in a Lead-Eagle-only workspace; a call writes the activity (type
  `call_out`, outcome, note, owner) and its audit row, and `targets/my` reads
  1/100; a note, a hand-over, a reset and an outsider's 404 add no call to it;
  99 calls read 99/100, `dailyTargetShortfall` 1 and `validatePunch` refuses
  with "calling target is 1 lead short"; a second call on a called record is
  a second activity and still 99; the 100th reads 100/100 and the check-out
  resolves; the Targets page reads "100 done / 0 remaining" for the agent and
  "100 / 100" for the administrator; a Team Lead gets 404 setting or deleting
  a target outside the team and the page offers only the team; Make lead
  re-points both calls of a record to the lead, audits it, leaves no pending
  lead work, and the day still counts 100.
- `tests/sales/cold-data.spec.ts` (4 new, 17): a team lead works the team's
  records, 404 for an outsider's and an unassigned one; hands one on within
  the team only; the list hand-over moves two and leaves the rest; converts a
  teammate's record into the teammate's lead and not an outsider's.
- `tests/permission/lead-record-scope.spec.ts` (2 new): on the hierarchy, the
  team manager works team A's record, gets a missing id's 404 for team B's
  (status unchanged, convert 404), the director reaches both, a rep only its
  own; the screen lists team A's records (sub-team included), not team B's or
  an unassigned one, and offers team A.
- `tests/unit/lead-eagle-routes.spec.ts`, `tests/unit/realty-routes.spec.ts`,
  `tests/unit/workspace-nav.spec.ts`: `targets` among both sets of shared
  roots (the drift guards then check both re-exports and every
  `targets/**` route), Targets in the Lead Eagle and Real Estate menus,
  `/lead-eagle/targets` and `/realty/targets` resolve.
- Fail-before, every new case against main's `src/` (`c03f59ae`; schema and
  client kept, `C:/ymw/logs/r1-m5-r2-before-*.log`): all 10 cold-call cases
  (403 "Sales is not enabled for this company." on targets, "expected [] to
  have a length of 1", "expected 403 to be 404"), the 4 cold-data cases, the
  2 scope cases and the 4 unit assertions. The Make lead case also fails with
  only the convert route reverted ("expected [ null, null ] to deeply equal
  [ leadId, leadId ]").
- After (`C:/ymw/logs/r1-m5-r2-*.log`): the touched and related specs (the
  six above with `hr/checkout-work-gate`, `sales/daily-board`,
  `permission/field-security`, `platform/lead-eagle-move`,
  `sales/lead-audit-trail`, `unit/target-status`) 12 files, 1100 passed;
  permission, sales, tenant and unit (`tests/`) 157 files, 2809 passed, 3
  skipped; hr, security, identity, platform, integration and ai 103 files,
  1271 passed; `tsc --noEmit` clean; eslint and prettier clean on every
  changed file.
- Browser (`next dev` on the rig, Playwright): `lead-eagle-workspace.spec.ts`
  passed, its new step importing a list, picking Interested on the row at
  `/lead-eagle/cold-data`, finding the activity, and reading "1 done / 1
  remaining" at `/lead-eagle/targets`, reached by the Targets tab beside
  Reports; `cold-data-assign`, `daily-target` and `daily-target-workflow`
  passed on the seeded demo workspace.

**Left open.**

- A cold call has no duration and no `Call` row: the board's "connected /
  not answered / cold / warm / interested" split, the average duration and
  the per-seller drill-down (`targets/daily/{userId}`) show lead calls only.
- `recordTargetProgress` keys the day in UTC (`dateKey`), as the lead-call
  path does; the board and the gate use the workspace's day. A call between
  UTC midnight and the workspace's midnight lands on different days for the
  two readings — pre-existing.
- The leadership daily board page (`/sales/leadership?view=daily`) stays
  Sales-only; a Lead Eagle or Real Estate manager reads the board through
  `GET /api/v1/targets/daily` and the Targets page.
- `targets/progress` (the manual increment) checks the target is the caller's
  own, as before.
- The Lead Eagle move tool still folds the standalone's cold-record activity
  into the record's notes; it could write them as `Activity.dataRecordId`
  calls now (the standalone has no live customers).
- Merging main: #168 (`6214c6fb`) rewrote `realtyShared.ts` (its
  `sameScreenElsewhere` reads both root lists, so `targets` in both is what
  it needs), `tests/unit/lead-eagle-routes.spec.ts`,
  `tests/e2e/lead-eagle-workspace.spec.ts`, `PROJECT.md` and the index; the
  conflicts are textual.
