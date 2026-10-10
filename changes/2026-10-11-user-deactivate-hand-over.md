# Deactivating or removing a member hands their open work on

**What.** Deactivate and Remove in Admin → Users (and Deactivate on the
account page) now open a step first: "Hand 3 open leads, 2 follow-ups and 1
task to [member]", with "or send the leads to the allocation queue". The
server enforces it: `account-active` (`active: false`) and `account-delete`
answer 409 with the counts while the account owns open work and the request
names no `handOverTo` (and/or `leadsToQueue`). The move, its
`LeadAssignmentHistory` rows and one `OWNER_CHANGED` audit row commit in the
same transaction as the suspension or removal.

**Why.** Lead Eagle audit 11 Oct, row M2-02 (owner's build brief, part D).
Both actions left the account's open leads, follow-ups and tasks owned by a
SUSPENDED (or removed) user: invisible to colleagues at OWN scope, and not in
the Allocation queue, because a lead with an owner is not waiting.

**Where.**

- `services/leads/assign.ts`: `assignLeads` (the bulk-assign logic, moved out
  of the route so the hand-over reuses it) and `handOverOpenWork`,
  `countOpenWork`.
- `services/identity/accounts.ts`: `setUserActive` and `deleteUser` call the
  hand-over inside their transaction; `openWorkOf` feeds the dialog.
- `api/v1/workspaces/[workspaceSlug]/identity/[action]/route.ts`: GET
  `account-work`; `handOverTo` / `leadsToQueue` on `account-active` (body) and
  `account-delete` (query).
- `api/v1/leads/assign/route.ts`: now one call to `assignLeads`.
- `admin/users/HandOver.tsx`: the step, the deactivate form and button;
  `UserRowActions.tsx`, `users/page.tsx`, `users/[userId]/page.tsx` use them.
- `services/distribution/triage.ts`, `prisma/schema.prisma`, migration
  `20261011000000_triage_owner_deactivated`: triage reason `OWNER_DEACTIVATED`.
- `lib/security/visibility.ts`: `visibilityWhere` takes `db` for use inside a
  transaction; `services/distribution/assignLead.ts` exports `activeRule`.

**Behaviour.**

- Open means a lead in an OPEN-category stage that is not closed out, and a
  follow-up or task that is OPEN, IN_PROGRESS or RESCHEDULED. Won and lost
  leads and finished work keep naming the person.
- Leads go to the chosen member, or become unassigned and wait in Allocation →
  Waiting as "Handed back when (name) was deactivated", one triage episode
  each, the way an unplaced intake lead waits. Follow-ups and tasks always go
  to a member; the queue holds leads only. Only active members are offered or
  accepted (422 otherwise).
- The caller needs `leads:ASSIGN` with a scope that reaches the departing
  member (403 otherwise, nothing changes). An account with no open work
  deactivates or is removed as before.
- Bulk assign (`POST /api/v1/leads/assign`) refuses a suspended or removed
  owner with 404, and its history rows now carry `fromOwnerId`.

**Verified.** `tests/permission/user-delete.spec.ts` USERDEL-002 (9 cases:
409 with the counts, the acceptance case "3 open leads, 2 follow-ups, 1 task →
0 open records owned by the SUSPENDED account" with history and audit, the
queue with triage rows, queue without a member, remove, inactive or departing
target 422, out-of-reach caller 403, the dialog's GET, an idle account) and
`tests/permission/lead-bulk-assign-scope.spec.ts` (suspended owner). On the
old code 9 of the 10 new cases fail (the idle-account case passes on both).
`tests/e2e/user-deactivate-hand-over.spec.ts`: the dialog names the work,
waits for a member and leaves the agent with nothing open; the queue choice
lands the lead on Allocation → Waiting. It fails on the old code (no
Deactivate on the row). Also green: `tests/permission`, the triage, identity
and security specs that touch these files, `tests/sales/lead*`, the phone
Remove case of `workspace-summary-sample.spec.ts`, tsc, eslint, prettier.

**Left open.**

- Accounts suspended before this ships keep their open work until someone
  removes them, or restores and deactivates them again.
- The platform console's user delete suspends memberships across workspaces,
  and account erasure deactivates workspace users, without a hand-over.
- Other paths can still give work to a suspended account: a lead PATCH with
  `ownerId` and lead create do not check the owner's status.
- The queue choice writes one triage episode per lead inside the transaction;
  a member with thousands of open leads needs a set-based insert.
