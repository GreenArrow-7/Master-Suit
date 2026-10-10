# Deactivating or removing a member hands their open work on

**What.** Deactivate and Remove in Admin → Users (and Deactivate on the
account page) now open a step first: "Hand 3 open leads, 2 follow-ups and 1
task to [member]", with "or send the leads to the allocation queue". The
server enforces it: `account-active` (`active: false`), `account-delete` and
HR's `hr/actions/employee-exit` answer 409 while the account owns open work
and the request names no `handOverTo` (and/or `leadsToQueue`). The 409 carries
the counts as data too (`openWork: { leads, followUps, tasks }`). The move,
its `LeadAssignmentHistory` rows and one `OWNER_CHANGED` audit row commit in
the same transaction as the suspension, removal or exit.

**Why.** Lead Eagle audit 11 Oct, row M2-02 (owner's build brief, part D).
Both actions left the account's open leads, follow-ups and tasks owned by a
SUSPENDED (or removed) user: invisible to colleagues at OWN scope, and not in
the Allocation queue, because a lead with an owner is not waiting. HR's exit
did the same to the departing employee's workspace account.

**Where.**

- `services/leads/assign.ts`: `assignLeads` (the bulk-assign logic, moved out
  of the route so the hand-over reuses it), `handOverOpenWork`,
  `countOpenWork`, `mayHandOverWorkOf` (the reach check) and
  `activeMemberWhere` (who may receive work).
- `services/identity/accounts.ts`: `setUserActive` and `deleteUser` call the
  hand-over inside their transaction; `openWorkOf` feeds the dialog.
- `services/hr/lifecycle.ts`: `finaliseExit` calls the same hand-over.
- `api/v1/workspaces/[workspaceSlug]/identity/[action]/route.ts`: GET
  `account-work`; `handOverTo` / `leadsToQueue` on `account-active` (body) and
  `account-delete` (query). The same two fields on `hr/actions/employee-exit`.
- `api/v1/leads/assign/route.ts`: now one call to `assignLeads`.
- `lib/errors.ts`: `Conflict` takes problem+json extension members.
- `admin/users/HandOver.tsx`: the step, the deactivate form and button;
  `UserRowActions.tsx`, `users/page.tsx`, `users/[userId]/page.tsx` use them.
- `services/distribution/triage.ts`, `prisma/schema.prisma`, migration
  `20261011000100_triage_owner_deactivated`: triage reason `OWNER_DEACTIVATED`.
- `lib/security/visibility.ts`: `visibilityWhere` takes `db` for use inside a
  transaction; `services/distribution/assignLead.ts` exports `activeRule`.

**Behaviour.**

- Open means a lead in an OPEN-category stage that is not closed out, and a
  follow-up or task that is OPEN, IN_PROGRESS or RESCHEDULED. Won and lost
  leads and finished work keep naming the person.
- Leads go to the chosen member, or become unassigned and wait in Allocation →
  Waiting as "Handed back when (name) was deactivated", one triage episode
  each, the way an unplaced intake lead waits. Follow-ups and tasks always go
  to a member; the queue holds leads only.
- Only active members are offered or accepted (422 otherwise): an ACTIVE,
  undeleted account whose workspace membership is not suspended or removed.
  The platform console suspends the membership and leaves the account ACTIVE;
  that person is refused too.
- The caller needs `leads:ASSIGN` with a scope that reaches the departing
  member, for follow-ups and tasks as well as leads: their own reassign routes
  are `leads` permissions too. Otherwise 403 and nothing changes. So the
  seeded HR Administrator and IT Administrator, who hold `users:MANAGE_USERS`
  and no `leads` grant, can no longer deactivate, remove or exit a member who
  still owns open work. They could before. The dialog says so before submit
  ("your role cannot assign their work") and keeps the button disabled;
  someone who can assign (Organization Administrator, Super Administrator)
  has to do it, or reassign the work first. An account with no open work
  deactivates or is removed as before.
- GET `account-work` (the counts and the member list) needs
  `users:MANAGE_USERS` or `users:DELETE`; `users:VIEW` alone gets 403.
- Bulk assign (`POST /api/v1/leads/assign`) refuses a suspended, removed or
  invited owner, or one whose membership is suspended, with 404, as
  allocation eligibility does. Its history rows now carry `fromOwnerId`.

**Verified.** `tests/permission/user-delete.spec.ts` USERDEL-002 (14 cases:
409 with the counts in text and data, the acceptance case "3 open leads, 2
follow-ups, 1 task → 0 open records owned by the SUSPENDED account" with
history and audit, the queue with triage rows, queue without a member, remove,
remove to the queue, inactive, membership-suspended or departing target 422,
out-of-reach caller 403, a BRANCH-scoped remover who reaches the agent, the
dialog's GET with `mayHandOver` and its 403 for `users:VIEW` alone, HR's exit
refusing and handing over, an idle account) and
`tests/permission/lead-bulk-assign-scope.spec.ts` (suspended owner, suspended
membership). On the old code the new cases fail except the idle account and
remove-to-queue (coverage of a path that already worked on this branch).
`tests/e2e/user-deactivate-hand-over.spec.ts`: the dialog names the work,
waits for a member and leaves the agent with nothing open; the queue choice
lands the lead on Allocation → Waiting (its entry is closed afterwards); an
administrator without `leads:ASSIGN` is told before submit. It fails on the
old code. Also green: `tests/permission`, `tests/hr`, `tests/sales/lead*`,
the HR action authority spec, the phone Remove case of
`workspace-summary-sample.spec.ts`, tsc, eslint, prettier.

**Left open.**

- Whether an account administrator without `leads:ASSIGN` (HR, IT) may hand
  over at all, for example the leads to the queue and the rest to a member,
  is the owner's decision. Until then they ask someone who can assign.
- Accounts suspended before this ships keep their open work until someone
  removes them, or restores and deactivates them again.
- The platform console's user delete and its membership status change
  (`setMembershipStatus`), and account erasure, suspend or deactivate
  workspace users without a hand-over.
- Open site visits, client requirements and opportunities also carry an owner
  and stay with the departing account; only leads, follow-ups and tasks move.
- Other paths can still give work to a suspended account: a lead PATCH with
  `ownerId` and lead create do not check the owner's status.
- The queue choice writes one triage episode per lead inside the transaction;
  a member with thousands of open leads needs a set-based insert.
