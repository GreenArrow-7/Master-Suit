# TEAM scope meant the whole workspace for calls and events; work could be handed to anyone

**What.** The follow-up to #157 and #145. Calls and events follow one rule in
their lists and by id: TEAM, BRANCH and REGION scope are the caller's resolved
owners, never the workspace. Whoever hands work to someone (a task, follow-up,
lead, cold record, capture link, social enquiry, an event's host or callers,
a deactivation hand-over) may name only an active member inside their own
ASSIGN scope, and every picker of people lists only those.

**Why.** The owner's brief of 11 Oct, items 1–3, closing what #157 left open
("TEAM scope still means the whole workspace for events and calls by id"; "the
target is not checked against the caller's scope").

- `assertCallInScope` and `assertEventInScope` returned early from TEAM up, and
  `eventListScope` and `GET /api/v1/calls` did the same, so a team manager read
  and changed every call and event in the workspace, and listed them, while
  the Calls page beside them showed the team's. `seesWholeWorkspace` (TEAM or
  wider) let the coach, live and live-audio routes do the same.
- `assertCallInScope` defaulted to VIEW, so a call's writes (PATCH, consent,
  analysis, audit, transcript, recording, dial, follow-up email and WhatsApp)
  checked a scope the caller may only read with.
- The call page and the live call page loaded a call by id and workspace only.
  The call audits page treated TEAM as the workspace. Coaching notes answered
  403 for a call outside scope, which confirmed it existed.
- From TEAM up, tasks, follow-ups, bulk assign, lead create and PATCH, cold
  data, capture links, social enquiries and the hand-over took any active user
  in the workspace as the new owner. The legacy lead create
  (`/workspaces/{slug}/sales/leads`), an event's host and an event's calling
  queue took one from anyone, an agent at OWN included.

**Where** (under `apps/web/src/`)

- `lib/security/record-scope.ts`: `callScope(ctx, action)` (`visibilityWhere`
  on `callerId`) and `eventListScope(ctx, action)` (host or creator among the
  resolved owners; an invitee reads) are the list rules; `assertCallInScope`
  (action required, returns the call) and `assertEventInScope` load through
  them. `assignableUserWhere`, `assertAssignableUser` and `assignableUsers`:
  the people a caller may hand work to. `seesWholeWorkspace` and
  `eventScopeFilter` are gone; `activeMemberWhere` moved here from
  `services/leads/assign.ts`.
- Calls: `api/v1/calls` (list), every `calls/[id]` route (its own action),
  `coach`, `live`, `live-audio`, `coaching`; `sales/calls/[id]/page.tsx`,
  `sales/calls/[id]/live/page.tsx`, `sales/call-audits/page.tsx`.
- Events: `api/v1/events` (list, and the host on create), the Events page, an
  event's page (its Circulate and RSVP controls follow `assertEventInScope` at
  EDIT), the calendar, the assistant's `getCalendar` and `getMyDay`,
  `events/[id]/calls` (callers under `calls:ASSIGN`).
- Lead activities by id: `api/v1/activities/[id]` — the activity's logger or
  its lead's owner among the resolved owners, as the activities list and a
  lead's timeline read them.
- Assignment: `api/v1/tasks`, `tasks/[id]`, `follow-ups/[id]`,
  `services/leads/createLead.ts`, `updateLead.ts` (the ASSIGN scope, or
  REASSIGN without ASSIGN), `services/leads/assign.ts` (bulk assign and the
  hand-over), `workspaces/[workspaceSlug]/sales/leads`, `capture-links` and
  `capture-links/[id]`, `cold-data/assign` and `cold-data/[id]`,
  `services/social/assignSocialLead.ts`, `social-leads/[id]/convert`.
- Pickers from `assignableUsers`: the leads grid's bulk assign, a lead's owner
  menu, the Tasks page, QR capture, cold data, social enquiries and the
  hand-over dialog (`services/identity/accounts.ts` `openWorkOf`).
- Tests: `tests/permission/lead-record-scope.spec.ts`,
  `tests/permission/user-delete.spec.ts`; updated
  `tests/permission/conversation-intelligence.spec.ts` (403 → 404) and
  `tests/sales/cold-data.spec.ts` (the list's new owner joins the assigner's
  team).

**Behaviour**

- Team, branch and regional managers (seeded `calls` and `events` mirror
  `leads`: TEAM, BRANCH, REGION; the Lead Eagle Team Lead's calls at TEAM) list,
  open and change only the calls and events of people in their team, branch
  or region, and events they were invited to. Another's answers 404 like a
  missing id, the call and event pages show the not-found page, and the Calls
  API, call audits, the Events page, the calendar and the assistant leave them
  out. The Calls page already showed the team's.
- A call's writes check the route's own action: the seeded Marketing Manager
  (VIEW at ORGANIZATION, EDIT at TEAM) reads every call and event but changes
  only the team's; the Marketing Executive (VIEW TEAM, EDIT OWN) changes only
  their own calls. Service Manager, Service Agent and Read-only read their branch's or
  team's calls and events, not the workspace's.
- Coaching notes on a call outside scope answer 404, not 403.
- Lead activities by id from TEAM up: one logged by someone in your scope, or
  on a lead someone in it owns. One on an unassigned lead logged by someone
  outside your scope is now ORGANIZATION's only; one your people logged on a
  lead outside your scope is now yours to correct.
- Handing work on: a manager names only an active member of their team,
  branch or region (OWN or no ASSIGN grant: only themselves). Anyone else
  answers 404 "User not found." as an unknown user does, and nothing is
  written. The hand-over and an event's calling queue keep their 422 for an
  unknown member and give it for one out of scope too. Tasks and follow-ups
  answered 422 ("That teammate was not found.", "You can only create tasks for
  yourself.") and now answer 404. The Tasks page offers other assignees on
  `leads:ASSIGN` at TEAM or wider (was `leads:EDIT`); seeded roles hold both
  at the same scope.
- Pickers offer only those members; an administrator without `leads:ASSIGN`
  (seeded HR and IT administrators) is offered nobody but themselves in the
  hand-over dialog, which already refuses them.
- ORGANIZATION scope (Super and Organization Administrators, Sales Director,
  Call QA, Analyst, Executive read-only, the Lead Eagle Manager) sees no
  change. Agents at OWN see no change, except that they can no longer name a
  colleague as a lead's owner on the legacy create route, an event's host, or
  an event's callers.

**Verified.** On the rig's scratch database:

- `lead-record-scope.spec.ts`, 64 new cases. A team manager (TEAM) against
  another team: PATCH an activity, GET, PATCH and DELETE an event, GET and
  PATCH a call, record a call's consent, read its coaching — each 404 with a
  missing id's detail and the row unchanged; the team's and (the director)
  another region's answer 200. The events and calls lists, the Events page and
  the call audits leave the other team's out; the call page, the live call
  page and an event's page are not found for it and open for the team's.
  Fifteen assignment routes: handing to another team answers as an unknown
  user and nothing lands; to the team, and the director to either team,
  lands; an agent at OWN never hands to a teammate.
- `user-delete.spec.ts`, 1 new: a BRANCH-scoped remover cannot hand the work
  outside the branch (422 like an unknown member, nothing moved) and is
  offered only the branch.
- Fail-before, with `apps/web/src` stashed back to main: 30 of the 65 new
  cases fail, each on the refusal it adds: "expected 200 to be 404" (the by-id
  routes and the assignment routes), "expected 200 to be 422" (the hand-over,
  an event's callers), "expected 403 to be 404" (coaching), "expected [...] to
  not include" (the lists, the Events page, the call audits), "promise
  resolved instead of rejecting" (the pages), "expected true to be false" (an
  agent naming a colleague on the legacy create, an event's host or callers).
  The other 35 cover what already worked (the team's own, the director, most
  of an agent's refusals) and pass on both.
- Also green: `tests/permission`, `tests/sales`, `tests/ai` (75 files, 1,195
  tests, after the two updates above); `tests/identity`, `integration`,
  `platform`, `security`, `unit`, `tenant`, `hr/recruitment`,
  `hr/admin-account-and-face` (157 files, 2,194 tests, 2 skipped);
  `hr/checkout-work-gate`; `tsc`; eslint and prettier on the changed files.
  The browser specs that touch these screens skip on this rig without the
  demo login; none asserts a list or picker this changes for its ORGANIZATION
  administrator.

**Left open.**

- The dashboard's call-quality panel counts the workspace's calls and audits
  for anyone with `calls:VIEW`: numbers, not rows.
- The allocation queue's manual placement (`leads/triage/{id}/assign`) checks
  the lead under `visibilityWhere(leads, ASSIGN)` without unassigned leads, and
  every waiting lead is unassigned, so only ORGANIZATION scope can place one,
  where everyone is assignable. If it opens to team leads, add
  `assertAssignableUser` there. Allocation's ALLOCATE and ROUTE hand the pool
  out under `allocation:APPROVE` and route across teams by design.
- Cold data's convert names no owner: the lead goes to the record's owner,
  whom an assign route already checked, or the caller.
- Other records with an owner (accounts, contacts, opportunities,
  requirements, listings, collections recovery) and an event's PATCH (no
  host field) were not part of this brief.
- Engagement awards read the nominated event by id and workspace; they are
  the contests module's, not the events list.
