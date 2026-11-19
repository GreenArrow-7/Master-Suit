# The six business roles a brokerage recognises, as templates

**What.** A workspace is provisioned with the six roles a real-estate company
actually has — Company Administrator, Sales Manager, Sales Agent, Real Estate
Operations, HR Administrator, Employee — instead of one. Both places an
administrator picks a role list those six first, with a description, a scope
and a module count instead of an implementation key. The phone's tab bar now
follows the person's permissions, and the dashboard offers live AI-assisted
calling directly.

**Why.** The owner asked for a simpler, role-focused product. The audit found
the cause was not too many roles but too few: `createWorkspace.ts` made exactly
one (Company Administrator, holding all 64 modules), and
`provisioning.ts`'s five lead-desk roles arrived only with Lead Eagle. A
Sales-only or Real-Estate-only brokerage therefore began with a single role and
an administrator who had to hand-build Sales Manager, Sales Agent and HR across
the whole catalogue. The 26 roles in `prisma/seed/roles.ts` are demo data and
no customer runs on them.

So this is additive. Nothing was renamed, deleted, re-keyed, re-granted or
reassigned, and no user's role changed.

**Where**

- `apps/web/src/lib/roles/templates.ts` — the six specs, their grants and
  `templatesFor(modules)`.
- `apps/web/src/services/platform/provisioning.ts` — `addRoles`, shared with
  the Lead Eagle starter roles, and `provisionRoleTemplates`.
- `createWorkspace.ts` and the two platform routes that change a workspace's
  modules — three call sites.
- `apps/web/src/services/identity/roles.ts` — `listRoles` now returns the
  modules a role reaches, read from its own grants.
- `admin/roles/page.tsx` and `people/users/new/` — the grouped pickers, the
  descriptions and the effective-permissions preview.
- `components/workspace/MobileTabBar.tsx` — permission-filtered tabs.
- `[workspaceSlug]/dashboard/page.tsx` — the Start AI-assisted call action.
- `tests/e2e/globalTeardown.ts` — stray roles tagged by a run.

**Behaviour.** A new workspace gets the templates for the modules it owns: HR
Administrator with HRMS, the sales pair with any lead module, Real Estate
Operations with Real Estate or Sales, Employee always. An existing workspace
gets a template only when a module that enables it _arrives_, so nothing
appears underneath anyone, and a role whose key or name is already taken is
left alone — verified on a workspace holding 26 roles, where the templates
named "HR Administrator" and "Employee" were skipped rather than duplicated.

Three omissions are the point of the matrix, not gaps: HR Administrator
prepares payroll and cannot approve it, cannot decide recruitment offers and
cannot read salary; Real Estate Operations sees collection and commission
status and authorises neither; Employee reaches nothing but their own
attendance, leave and tasks.

On a phone, an employee in a Sales workspace used to get Leads and Calls tabs
the server refused. They now get Home, Check in, My Leave and My Tasks.

**Verified.** `tests/unit/role-templates.spec.ts` 28,
`tests/tenant/role-template-provisioning.spec.ts` 9,
`tests/unit/mobile-tab-bar.spec.ts` 8 (5 fail against the unfiltered bar),
`tests/tenant/teardown-stray-roles.spec.ts` 2,
`tests/tenant/provision-lead-work.spec.ts` 29,
`tests/platform/self-serve-signup.spec.ts` 8. The templates spec was
mutation-checked: adding `payroll:APPROVE` to HR Administrator fails it.
Browser-checked on a production build at desktop and 375 px.

Four existing expectations changed because the behaviour did, each with its
reason recorded beside it, and two list comparisons became order-insensitive —
the templates share ranks with the starter roles and a tie has no defined
order, so those assertions would have flaked.

**Left open.**

- **Call auditing has no permission of its own.** Live coaching, post-call
  analysis, audit scoring and follow-up drafting all gate on `calls:EDIT` plus
  record scope. The templates use scope as the control — an agent audits their
  own calls at OWN, a manager the team's at TEAM — and this is _not_ a
  dedicated independent-reviewer permission. Making it one means a catalogue
  addition, a migration and a CI gate change; proposed, not done.
- **Live AI calling is SALES-only.** The dialer routes assert
  `productModule: 'SALES'`, so a Lead-Eagle-only or Real-Estate-only workspace
  cannot place an AI-assisted call, though its agents can be coached and
  audited on calls logged another way. Left as it is: widening it would hand a
  paid capability to workspaces that have not bought it.
- **Legacy roles that match a template by name** — a workspace with its own
  role named "HR Administrator" sees it under Advanced, because grouping
  matches on key. Matching on name too would group it correctly and would also
  mis-group a custom role that happened to share a name.
- The three test roles standing in the demo today (`Journey Rep …`,
  `Seller …`, `Scope probe …`) are untouched; the teardown fix stops future
  runs adding more.
