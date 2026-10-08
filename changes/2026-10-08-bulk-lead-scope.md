# Bulk assign and event invitees reached any lead in the workspace

**What.** Two bulk routes that take lead ids in the body keep to the caller's
lead scope now (#NNN, after #140): bulk assign moves only the leads the caller
may assign, and adding event invitees takes only leads the caller can read, on
an event the caller may edit.

**Why.** Both were found during #140's audit and listed in its entry; the
owner asked for the fix on 8 Oct. `POST /leads/assign` updated every id it was
sent, so a team manager could take another team's leads, and it wrote history
for every id, moved or not (a missing id was a 500). `POST /events/{id}/invitees`
stored any lead id, and the event's calling queue then showed that lead's name
and number to the event's callers. It also checked the event at VIEW, where an
invitee may read it.

**Where.**

- `api/v1/leads/assign/route.ts`: the ids in the caller's reach first
  (`visibilityWhere(ctx, 'leads', 'ASSIGN', { includeUnassigned: true })`),
  then the move and the history for those only; an unknown owner is
  `NotFound('User')`.
- `api/v1/events/[id]/invitees/route.ts`: one count of the batch's distinct
  lead ids against `visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true })`;
  the event at `EDIT`.
- `lib/security/record-scope.ts`: `eventScopeFilter` takes the action and adds
  the invitee clause at `VIEW` only.

**Behaviour.** Bulk assign skips a lead outside the caller's ASSIGN scope, a
deleted lead and a missing id alike: nothing is moved or written for them, and
each counts 0 in `{ assigned }`, so the count confirms no id. Unassigned leads
still move for a manager with ASSIGN at TEAM or wider. An unknown owner answers
404 "User not found." instead of a 500. Adding invitees: one lead out of reach
refuses the whole batch with 404 "Lead not found.", as a missing id does, and
nothing is added. An unassigned lead follows the lead list's rule (ASSIGN at
TEAM or wider, `docs/01-PERMISSIONS.md` §2), stricter than #140's
`assertLeadInScope`. Below TEAM scope on `events:EDIT`, only the event's host
or creator adds invitees; an invitee still reads the event. Organisation scope
sees no change.

**Verified.** On the hierarchy fixture, against a scratch database on main's
98 migrations:

- `tests/permission/bulk-assign-scope.spec.ts`, 3 tests: the team manager
  moves their team's lead and an unassigned one but not another team's, with
  history for those two only; an out-of-reach id and a missing one both answer
  `{ assigned: 0 }`; an unknown owner answers 404. All 3 fail on the old route:
  `{ assigned: 3 }` for 2, and a 500 for the missing id and for the owner.
- `tests/permission/event-invitee-scope.spec.ts`, 6 tests: a rep's batch naming
  a teammate's lead answers the 404 of a missing id and adds nobody, while the
  rep's own lead is taken; an unassigned lead is refused to the rep and taken
  from the team manager, who is refused another team's lead; an invitee reads
  the event but cannot add to it; `events:VIEW` at TEAM does not stretch
  `events:EDIT` at OWN. 5 fail on the old route ("expected 200 to be 404"); the
  own-lead case passes on both. With `'EDIT'` passed but the old helper, the
  invitee still gets in.

Also green: the permission, tenant, unit and security folders and the
assignment and triage specs (161 files, 2462 tests); `tsc`, eslint, prettier.

**Left open.**

- The leads grid's bulk Assign ignores `assigned`, so a partly skipped
  selection looks done.
- PATCH and DELETE `events/{id}`, `invite` and `rsvp` still check the event at
  VIEW, so an invitee holding the action at OWN scope can change, delete or
  circulate an event they were only invited to; passing the action is now
  enough. Queuing the event's `calls` checks VIEW too, which may be meant.
- Invitee rows added before this fix keep the leads they name.
- Who receives the leads is still unchecked, here as in the lead PATCH.
