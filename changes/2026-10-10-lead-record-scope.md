# A lead's own writes and bulk assign answered for leads outside the caller's scope

**What.** Every by-id lead write loads the lead through `assertLeadInScope`
now, as the thirteen attach routes do (#140): PATCH and DELETE
`/api/v1/leads/{id}`, close-out (and the `duplicateOfId` it names), the
phones POST/DELETE, and `calls/{id}/temperature`. `POST /api/v1/leads/assign`
moves only the leads the caller's ASSIGN scope reaches. The cold-data "Make
lead" part of the same audit finding (the screen opening a 404 on another
agent's lead) is in the cold-data entry.

**Why.** The Lead Eagle gap audit (10 Oct). Those five writes did
`findFirst({ tenantId, id })` and a bare `assertRecordVisible`, which answers
403 where GET answers 404 — so an agent at OWN scope could learn which ids
were real, and name any lead in the workspace as a close-out's original.
Bulk assign had no scope at all: a team manager (ASSIGN at TEAM) reassigned
any lead in the workspace by id, and an id that did not exist 500ed on the
history row's foreign key. #136 and #140 both listed these as open.

**Where.**

- `lib/security/record-scope.ts`: `assertLeadInScope` loads the full row and
  returns it, so a write can go on to edit what it checked.
- `services/leads/updateLead.ts`, `services/leads/closeOut.ts`,
  `api/v1/leads/[id]/phones/route.ts`, `api/v1/calls/[id]/temperature/route.ts`:
  one call each in place of the lookup-plus-check.
- `api/v1/leads/assign/route.ts`: `visibilityWhere(leads, ASSIGN)` picks the
  ids that move; history is written for those only; an unknown owner is 404.
- `sales/leads/LeadGrid.tsx` `assign()`: when `assigned` comes back short of
  the selection, the bulk bar says how many were left behind (a custom role
  whose leads VIEW scope is wider than its ASSIGN scope; every seeded role
  has the two equal), instead of clearing the selection as if all had moved.
- `tests/sales/lead-close-out.spec.ts`: the duplicate case names a second
  lead of the rep's own as the original; its two scope refusals are pinned
  to 404 instead of `[200, 404]` / `[403, 404]`.

**Behaviour.** A lead outside the caller's scope answers 404 "Lead not
found." on every by-id route, the same as a missing id (was 403 on the
writes). A soft-deleted lead answers the same, where PATCH and DELETE used to
take it. A close-out may name as its duplicate only a lead the caller may
see. Bulk assign returns `assigned` as the number of leads that moved;
out-of-scope and missing ids count zero and get no history row, so a team
manager's cross-team selection answers `assigned: 0` instead of moving the
leads. Organisation scope and the caller's own leads see no change.

**Verified.** `tests/permission/lead-record-scope.spec.ts` (every by-id
route: a teammate's lead answers exactly as a missing id, nothing changed on
it, the caller's own lead takes every route; a team manager reaches a
descendant team's lead and not another team's; the director reaches another
region; the duplicate target), `tests/permission/lead-bulk-assign-scope.spec.ts`
(out-of-scope id skipped with no history, missing id ignored, director, no
ASSIGN → 403), and `tests/permission/scope.spec.ts` tightened from `>= 400`
to 404 with the detail. 26 tests; on the old code 12 fail (five 403s, the
manager's 403, the duplicate 200, `assigned: 1`, the 500, the three in
`scope.spec`). `tests/sales/lead-close-out.spec.ts` green again with the
rep's own second lead as the duplicate's original. Also green:
`tests/permission/*.spec.ts` and `tests/sales/lead*.spec.ts`, 453 tests in
28 files; prettier, eslint.

**Left open.**

- `assertRecordVisible` still lets any EDIT holder touch an unassigned lead
  while GET and the pages hide it from anyone who may not claim it (#140).
- Siblings with the same shape, not touched: `campaigns/{id}/audience`
  (`lead.updateMany` by tenant), `GET client-profiles?leadId=`, event
  invitees' lead ids, `social-leads/{id}/convert` returning an invisible
  duplicate's id.
