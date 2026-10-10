# A workspace could bring back a suspended account; lead work, events and Sales lead routes reached past record scope

**What.** The two criticals of the Lead Eagle audit of 11 Oct (M2-01, M2-05)
in one security PR, built on #143, #144, #146 and #149, which it folds in. One
guard, `assertIdentityReusable`, now decides whether a workspace may take on an
existing identity, and every workspace path that attaches one calls it; one
conditional write, `activateIdentity`, sets it ACTIVE. On record scope: a
task's PATCH also checks the route's own `leads:EDIT`; the campaign audience,
social-lead conversion, the event routes, the event screens and the
assistant's calendar follow the caller's scope.

**Why.** The owner's build brief (11 Oct), rows M2-01 and M2-05.

- Add user (`createStaffAccount`) read only `deletedAt` and set the identity
  ACTIVE. Accepting an invitation checked `deletedAt` and an open erasure and
  did the same. So an administrator who added or invited the email of an
  account the platform owner had suspended or deactivated brought it back.
  #152 had closed sign-up alone. Each path also read the status and then wrote
  ACTIVE unconditionally, so a suspension committed between the two was undone.
- #146 checked a task's owner against `tasks:VIEW` only, because seeded
  managers hold no `tasks:EDIT`. That holds, but it skipped the route's own
  action: a role seeing every task with `leads:EDIT` at OWN could take any
  task by naming itself owner.
- The Sales siblings #155 and #144 left open: the audience took any lead id in
  the workspace; conversion handed back the id and reference of a matched lead
  the caller cannot open, and took a body `ownerId` from anyone; PATCH, DELETE,
  invite and RSVP checked an event at VIEW, where its invitees pass.
- The Events page, an event's page, the calendar and the assistant read events
  by tenant alone while the API applied the scope. A rep at OWN (seeded
  `events` grants mirror `leads`) listed every event, opened any of them with
  its invitees' names, emails and phones and its meetings' summaries, and was
  offered Circulate and Record RSVP buttons the API refuses.

**Where** (under `apps/web/src/`)

- `services/identity/accounts.ts`: `assertIdentityReusable` loads the identity
  by email and answers 409 when it is deleted, being erased, SUSPENDED or
  DEACTIVATED, with one neutral message when a workspace administrator asks
  (`neutral`); `activateIdentity` sets it ACTIVE only while it is still INVITED
  or ACTIVE and not deleted, and answers 409 otherwise. `createStaffAccount`
  calls both.
- `services/identity/invitations.ts`: `inviteUser` calls the guard before
  anything is sent; `acceptInvitation` calls it again inside its transaction,
  in place of its own `deletedAt` and erasure checks, and activates through
  `activateIdentity`.
- `services/platform/createWorkspace.ts`: both, in place of #152's check, for
  the console's wizard and self-serve sign-up.
- `app/api/v1/tasks/[id]/route.ts`: PATCH checks the owner under `tasks:VIEW`
  (#146) and `leads:EDIT`.
- `app/api/v1/campaigns/[id]/audience/route.ts`: adds and removes only leads in
  `visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true })`.
- `app/api/v1/social-leads/[id]/convert/route.ts`: a matched lead the caller
  cannot open is linked as before but answered with `leadId` and `reference`
  null; a body `ownerId` counts only with `leads:ASSIGN`, as in `createLead`.
- `lib/security/record-scope.ts`: `assertEventInScope` takes the action with
  no default; `api/v1/events/[id]` (GET VIEW, PATCH EDIT, DELETE DELETE),
  `invite` and `rsvp` (EDIT) and `calls` (VIEW) pass it. `eventListScope` is
  the list rule as a `where` fragment, used by `api/v1/events`, the Events
  page, the calendar, the assistant's `getCalendar` and `getMyDay`
  (`lib/ai/assistant/tools.ts`) and an event's page.
- `app/(workspace)/[workspaceSlug]/sales/events/[id]/page.tsx`: an event out of
  scope is not found; Circulate and Record RSVP show only where the API's EDIT
  check passes; meetings are listed under the calls list's rule.
  `sales/calendar/page.tsx` shows events only with `events:VIEW`.
- Tests: `tests/security/platform-user-recovery.spec.ts`,
  `tests/platform/self-serve-signup.spec.ts`,
  `tests/permission/lead-record-scope.spec.ts` (#146's task and follow-up cases
  moved here as `describe.each`; `task-follow-up-scope.spec.ts` removed),
  `tests/permission/event-invitee-scope.spec.ts`.

**Behaviour**

- Add user and Invite answer 409 for the email of a suspended, deactivated,
  deleted or erasing account, with one message whatever the reason: "That
  email belongs to an account that cannot be added. Ask the platform owner, or
  use a different address." An administrator of one workspace can no longer
  tell which, so an erasure request is not disclosed to them.
- Accept and sign-up answer 409 with the reason, since the person asking owns
  the address: suspended or deactivated ("Ask the platform owner to restore
  it"), being erased ("Its owner can withdraw the request") or deleted. Accept
  for a deleted account answered 403 "invalid link". An invitation sent before
  the suspension fails when accepted. Nothing is created and the account stays
  as it was.
- Coming back: a suspended or deactivated account through the console's
  reactivate (Platform → Users), which is untouched; an erasing one when its
  owner withdraws the request; a deleted one never.
- Some production identities hold SUSPENDED or DEACTIVATED without the platform
  owner having set it: the 3 Aug unification migration
  (`20260803120000_unified_platform_foundation`) copied each identity's status
  from its workspace user, preferring an ACTIVE one. A person every workspace
  had suspended before then is now refused by Add user and Invite until the
  console reactivates them.
- Tasks: no seeded role changes, since each seeded role holding `leads:EDIT`
  has `tasks:VIEW` at the same scope or none. A custom role whose `tasks:VIEW`
  is wider than its `leads:EDIT` changes only the tasks of owners its
  `leads:EDIT` reaches; the others answer 404 like a missing id.
- Audience: a lead outside the caller's lead list, or an unknown id, counts
  zero in `added` and `removed` and is left as it was, as in bulk assign; an
  unassigned lead only for someone who may assign it. A caller without
  `leads:VIEW` gets 403, even to remove.
- Social conversion: the response gains `visible`; a match on someone else's
  lead still links the enquiry and records the attribution on that lead. A
  caller without `leads:ASSIGN` who names an owner gets the enquiry's owner.
- Events: below TEAM scope on the route's own action, only the host or
  creator changes, deletes, circulates or records RSVPs; an invitee still
  reads the event. The Events page, the calendar and the assistant list, and
  an event's page opens, only what `GET /api/v1/events` lists. An event's page
  shows Circulate and call and Record RSVP only to those who may use them, so
  an invitee no longer sees "Queue calls" there either, and lists the meetings
  the viewer's calls list would. A calendar for a role with no `events` grant
  shows no events. TEAM scope and wider see no change.

**Verified.** On the rig's scratch database:

- `platform-user-recovery.spec.ts`, 11 new: Add user and Invite with a
  SUSPENDED, DEACTIVATED, erasing or deleted identity's email each answer 409
  with the neutral message, the identity unchanged, no membership and, for
  Invite, no invitation and no mail; accepting after the owner suspended or
  deactivated the identity answers 409 with the reason and adds nothing; a
  suspension committed while Add user waits on its write (held open in a
  second transaction until `pg_blocking_pids` shows the wait) is not undone.
  The console's deactivate and reactivate case beside them still passes.
- `self-serve-signup.spec.ts`, 1 new: an erasing account's sign-up link answers
  409 and makes no workspace.
- `lead-record-scope.spec.ts`, 19 new: for PATCH and DELETE `tasks/{id}` and
  PATCH `follow-ups/{id}`, a team manager on another team's record and an OWN
  agent on a teammate's answer a missing id's 404 and the row is unchanged,
  while the agent's own, the team's and (organisation scope) another region's
  succeed and the row changes; an ownerless task only at organisation scope;
  the task desk; the audience (four cases, each runnable alone); conversion
  (three).
- `event-invitee-scope.spec.ts`, 7 new: an invitee holding each action at OWN,
  and a team manager reading the team's events at TEAM and editing at OWN, get
  the 404 on PATCH, DELETE, invite and RSVP, and the event and the RSVP are
  unchanged; the host changes it; the Events page and the calendar list only
  the caller's and the invited event; another's event page is not found; an
  invitee's has no controls and only their own meeting, the host's has both;
  the assistant's calendar names the same events.

Every new case fails on the code it replaces. Against this branch's first
version (the folded PRs plus the guard), 16 fail: the eight neutral-message
cases, the race ("expected 'added' to match object { status: 409 }"), the five
screen cases and the two conversion cases. Against the folded PRs alone, the
guard, sign-up, audience, event-write and conversion cases fail ("promise
resolved instead of rejecting", "expected 200 to be 409", "expected { added:
2 } to deeply equal { added: 1 }", "expected 200 to be 403"). With main's task
and follow-up routes in place, 7 fail ("expected 200 to be 404").

Also green: `tests/permission`, `identity`, `integration`, `platform`,
`security`, `unit`, `sales` and `ai`, with `hr/recruitment` and
`hr/admin-account-and-face`, 207 files and 3,035 tests (2 POSIX-only tests
skip on Windows); `tsc`; eslint and prettier on the changed files; the
`every-route` E2E (Events, an event and the calendar among the Sales routes),
4 passed. `record-scope` E2E skips on this rig without the demo login.

**Left open.**

- The social-lead drawer still links "Open linked customer" to a lead the
  viewer cannot open (a 404), as cold data did before #155; it needs the page
  to pass a visible flag and a browser check.
- The Tasks page and a lead's Tasks tab offer Complete on every task they
  list; for a custom role whose `tasks:VIEW` is wider than its `leads:EDIT`,
  Complete on another owner's task now answers 404. No seeded role has that
  shape.
- Queuing an event's calls checks the event at VIEW, now stated rather than
  defaulted; an invitee holding `calls:CREATE` can queue them through the API,
  though the event's page no longer offers it to them.
- TEAM scope still means the whole workspace for events and calls by id
  (`assertEventInScope`, `assertCallInScope`, `eventListScope` return early at
  TEAM), as follow-ups did before #146. Seeded team, branch and regional
  managers hold `events` at TEAM, BRANCH and REGION, so each reads and edits
  every event in the workspace. Narrowing it changes what those managers see
  today, so it is the owner's call.
- Reassigning a task or follow-up (and `POST /tasks`, and bulk lead assign)
  accepts any active user in the workspace as the new owner once the caller
  holds TEAM or wider; the target is not checked against the caller's scope.
- The folded entries are unchanged: `2026-10-08-task-follow-up-scope.md` names
  the spec whose cases moved.
