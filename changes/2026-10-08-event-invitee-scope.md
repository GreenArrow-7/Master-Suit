# Event invitees could name any lead in the workspace

**What.** Adding invitees to an event takes only leads the caller can read, on
an event the caller may edit (#144, after #140). Bulk assign, the other route
#140's entry listed, was fixed the same way by #155 on 10 Oct; #144 adds two
cases its spec lacked.

**Why.** Found during #140's audit; the owner asked for the fix on 8 Oct.
`POST /events/{id}/invitees` stored any lead id, and the event's calling queue
then showed that lead's name and number to the event's callers on the calls
page. It also checked the event at VIEW, where an invitee may read it.

**Where.**

- `api/v1/events/[id]/invitees/route.ts`: one count of the batch's distinct
  lead ids against `visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true })`;
  the event at `EDIT`.
- `lib/security/record-scope.ts`: `eventScopeFilter` takes the action and adds
  the invitee clause at `VIEW` only. Passing `EDIT` alone still let an invitee
  holding `events:EDIT` at OWN scope in.
- `tests/permission/lead-bulk-assign-scope.spec.ts`: an unassigned lead moves
  for a manager who may claim it; an unknown owner answers 404.

**Behaviour.** One lead out of reach refuses the whole batch with 404 "Lead
not found.", as a missing id does, and nothing is added; a caller without
`leads:VIEW` gets the same for any lead. An unassigned lead follows the lead
list's rule (ASSIGN at TEAM or wider, `docs/01-PERMISSIONS.md` §2), stricter
than #140's `assertLeadInScope`. Below TEAM scope on `events:EDIT`, only the
event's host or creator adds invitees; an invitee still reads the event.
Organisation scope sees no change.

**Verified.** On the hierarchy fixture, against a scratch database on main's
98 migrations:

- `tests/permission/event-invitee-scope.spec.ts`, 6 tests: a rep's batch naming
  a teammate's lead answers the 404 of a missing id and adds nobody, while the
  rep's own lead is taken; an unassigned lead is refused to the rep and taken
  from the team manager, who is refused another team's lead; an invitee reads
  the event but cannot add to it; `events:VIEW` at TEAM does not stretch
  `events:EDIT` at OWN. On main's route and helper 5 fail ("expected 200 to be
  404"); the own-lead case passes on both. With `'EDIT'` passed but main's
  helper, the invitee still gets in.
- The two bulk-assign cases: the unknown owner fails on the route before #155
  (a 500); the unassigned lead passes on both, a guard against narrowing the
  ASSIGN reach.

Also green: the permission, tenant, unit and security folders and the lead,
assignment and triage specs in `tests/sales` (171 files, 2540 tests; two that
timed out under load passed alone); `tsc`, eslint, prettier.

**Left open.**

- PATCH and DELETE `events/{id}`, `invite` and `rsvp` still check the event at
  VIEW, so an invitee holding the action at OWN scope can change, delete or
  circulate an event they were only invited to; passing the action is now
  enough. Queuing the event's `calls` checks VIEW too, which may be meant.
- Invitee rows added before this fix keep the leads they name.
