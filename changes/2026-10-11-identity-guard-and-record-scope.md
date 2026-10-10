# A workspace could bring back a suspended account; lead work and Sales lead routes reached past record scope

**What.** The two criticals of the Lead Eagle audit of 11 Oct (M2-01, M2-05)
in one security PR, built on #143, #144, #146 and #149, which it folds in. One
guard, `assertIdentityReusable`, now decides whether a workspace may take on an
existing identity, and every workspace path that attaches one calls it. On
record scope: a task's PATCH also checks the route's own `leads:EDIT`; the
campaign audience, social-lead conversion and the event routes follow the
caller's scope.

**Why.** The owner's build brief (11 Oct), rows M2-01 and M2-05.

- Add user (`createStaffAccount`) read only `deletedAt` and set the identity
  ACTIVE. Accepting an invitation checked `deletedAt` and an open erasure and
  did the same. So an administrator who added or invited the email of an
  account the platform owner had suspended or deactivated brought it back.
  #152 had closed sign-up alone.
- #146 checked a task's owner against `tasks:VIEW` only, because seeded
  managers hold no `tasks:EDIT`. That holds, but it skipped the route's own
  action: a role seeing every task with `leads:EDIT` at OWN could take any
  task by naming itself owner.
- The Sales siblings #155 and #144 left open: the audience took any lead id in
  the workspace; conversion handed back the id of a matched lead the caller
  cannot open; PATCH, DELETE, invite and RSVP checked an event at VIEW, where
  its invitees pass.

**Where** (under `apps/web/src/`)

- `services/identity/accounts.ts`: `assertIdentityReusable` loads the identity
  by email and answers 409 when it is deleted, being erased, SUSPENDED or
  DEACTIVATED; `createStaffAccount` calls it.
- `services/identity/invitations.ts`: `inviteUser` calls it before anything is
  sent; `acceptInvitation` calls it again inside its transaction, in place of
  its own `deletedAt` and erasure checks.
- `services/platform/createWorkspace.ts`: calls it in place of #152's check,
  for the console's wizard and self-serve sign-up.
- `app/api/v1/tasks/[id]/route.ts`: PATCH checks the owner under `tasks:VIEW`
  (#146) and `leads:EDIT`.
- `app/api/v1/campaigns/[id]/audience/route.ts`: adds and removes only leads in
  `visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true })`.
- `app/api/v1/social-leads/[id]/convert/route.ts`: a matched lead the caller
  cannot open is linked as before but answered with `leadId: null`.
- `lib/security/record-scope.ts`: `assertEventInScope` takes the action with
  no default; `api/v1/events/[id]` (GET VIEW, PATCH EDIT, DELETE DELETE),
  `invite` and `rsvp` (EDIT) and `calls` (VIEW) pass it.
- Tests: `tests/security/platform-user-recovery.spec.ts`,
  `tests/permission/lead-record-scope.spec.ts` (#146's task and follow-up cases
  moved here as `describe.each`; `task-follow-up-scope.spec.ts` removed),
  `tests/permission/event-invitee-scope.spec.ts`.

**Behaviour**

- Add user, invite and accept answer 409 for the email of a suspended or
  deactivated account: "That email belongs to a suspended or deactivated
  account. Ask the platform owner to restore it, or use a different address."
  Nothing is created and the account stays as it was. An invitation sent
  before the suspension fails when accepted. The console's reactivate
  (Platform → Users) is untouched and is the only way back.
- An account being erased is refused by Add user and a new workspace too (409),
  as accept already refused it; a deleted one answers 409 on every path (accept
  answered 403 "invalid link"; the wizard's message offered a restore that
  does not exist).
- Tasks: no seeded role changes, since each seeded role holding `leads:EDIT`
  has `tasks:VIEW` at the same scope or none. A custom role whose `tasks:VIEW`
  is wider than its `leads:EDIT` changes only the tasks of owners its
  `leads:EDIT` reaches; the others answer 404 like a missing id.
- Audience: a lead outside the caller's lead list, or an unknown id, counts
  zero in `added` and `removed` and is left as it was, as in bulk assign. A
  caller without `leads:VIEW` gets 403.
- Social conversion: the response gains `visible`; a match on someone else's
  lead still links the enquiry and records the attribution on that lead.
- Events: below TEAM scope on the route's own action, only the host or
  creator changes, deletes, circulates or records RSVPs; an invitee still
  reads the event. TEAM scope and wider see no change.

**Verified.** On the rig's scratch database:

- `platform-user-recovery.spec.ts`, 5 new: Add user with a SUSPENDED and a
  DEACTIVATED identity's email, and accepting an invitation after the owner
  suspended or deactivated the identity, each answer 409 with the status
  unchanged and no membership; inviting a suspended identity is refused and
  mails nothing. The console's deactivate and reactivate case beside them
  still passes.
- `lead-record-scope.spec.ts`, 15 new: for PATCH and DELETE `tasks/{id}` and
  PATCH `follow-ups/{id}`, a team manager on another team's record and an OWN
  agent on a teammate's answer a missing id's 404 and the row is unchanged,
  while the agent's own, the team's and (organisation scope) another region's
  succeed; an ownerless task only at organisation scope; the task desk; the
  audience; conversion.
- `event-invitee-scope.spec.ts`, 2 new: an invitee holding each action at OWN
  gets the 404 on PATCH, DELETE, invite and RSVP, and the event and the RSVP
  are unchanged; the host changes it.

On the source before this change 12 of these fail: the five identity cases
("promise resolved instead of rejecting"), the task desk, the two audience
cases ("expected { added: 2 } to deeply equal { added: 1 }"), the two
conversion cases and the two event cases ("expected 200 to be 404"). With
main's task and follow-up routes in place, 7 fail ("expected 200 to be 404"):
the manager case on all three, the agent case on both task routes, the
ownerless task and the desk. `self-serve-signup.spec.ts` still passes.

Also green: `tests/permission`, `identity`, `integration`, `platform`,
`security`, `unit` and `sales`, with `hr/recruitment` and
`hr/admin-account-and-face`, 203 files and 2,987 tests (2 POSIX-only tests
skip on Windows); `tsc`; eslint and prettier on the changed files.

**Left open.**

- The social-lead drawer still links "Open linked customer" to a lead the
  viewer cannot open (a 404), as cold data did before #155; it needs the page
  to pass a visible flag and a browser check.
- Social conversion's body `ownerId` names any user without `leads:ASSIGN`;
  `createLead` ignores it without ASSIGN.
- The Tasks page offers Complete on every task it lists; for a custom role
  whose `tasks:VIEW` is wider than its `leads:EDIT`, Complete on another
  owner's task now answers 404.
- Queuing an event's calls checks the event at VIEW, now stated rather than
  defaulted; an invitee holding `calls:CREATE` can queue it.
- The folded entries are unchanged: `2026-10-08-task-follow-up-scope.md` names
  the spec whose cases moved.
