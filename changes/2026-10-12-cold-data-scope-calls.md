# Cold data follows the lead scope; a cold call is a logged call that counts toward the daily target and the check-out gate

**What.** Lead Eagle audit rows M5-05 and M5-06 (owner's brief of 12 Oct),
branch `fix/cold-data-scope-and-calls`, with the fixes from its review.

- `coldDataScope(ctx, action)` is the lead rule (`visibilityWhere` on the
  record's owner): TEAM, BRANCH and REGION are the caller's resolved owners,
  ORGANIZATION everything, an unassigned record ORGANIZATION's to hand out —
  as follow-ups and tasks read theirs. It was own-or-all.
- Working a cold record — picking what the call found, or Called again for a
  redial that found the same — writes an outbound-call `Activity` on the
  record (`Activity.dataRecordId`, new), audited in the same transaction, and
  the call counts toward the daily calling target and the check-out gate as a
  call to a lead does. Making the record a lead moves its calls onto the lead
  (re-pointed, not copied), audited.
- Targets are lead work: `api/v1/targets/**` (but the unused manual tally
  `targets/progress`) and the Targets page admit every lead module,
  `/lead-eagle/targets` and `/realty/targets` re-export the page, and Targets
  sits beside Reports in the Lead Eagle and Real Estate menus. The targets a
  caller sets, lists, changes and deletes follow their `leads` scope, and below
  ORGANIZATION never their own.
- The daily board shows check-in times only for people whose attendance the
  viewer may read, and the Cold Data screen shows another owner's number as a
  lead's phone reads to the viewer's role.

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
- Review: the select fired nothing when the shown outcome was picked again,
  so the commonest redial (still not reachable) could not be logged; a team
  lead could delete or lower their own daily target and walk past the gate;
  opening `targets/daily` to Lead Eagle showed every agent's check-in to a
  Viewer whose attendance access is their own; a cold call could be moved
  between days by editing its time; a record made a lead and then called the
  same day counted twice; and widening cold data to the team showed
  teammates' raw numbers to roles that #158 masks.

**Where** (under `apps/web/`)

- `prisma/schema.prisma`, `prisma/migrations/20261012100000_activity_data_record/` — `Activity.dataRecordId` (nullable, FK to `DataRecord` on delete set null, index `(tenantId, dataRecordId, occurredAt desc)`); `DataRecord.activities`. Additive; the release count goes from 101 to 102.
- `src/services/leads/coldData.ts` — `coldDataScope(ctx, action = 'VIEW')` (with no grant for the action, your own); `CALL_OUTCOMES`; `logColdCall(ctx, id, body)`: the status change, the `call_out` activity (type upserted as the intake and the move tool do) and its `RECORD_CREATED` audit row in one `withTx`, then `recordTargetProgress` for `CALLS_ATTEMPTED` and, for the first call to that record in the workspace's day (by `createdAt`), `LEADS_CALLED`.
- `src/app/api/v1/cold-data/[id]/route.ts` — PATCH at the EDIT scope; a status other than `NOT_CONTACTED` goes through `logColdCall`, the same status again included. `cold-data/assign` at ASSIGN, the Cold Data page at VIEW.
- `src/app/(workspace)/[workspaceSlug]/sales/cold-data/ColdDataActions.tsx` — Called again beside the Outcome select (shown once there is an outcome) re-sends it; "Call logged." after each. `page.tsx` — a record not the viewer's own shows its number through `asLeadPhone` and `tel:` only when that is the number as stored.
- `src/app/api/v1/cold-data/[id]/convert/route.ts` — the record at the EDIT scope; after the intake, one `withTx` marks it converted, re-points its calls to the lead, sets the lead's `lastActivityAt` and writes a `RECORD_UPDATED` audit row on the lead (`lead.cold_calls_attached`, the record and the number of calls) when there were any.
- `src/services/targets/dailyBoard.ts` — `leadsCalled` adds distinct `(ownerId, dataRecordId)` activities logged that day (`createdAt`, which cannot be edited, as `Call.createdAt`), leaving out one whose lead the same caller also called that day; check-in and check-out only under `attendanceScope(ctx)`. The `Promise.all` block is re-indented by prettier; `git diff -w` shows the real lines.
- `src/app/api/v1/calls/[id]/route.ts` — a finished call to a lead counts `LEADS_CALLED` only when neither a call nor a cold call to it was logged by the caller earlier that day.
- `src/services/hr/attendance.ts` — `attendanceScope` moved here from `reads.ts` (which re-exports it), so the board reads it without loading the whole HR read layer.
- `src/lib/security/record-scope.ts` — `targetReach(ctx)` (the targets a caller may change or delete: `leads:ASSIGN` on `userId`, below ORGANIZATION not their own), `targetAssignees(ctx)` and `assertTargetAssignee(ctx, userId)` (the people they may set one for).
- `src/app/api/v1/targets/route.ts`, `targets/[id]`, `targets/my`, `targets/daily`, `targets/daily/[userId]` — `productModule: LEAD_MODULES`. POST checks the person with `assertTargetAssignee`; GET lists under `visibilityWhere(leads, VIEW)` on `userId`; PATCH and DELETE reach a target under `targetReach`, 404 outside it; DELETE is audited (`RECORD_DELETED`). `targets/progress` stays `SALES` (the drift guards name it).
- `src/app/(workspace)/[workspaceSlug]/sales/targets/page.tsx` — `module: LEAD_MODULES`; the team section offers `targetAssignees` and lists targets under `targetReach`; the composer leaves out the Events metrics (meeting invitations, RSVPs) in a workspace with neither Sales nor Real Estate (`TargetAdmin`'s `metrics`). `lead-eagle/targets/page.tsx` and `realty/targets/page.tsx` re-export it.
- `src/app/(workspace)/[workspaceSlug]/sales/leadership/page.tsx`, `DailyBoardView.tsx` — Set target per row, on `targetAssignees` (`assignable`), rather than one switch for the board.
- `src/lib/nav/realtyShared.ts` (`targets` in `REALTY_SHARED_ROOTS` and `LEAD_EAGLE_SHARED_ROOTS`), `src/lib/nav/workspaceNav.ts` (Targets beside Reports under Lead Eagle and under Real Estate; the Real Estate tab carries the Lead Eagle path as an alias, as its other tabs do).
- Tests: `tests/sales/cold-call-activity.spec.ts` (new), `tests/sales/cold-data.spec.ts`, `tests/permission/lead-record-scope.spec.ts`, `tests/unit/lead-eagle-routes.spec.ts`, `tests/unit/realty-routes.spec.ts`, `tests/unit/workspace-nav.spec.ts`, `tests/unit/target-status.spec.ts`, `tests/e2e/lead-eagle-workspace.spec.ts` (one step).

**Behaviour.**

- Team, branch and regional leads see, work, hand on and convert the cold
  records of the people in their team, branch or region (the Lead Eagle Team
  Lead included), and the lists' counts cover the same set. Another team's
  record answers 404 by id, as a missing one; nothing changes on it. An agent
  at OWN scope sees no change. An unassigned record is still only an
  ORGANIZATION role's to hand out, so a list arrives with the administrator,
  as before; a team lead's list hand-over moves the team's records of that
  list and leaves unassigned ones alone (unchanged from #165).
- A record's own agent sees its number as stored, with the `tel:` link.
  Anyone else sees it as a lead's phone reads to their role: masked without
  `leads:VIEW_SENSITIVE_FIELDS` (Lead Eagle's Viewer, a custom team role),
  as stored with it (Manager, Team Lead, administrators).
- Picking an outcome on the Cold Data screen (Not reachable, Not interested,
  Interested, Wrong number) is a logged call: an "Outbound call" activity on
  the record, owned by the caller, with the outcome and the note, and an audit
  row; the row says "Call logged.". Called again logs another call with the
  outcome shown, for a redial that found the same. A note alone, a hand-over,
  or resetting to Not contacted logs nothing. A second call on the same record
  is an attempt but counts the record once in the day's "leads called". The
  calls show in the Activities list and the activity reports as outbound
  calls with no lead.
- Make lead moves the record's calls onto the lead's timeline (into the
  existing lead when the number already had one, though the caller may not be
  able to open it), and the new lead does not count as "handed over today and
  not worked" at check-out: its calls were the work. A call to that lead the
  same day is the same person: "leads called" and `LEADS_CALLED` count it once.
- The daily board's "called", "pending" and completion count cold records
  beside leads, by when the call was logged, so `checkoutRequiresDailyTarget`
  lets an agent out once the day's cold calls meet the target and refuses
  them with the shortfall before that ("today's calling target is 1 lead
  short"). Editing a call's time moves it neither into nor out of a day.
- Lead-Eagle-only and Real-Estate-only workspaces can set, read and delete
  targets, and the Targets screen opens at `/lead-eagle/targets` and
  `/realty/targets` (beside Reports). A cold call moves "Client calls to
  attempt" and "Leads to call today" there. A Lead-Eagle-only workspace is not
  offered "Meeting invitations to send" or "Meetings to confirm".
- Targets follow scope: a team lead sets, changes and deletes targets only for
  the other people in their team (404 otherwise, as an unknown person or
  target), and their page offers and lists only those; their own target is
  read on their own cards, with no Delete. Deleting a target is audited.
  `GET /api/v1/targets` answers the caller's `leads:VIEW` scope (a `userId`
  outside it lists nothing). ORGANIZATION administrators see no change and may
  still set their own. A Sales team manager, who could set a target for anyone
  (themselves included) and list the workspace's, now reaches the team's other
  people; the leadership board's Set target appears only on those rows.
- The daily board (the leadership page's daily view, `GET /targets/daily` and
  `/targets/daily/{userId}`) shows a seller's check-in time and checked-out
  state only to a viewer whose `attendanceScope` reaches them: an
  organisation-wide employee reader or attendance approver sees all, a team
  attendance approver their reporting line, anyone else their own. The rest of the row is
  unchanged.

**Decisions taken** (defaults the brief accepted)

- An unassigned record stays ORGANIZATION's (the follow-ups/tasks rule, and
  #165's pinned behaviour), not "claimable by anyone with ASSIGN at TEAM" as
  the lead page's `includeUnassigned` does.
- The outcome pick is the call, and Called again re-logs the outcome shown: a
  select cannot report a pick of its own value, and a redial that finds the
  same is the commonest call on a list. `NOT_CONTACTED` is the reset.
- Scoping targets (POST, PATCH, DELETE, GET, the page's picker and team list,
  the board's Set target) came with opening them to Lead Eagle, whose starter
  Team Lead holds `leads:ASSIGN` at TEAM and would otherwise set anyone's
  quota. Below ORGANIZATION nobody sets, changes or deletes their own target,
  as nobody decides their own attendance exception: the target feeds the
  check-out gate.
- Cold calls count `CALLS_ATTEMPTED` and `LEADS_CALLED`; `CALLS_CONNECTED` and
  the board's answered/cold/warm split stay call-row only.
- A cold call is counted by `createdAt`, as a lead call is by
  `Call.createdAt`; `occurredAt` stays editable on the activity.
- `targets/progress`, a hand-typed increment to one's own target that nothing
  calls, stays Sales-only rather than reaching every lead module unaudited.
- Check-in times on the board follow `attendanceScope`, the rule the
  attendance screens use, rather than the board's `reports:VIEW`.
- `Activity.dataRecordId` is `ON DELETE SET NULL`: a converted record's calls
  are the lead's timeline too.
- Make lead into an existing lead the caller cannot open still moves the
  caller's calls onto it, with the enquiry: they are about that person.
- Cold Data shows a record's own agent its number as stored (they dial it);
  everyone else reads it through the #158 rule.
- Real Estate carries Targets too: the page admits every lead module, and
  main's `sameScreenElsewhere` (#168) treats every Lead Eagle root as a Real
  Estate one, so a Lead Eagle root without a `/realty/` page would send a
  Real-Estate-only workspace to a missing screen.
- Check-out's `checkoutRequiresLeadWork` (leads handed over today) still reads
  leads; a cold call reaches it through Make lead, which counts the lead as
  worked.

**Verified.** On the rig's scratch database (`C:/ymw/m2`, 102 migrations):

- `tests/sales/cold-call-activity.spec.ts` (19): the 100-call daily target set
  through the API in a Lead-Eagle-only workspace; a call writes the activity
  (type `call_out`, outcome, note, owner) and its audit row, and `targets/my`
  reads 1/100; a note, a hand-over, a reset and an outsider's 404 add no call;
  99 calls read 99/100, `dailyTargetShortfall` 1 and `validatePunch` refuses
  with "calling target is 1 lead short"; a second call on a called record is
  a second activity and still 99; the 100th reads 100/100 and the check-out
  resolves; editing a call's time to yesterday, or a call logged yesterday to
  today, leaves the day at 100; the Targets page reads "100 done / 0
  remaining" and "100 / 100"; a Team Lead gets 404 outside the team and is
  offered only the agent; a Team Lead's POST, PATCH and DELETE of their own
  target are 404, the target and the gate's 50 shortfall stand, their page has
  no Delete for it, and the administrator's delete is audited; `?userId=` of
  an outsider lists nothing for the agent and the Team Lead, and PATCH of the
  outsider's target is 404; the composer offers no Events metrics; Make lead
  re-points both calls, audits it, leaves no pending lead work and the day
  counts 100; a lead call to it the same day adds neither a lead called nor
  `LEADS_CALLED` progress; Make lead into an outsider's lead moves the call
  there (`visible: false`) and audits it on that lead; deleting a called
  record keeps the call (`dataRecordId` null); the Team Lead's Cold Data
  screen shows no raw number or `tel:` for the agent's record, the agent's
  does; `GET /targets/daily` gives the administrator the agent's check-in and
  a reports Viewer the row without it.
- `tests/unit/target-status.spec.ts`: Set target on the assignable row only.
- `tests/sales/cold-data.spec.ts` (4 new): a team lead works the team's
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
  `targets/**` route but the Sales-only tally), Targets in the Lead Eagle and
  Real Estate menus, `/lead-eagle/targets` and `/realty/targets` resolve.
- Fail-before. Against main's `src/` (`c03f59ae`, schema and client kept,
  `C:/ymw/logs/r1-m5-r3-before-main.log`): all 19 cold-call cases and the new
  unit cases fail; the first builder's runs (`r1-m5-r2-before-*.log`) showed
  the same for the cold-data, scope and nav cases. Against the reviewed
  commit `075175e8` (`r1-m5-r3-before-head2.log`): every review case fails
  ("expected 200 to be 404" for a team lead's own target, "expected 99 to be
  100" after editing a call's time, "expected 100 to be 99" for the lead call
  after Make lead, the Viewer's check-in "expected '…Z' to be null", the raw
  number on the Team Lead's screen, `metrics` undefined, "expected [] to
  deeply equal [ 'mine' ]", the tally "to contain productModule: 'SALES'");
  with only the call route reverted the `LEADS_CALLED` progress reads 1, not 0
  (`r1-m5-r3-before-callroute.log`); with the FK still CASCADE on the rig the
  deleted record's call is gone ("expected null to match object",
  `r1-m5-r3-after2.log`). The pin on Make lead into an outsider's lead passes
  on `075175e8`, as it should.
- After (`C:/ymw/logs/r1-m5-r3-*.log`): the new and touched specs with the
  related ones (`hr/attendance-manager`, `hr/checkout-work-gate`,
  `permission/field-security`, `permission/lead-record-scope`,
  `platform/lead-eagle-move`, `sales/cold-call-activity`, `sales/cold-data`,
  `sales/daily-board`, `sales/lead-audit-trail`, `sales/lead-touch`,
  `security/monitoring-conversation-scope`, `unit/target-status`,
  `unit/lead-eagle-routes`, `unit/realty-routes`, `unit/workspace-nav`) 15
  files, 1127 passed; permission, sales, tenant and unit 157 files, 2819
  passed, 2 skipped; hr, security, identity, platform, integration and ai 103
  files, 1271 passed; `tsc --noEmit` clean; eslint and prettier clean on every
  changed file; `prisma format --check` clean.
- Browser (`next dev` on the rig, Playwright):
  `lead-eagle-workspace.spec.ts` passed, its step importing a list, picking
  Interested on the row at `/lead-eagle/cold-data` ("Call logged."), pressing
  Called again for a second activity, and reading "1 done / 1 remaining" at
  `/lead-eagle/targets` from the Targets tab beside Reports; with
  `075175e8`'s `ColdDataActions.tsx` it fails at "Call logged." (no such row
  status, no Called again). `cold-data-assign`, `daily-target` and
  `daily-target-workflow` passed on the seeded demo workspace. The rig's
  migration file was edited after it was applied: the rig's constraint and
  `_prisma_migrations` checksum were brought in line, and `migrate deploy`
  reports none pending.

**Left open.**

- Owner questions: is the "100-call quota" 100 distinct records called
  (`LEADS_CALLED`, what the gate reads today), and should a daily "Client
  calls to attempt" (`CALLS_ATTEMPTED`) target gate check-out too? May a Team
  Lead see and hand out an unassigned cold list, as the lead pool allows?
  Should any cold-call outcome count as `CALLS_CONNECTED`?
- Make lead without picking an outcome first logs no call, so that call
  counts toward neither the target nor the board, and the new lead (assigned
  now, never touched) counts as pending lead work at check-out. Logging one on
  convert would also log one for a manager converting a record they never
  called; left for the owner.
- The Targets page's "done" reads `TargetProgress`, written at the moment of
  the call, keyed by the UTC day and only for a target already active then;
  the board and the gate recount the day's calls. Calls made before the day's
  target was set count at the gate but not on the page, and a call between
  UTC midnight and the workspace's midnight lands on different days for the
  two (pre-existing for lead calls).
- A cold call has no duration and no `Call` row: the board's "connected /
  not answered / cold / warm / interested" split, the average duration and
  the per-seller drill-down (`targets/daily/{userId}`) show lead calls only.
- The leadership daily board page (`/sales/leadership?view=daily`) stays
  Sales-only; a Lead Eagle or Real Estate manager reads the board through
  `GET /api/v1/targets/daily` and the Targets page.
- `targets/progress` still lets a Sales seller add to their own target,
  unaudited (pre-existing; nothing calls it).
- The Lead Eagle move tool still folds the standalone's cold-record activity
  into the record's notes; it could write them as `Activity.dataRecordId`
  calls now (the standalone has no live customers).
- Main (#168, `6214c6fb`) is merged in. Two textual conflicts:
  `tests/e2e/lead-eagle-workspace.spec.ts` keeps this branch's cold-call step
  and #168's plan-page step for the money registers; the index keeps both
  rows. `realtyShared.ts` merged clean with `targets` in both root lists, so
  NotInPlan sends `/realty/targets` and `/sales/targets` in a
  Lead-Eagle-only workspace to `/lead-eagle/targets`, and `/lead-eagle/targets`
  to Sales or Real Estate where the plan has those (checked through #168's
  layout harness). On the merged tree (`C:/ymw/logs/r1mu-m5-*.log`):
  `tsc --noEmit` clean; the touched specs with `page-access` and
  `module-entitlement`, 9 files, 1281 passed; permission, sales, tenant and
  unit 157 files, 2831 passed, 2 skipped; `lead-eagle-workspace.spec.ts`,
  `cold-data-assign`, `daily-target` and `daily-target-workflow` passed in the
  browser (the first run of `lead-eagle-workspace` failed once in #168's
  soft-navigation step, `router.push` fired before hydration on a cold
  `.next`; it passed alone).
