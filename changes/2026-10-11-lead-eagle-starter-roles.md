# A Lead Eagle workspace starts with five roles, not one

**What.** A workspace that gets Lead Eagle now has Manager, Team Lead, Agent,
Telecaller and Viewer beside the Company Administrator: ordinary roles the
administrator edits, deactivates or deletes in Roles & permissions. They come
from the wizard, from self-serve sign-up, from switching Lead Eagle on in the
console's workspace editor, and from a subscription plan change that brings
Lead Eagle. The plan change also fills the lead stages, activity types and task
types, which it never did.

**Why.** Lead Eagle gap audit (11 Oct, M2-03): the spec's role set (Admin,
Manager, Team Lead, Agent, Telecaller, Viewer) was not provisioned, so a new
workspace had one role and the administrator had to build the rest by hand.
The owner's brief set the scopes: Manager ORGANIZATION, Team Lead TEAM, Agent
OWN, Telecaller OWN without `leads:VIEW_SENSITIVE_FIELDS` and any EXPORT,
Viewer VIEW only.

**Where.**

- `services/platform/provisioning.ts`: `STARTER_ROLES` and
  `provisionStarterRoles`. `provisionLeadWork(tx, tenantId, modules, before)`
  now takes the modules after the change and the live ones before it; the
  "is this a lead module" check moved into it from its callers.
- `services/platform/createWorkspace.ts` (wizard and sign-up),
  `api/v1/platform/workspaces/[workspaceId]` (editor),
  `api/v1/platform/subscriptions/[subscriptionId]` (plan change): one call
  each; the two console routes read the live modules first.

**Behaviour.**

- Agent (OWN): leads (view, create, edit, contact details, export), calls,
  tasks, site visits, requirements; asks the pool for leads; reads projects,
  listings and its own reports; its own attendance record and requests.
- Team Lead (TEAM): the same across the team, plus assign, reassign and bulk
  update leads, approve site visits, and see and approve the team's attendance
  (early check-outs).
- Manager (ORGANIZATION): the same across the workspace, plus lead import,
  pool allocation, visit verification, deleting tasks and requirements,
  managing projects and listings, and report export. Attendance stays at its
  reporting line (owner, 5 Oct: a manager decides for their own team, the
  Company Admin for anyone).
- Telecaller: the Agent's set without `VIEW_SENSITIVE_FIELDS` and EXPORT.
- Viewer (ORGANIZATION): VIEW on the same modules only.
- None of them holds users, roles, settings or integrations.
- Roles are added by key and by name (ignoring case): a workspace's own
  "Manager" is never doubled, and a role that exists is never changed. They
  come only when Lead Eagle arrives, so a console save that leaves it on
  brings back nothing an administrator deleted and adds nothing to a
  workspace that already had Lead Eagle. Switching Lead Eagle off and on again
  adds back only the missing ones.

**Verified.** `tests/tenant/provision-lead-work.spec.ts`: Admin > Roles of a
wizard-made Lead Eagle workspace lists the six with their scopes; each role's
key grants; a user on each role opens all nine Lead Eagle registers (200), the
Viewer cannot create a lead and the Telecaller cannot export (403); a
Sales-only workspace keeps one role; the editor adds them once and a later
save neither repeats them nor restores a deleted one; no backfill; a plan
change brings roles and lists; an edited role survives; no second role under a
taken name. `tests/platform/self-serve-signup.spec.ts`: the same list for a
signed-up workspace. On the old code 8 of those 23 tests fail. E2E
`lead-eagle-workspace.spec.ts` gained a step: Admin > Roles lists the six
(fails on the old code). Also green: `tests/platform`, `tests/unit`,
`tests/tenant`, `tests/permission`, `tests/identity`, `tests/security`; tsc,
eslint, prettier.

**Left open.**

- Existing Lead Eagle workspaces are not backfilled (owner's call).
- Until the lead contact masking change (M2-06) ships, `leads:VIEW_SENSITIVE_FIELDS`
  masks nothing, so Telecaller and Viewer still see numbers whole. Ship this
  with or after that change: its migration grants the permission to every role
  holding `leads:VIEW`, so Telecaller and Viewer roles made before it runs
  would gain it.
- Sales and Real Estate workspaces get no starter set.
