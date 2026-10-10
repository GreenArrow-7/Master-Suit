# A Lead Eagle workspace starts with five roles, not one

**What.** A workspace that gets Lead Eagle now has Manager, Team Lead, Agent,
Telecaller and Viewer beside the Company Administrator: ordinary roles the
administrator edits, deactivates or deletes in Roles & permissions. They come
from the wizard, from self-serve sign-up, from switching Lead Eagle on in the
console's workspace editor, and from a subscription plan change that brings
Lead Eagle. The plan change also fills the lead stages, activity types and task
types, which it never did.

These are the first default roles below organisation-wide scope, so two paths
that ignored scope now follow it. A site visit loaded by id (read, edit,
approve, cancel, amend, verify, punch, delete, and its page) is in the caller's
scope or not found. A cold-data list hand-over moves only the records the
caller works.

**Why.** Lead Eagle gap audit (11 Oct, M2-03): the spec's role set (Admin,
Manager, Team Lead, Agent, Telecaller, Viewer) was not provisioned, so a new
workspace had one role and the administrator had to build the rest by hand.
The owner's brief set the scopes: Manager ORGANIZATION, Team Lead TEAM, Agent
OWN, Telecaller OWN without `leads:VIEW_SENSITIVE_FIELDS` and any EXPORT,
Viewer VIEW only.

The review found that the visit register loaded visits by id and tenant alone,
and checked `visits:APPROVE` with `can()`, which is true at any scope. A starter
Team Lead could approve any visit in the workspace, and an Agent could cancel,
mark no-show or amend a colleague's completed visit (the evidence a commission
rests on), or open its page with the client's name. The cold-data list assign
updated `{ tenantId, batch }`, so a Team Lead's "Assign to" on a list moved
every agent's records in it.

**Where.**

- `services/platform/provisioning.ts`: `STARTER_ROLES` and
  `provisionStarterRoles`. `provisionLeadWork(tx, tenantId, modules, before)`
  now takes the modules after the change and the live ones before it; the
  "is this a lead module" check moved into it from its callers.
- `services/platform/createWorkspace.ts` (wizard and sign-up),
  `api/v1/platform/workspaces/[workspaceId]` (editor),
  `api/v1/platform/subscriptions/[subscriptionId]` (plan change): one call
  each; the two console routes read the live modules first.
- `lib/security/record-scope.ts`: `assertRecordInScope`, an
  `assertRecordVisible` that answers 404 instead of 403; `assertLeadInScope`
  uses it.
- `services/visits/lifecycle.ts`: `findVisitInScope`, which `transition`,
  `amendCompleted`, `verify`, `punch` (`services/visits/punch.ts`) and the
  `api/v1/site-visits/[id]` read, edit and delete all load through.
  `leaderQueues(ctx)` counts over the visits the caller sees.
- `sales/site-visits/[id]/page.tsx` (also Lead Eagle's): the query carries
  `visibilityWhere`, like the list.
- `api/v1/cold-data/assign`: the update carries `coldDataScope(ctx)`.

**Behaviour.**

- Agent (OWN): leads (view, create, edit, contact details, export), calls,
  tasks, site visits, requirements; asks the pool for leads; reads projects,
  listings and its own reports; its own attendance record and requests.
- Team Lead (TEAM): the same across the team, plus assign, reassign and bulk
  update the team's leads, approve the team's site visits, and see and approve
  the team's attendance (early check-outs).
- Manager (ORGANIZATION): the same across the workspace, plus lead import,
  pool allocation, visit verification, deleting tasks and requirements,
  managing projects and listings, and report export. Attendance stays at its
  reporting line (owner, 5 Oct: a manager decides for their own team, the
  Company Admin for anyone).
- Telecaller: the Agent's set without `VIEW_SENSITIVE_FIELDS` and EXPORT.
- Viewer (ORGANIZATION): VIEW on the same modules only.
- None of them holds users, roles, settings or integrations. The role
  descriptions say which permissions a role lacks, not that anything is masked.
- Roles are added by key and by name (ignoring case): a workspace's own
  "Manager" is never doubled, and a role that exists is never changed. They
  come only when Lead Eagle arrives, so a console save or a plan change that
  leaves it on brings back nothing an administrator deleted and adds nothing
  to a workspace that already had Lead Eagle. Switching Lead Eagle off and on
  again adds back only the missing ones.
- Site visits, for every role: approving or rejecting reaches the approver's
  `visits:APPROVE` scope; cancel, complete, no-show, amend, edit and punch the
  `visits:EDIT` scope; verify the `visits:MANAGE_USERS` scope; delete the
  `visits:DELETE` scope; read the `visits:VIEW` scope. Past it the answer is
  404, as for a missing id; the read, edit and delete used to answer 403. A
  caller without `visits:APPROVE` asking to approve now gets 403 before the
  visit is loaded. The register's "awaiting approval" and "awaiting
  verification" counts cover the visits the caller sees, not the workspace.
- Cold data: below organisation-wide `leads:VIEW`, "Assign to" on a list moves
  only the caller's own records of it; with it, the whole list as before.

**Verified.** `tests/tenant/provision-lead-work.spec.ts`: Admin > Roles of a
wizard-made Lead Eagle workspace lists the six with their scopes; each role's
key grants; a user on each role opens all nine Lead Eagle registers (200), the
Viewer cannot create a lead and the Telecaller cannot export (403); a
Sales-only workspace keeps one role; the editor adds them once and a later
save neither repeats them nor restores a deleted one; no backfill; a plan
change brings roles and lists, and one that keeps Lead Eagle restores no
deleted role; an edited role survives; no second role under a taken name. With
the starter roles: a Team Lead approves its team's visit and gets 404 on
another team's; an Agent gets 404 cancelling, punching, amending or reading a
colleague's visit, whose owner still amends it; the Team Lead's queue counts
its team only. `tests/platform/self-serve-signup.spec.ts`: the same list for a
signed-up workspace. `tests/sales/cold-data.spec.ts`: a TEAM-scope assigner's
list hand-over moves its own record and leaves a colleague's and an unassigned
one. E2E `lead-eagle-workspace.spec.ts`: Admin > Roles lists the six, and an
Agent opening a colleague's visit sees "We couldn't find that" and the API
answers 404. Each of these fails on the code before it; the no-backfill and
plan-keeps-Lead-Eagle cases are guards. Also green: `tests/sales`,
`tests/permission`, `tests/platform`, `tests/unit`, `tests/security`,
`tests/tenant`, `tests/identity`; tsc, eslint, prettier.

**Left open.**

- Existing Lead Eagle workspaces are not backfilled (owner's call). Two console
  paths do add the roles to an existing workspace: reactivating a cancelled or
  archived one with Lead Eagle (its entitlements were all cancelled, so Lead
  Eagle counts as arriving), and switching Lead Eagle off and on. No tenant-side
  audit row records the roles; the platform audit row of the save does.
- Until the lead contact masking change (M2-06) ships, `leads:VIEW_SENSITIVE_FIELDS`
  masks nothing, so Telecaller and Viewer still see numbers whole. Ship this
  with or after that change: its migration grants the permission to every role
  holding `leads:VIEW` or `calls:VIEW`, so Telecaller and Viewer roles made
  before it runs would gain it. Cold-data records stay unmasked after it too.
- Report CSVs (`api/v1/reports?format=csv`) need only `reports:VIEW`, so the
  Telecaller and Viewer can download them (aggregates, no contact details).
  `reports:EXPORT` is checked only by the HR report export.
- An assigner's target is any active user: TEAM-scope `leads:ASSIGN` limits
  which leads move, not to whom. A Team Lead sees and hands on only its own
  cold data (`coldDataScope` is own-or-all).
- Claiming a social enquiry for yourself needs only `leads:VIEW`, so the Viewer
  can claim one in a workspace that also has Sales.
- Sales and Real Estate workspaces get no starter set.
