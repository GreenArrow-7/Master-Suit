# Logging an activity reached any lead in the workspace

**What.** The activity routes check the lead now, not only the permission
(#136). `POST /api/v1/activities` loads the lead and applies the lead PATCH's
own rule (`assertRecordVisible`, `leads` `EDIT`) before logging;
`PATCH`/`DELETE /api/v1/activities/{id}` do the same for anyone but the person
who logged the activity.

**Why.** The POST checked `leads:EDIT` at any scope and nothing else: an agent
at OWN scope could log an activity on — and stamp `lastActivityAt` of — any lead
in the workspace by quoting its id (filed 7 Oct, during Lead Eagle phase 4). The
`{id}` routes let anyone at TEAM scope or wider change or delete any activity in
the workspace, because `seesWholeWorkspace` is true from TEAM up.

**Where.**

- `api/v1/activities/route.ts`: the lead check, first in the existing `withTx`,
  on its `tx` — after the replay lookup, as in `services/money/collections.ts`.
- `api/v1/activities/[id]/route.ts`: `assertActivityInScope`, shared by PATCH
  and DELETE.

**Behaviour.** A lead outside the caller's scope answers 404 "Lead not found.",
exactly as a missing one does (that was a 500 from the foreign key). Below TEAM
scope you change only the activities you logged, as before; from TEAM up, also
those on leads in your scope — or, with no lead, logged by someone in it — and
404 otherwise. An unassigned lead still takes activity from anyone with
`leads:EDIT`, as its PATCH does. Organisation scope sees no change.

**Verified.** `tests/permission/activity-scope.spec.ts`, on the hierarchy
fixture: an OWN-scope rep logs on their own lead (200) and not on a teammate's
(404, the same detail as a missing id, nothing written or stamped); a team
manager cannot patch or delete an activity outside the team (404) and can patch
one inside it (200). On the old routes both refusals fail with "expected 200 to
be 404". Also green: `activity-replay`, `lead-touch`, `permission/scope` and the
route-inventory unit specs; `tsc`, eslint, prettier.

**Left open.**

- Other create routes take a `leadId` in the body with at most a tenant check —
  `calls`, `follow-ups`, `site-visits`, `requirements`, `proposals`,
  `referrals`, `bookings` — and were not audited here.
- Routes that call `assertRecordVisible` bare, the lead PATCH among them, answer
  403 for an out-of-scope id, which confirms it exists; `docs/03-API.md` §3 asks
  for 404.
