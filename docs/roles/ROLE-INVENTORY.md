# Authorization inventory

Read-only survey of the authorization system as it stands, so a six-role
brokerage model can be designed on top of it. Every claim carries a
`file:line`. Paths are relative to `apps/web`. No existing file was changed.

Nothing here designs a role matrix; it records what exists and — more usefully —
what does not.

---

## A. The permission catalogue

### Shape

A permission is a `(module, action)` pair. `Permission` is the _definition_
table (`prisma/schema.prisma:3249`, unique on `[module, action]`); it confers
nothing. Authority comes only from `RolePermission` rows
(`prisma/schema.prisma:3261`), each carrying `granted: Boolean`,
`scope: VisibilityScope` and an unused `conditions Json?` column — nothing in
`src` reads `conditions`.

The sixteen actions are the `PermissionAction` enum
(`prisma/schema.prisma:87-107`), mirrored as a TypeScript union in
`src/lib/security/rbac.ts:5-27`:

`VIEW, CREATE, EDIT, DELETE, EXPORT, IMPORT, ASSIGN, REASSIGN, BULK_UPDATE,
VIEW_REPORTS, MANAGE_AUTOMATION, MANAGE_USERS, MANAGE_CONFIGURATION, ACCESS_API,
VIEW_SENSITIVE_FIELDS, APPROVE`

`APPROVE` is documented as deliberately distinct from `EDIT`
(`prisma/schema.prisma:103-106`, `src/lib/security/rbac.ts:21-26`): a line
manager decides a report's leave without editing employee records.

### The modules

`src/lib/security/permissionCatalogue.ts:70-133` is the authoritative list — 61
modules. Three action bundles are reused:

- `CONFIGURATION_SURFACE` (`permissionCatalogue.ts:27-38`): `ACCESS_API, CREATE,
DELETE, EDIT, EXPORT, MANAGE_AUTOMATION, MANAGE_CONFIGURATION, MANAGE_USERS,
VIEW, VIEW_REPORTS`
- `MANAGED_RECORD` (`:41-54`): `ASSIGN, BULK_UPDATE, CREATE, DELETE, EDIT,
EXPORT, IMPORT, MANAGE_CONFIGURATION, MANAGE_USERS, REASSIGN, VIEW,
VIEW_SENSITIVE_FIELDS`
- `RECORD` (`:57-68`): `MANAGED_RECORD` minus `MANAGE_CONFIGURATION` and
  `MANAGE_USERS`

| module                                                                                                                                                                                                                     | actions                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `accounts`, `activities`, `calls`, `campaigns`, `contacts`, `leads`, `opportunities`, `tasks`                                                                                                                              | `MANAGED_RECORD`                                                          |
| `documents`, `events`, `fieldsales`, `products`, `tickets`                                                                                                                                                                 | `RECORD`                                                                  |
| `apikeys`, `auditlogs`, `automation`, `communications`, `dashboards`, `distribution`, `exports`, `forms`, `imports`, `integrations`, `landingpages`, `lists`, `reports`, `roles`, `settings`, `sla`, `smartviews`, `users` | `CONFIGURATION_SURFACE`                                                   |
| `agencyfee`, `allocation`, `collections`, `payouts`                                                                                                                                                                        | `APPROVE, CREATE, VIEW`                                                   |
| `attendance`, `leave`, `overtime`, `shifts`                                                                                                                                                                                | `APPROVE, CREATE, DELETE, EDIT, MANAGE_CONFIGURATION, MANAGE_USERS, VIEW` |
| `bookings`, `clientprofiles`, `posts`, `requirements`                                                                                                                                                                      | `CREATE, DELETE, EDIT, VIEW`                                              |
| `commissions`                                                                                                                                                                                                              | `APPROVE, EDIT, EXPORT, VIEW`                                             |
| `commissionslabs`                                                                                                                                                                                                          | `APPROVE, EDIT, VIEW`                                                     |
| `contests`, `referrals`                                                                                                                                                                                                    | `CREATE, EDIT, VIEW`                                                      |
| `departments`, `employee`, `holidays`, `hrms`, `hr_reports`, `work_locations`                                                                                                                                              | `CREATE, DELETE, EDIT, MANAGE_CONFIGURATION, MANAGE_USERS, VIEW`          |
| `dialer`                                                                                                                                                                                                                   | `CREATE, EDIT, MANAGE_USERS, VIEW`                                        |
| `hr_documents`                                                                                                                                                                                                             | the above plus `VIEW_SENSITIVE_FIELDS`                                    |
| `listings`                                                                                                                                                                                                                 | `CREATE, DELETE, EDIT, EXPORT, VIEW, VIEW_SENSITIVE_FIELDS`               |
| `payroll`                                                                                                                                                                                                                  | `APPROVE, CREATE, EDIT, EXPORT, VIEW`                                     |
| `performance`, `testimonials`                                                                                                                                                                                              | `APPROVE, CREATE, EDIT, VIEW`                                             |
| `projects`                                                                                                                                                                                                                 | `CREATE, DELETE, EDIT, EXPORT, VIEW`                                      |
| `recruitment`                                                                                                                                                                                                              | `APPROVE, CREATE, DELETE, EDIT, VIEW, VIEW_SENSITIVE_FIELDS`              |
| `visits`                                                                                                                                                                                                                   | `APPROVE, CREATE, DELETE, EDIT, MANAGE_USERS, VIEW`                       |

`catalogueTokens()` (`permissionCatalogue.ts:136`) flattens the table to
`module:ACTION` strings. `scripts/check-permission-catalogue.ts:27-36` reads
`Permission` from a migrated database and exits 1 listing any token with no row;
it writes nothing. Migration `20260915140000_permission_catalogue_definitions`
inserts exactly this list, definitions only (`permissionCatalogue.ts:17-19`).
The file's own header records that on a clean install twenty-five checked pairs
previously had no definition at all (`permissionCatalogue.ts:8-13`).

### How a check happens

1. `Actor.permissions` is a `ReadonlyMap<"module:ACTION", Scope>`
   (`src/lib/security/rbac.ts:39`, `:61`), built once per request.
2. `scopeFor(ctx, module, action)` returns the granted scope or `'NONE'`
   (`rbac.ts:131`). `can(...)` is `scopeFor(...) !== 'NONE'` (`rbac.ts:135`).
   `atLeast(ctx, module, action, minimum)` compares `SCOPE_RANK` (`rbac.ts:140`).
3. `assertPermission` throws `Forbidden` on `NONE` and otherwise returns the
   scope (`rbac.ts:147-153`).
4. The kernel calls it: `route({ module, action }, handler)` in
   `src/lib/api/handler.ts:163`, step 3 at `handler.ts:219-243`, specifically
   `handler.ts:241`:
   `if (!spec.selfService && !spec.permissionInHandler) assertPermission(ctx, spec.module, spec.action);`

Kernel order (`handler.ts:177-330`): authenticate → rate limit → **authorize**
(monitoring read-only, module entitlement, permission, sensitive access) →
validate → handle → audit. Two declared escape hatches: `selfService` waives the
permission check entirely (`handler.ts:27-39`) and `permissionInHandler` defers
it to the handler because it depends on the record (`handler.ts:46-51`).

Server pages do not go through `route`; they call `can(...)` directly — e.g. the
navigation in `src/app/(workspace)/[workspaceSlug]/layout.tsx:249` and `:262`.

---

## B. Scopes

`VisibilityScope` is `NONE, OWN, TEAM, BRANCH, REGION, ORGANIZATION`
(`prisma/schema.prisma:78-85`), ordered by `SCOPE_RANK` 0–5
(`src/lib/security/rbac.ts:29-36`).

### Narrowing a query

`visibilityWhere(ctx, module, action, opts)`
(`src/lib/security/visibility.ts:41-62`) is the single translator:

- `ORGANIZATION` → `{ tenantId }` only (`visibility.ts:51`).
- `NONE` → `throw Forbidden()` (`visibility.ts:52`).
- otherwise → `{ tenantId, OR: [{ ownerField: { in: ownerIds } }, ...coOwnerFields] }`
  (`visibility.ts:54-61`). `ownerField` defaults to `ownerId`; tickets use
  `agentId`, field visits `userId` (`visibility.ts:29`).
- `includeUnassigned` adds `{ ownerField: null }` only when
  `mayClaim(ctx, module)` — `ASSIGN` or `REASSIGN` held wider than `OWN`
  (`visibility.ts:59`, `:65-70`).

`resolveOwnerIds(ctx, scope, db)` (`visibility.ts:83-85`, uncached body
`:91-138`) returns **user ids**, deliberately not a nested query so the planner
sees a plain `IN` (`visibility.ts:80-81`):

- `OWN` → `[self]` (`visibility.ts:95-96`).
- `TEAM` → with no team, `[self, ...actor.managedUserIds]`; otherwise every
  member of the actor's teams **and their descendant teams**
  (`descendantTeamIds`, `visibility.ts:141-157`) plus self plus managed ids
  (`visibility.ts:98-106`).
- `BRANCH` → users in `actor.branchId` ∪ `actor.grantedBranchIds`
  (`visibility.ts:108-119`). The granted ids come from BRANCH-scoped
  `MembershipRole` assignments, so a manager covering a second branch sees it
  without being moved (`visibility.ts:109-111`).
- `REGION` → branches in `actor.regionId` ∪ `actor.grantedRegionIds`, then users
  in those branches (`visibility.ts:121-133`).
- anything else → `[]` (`visibility.ts:135-136`).

`managedUserIds` is the whole reporting line below the actor, not just direct
reports, walked at most ten levels (`src/lib/auth/session.ts:828-839`).

Memoized per request with React `cache` (`visibility.ts:89`); outside a React
request scope (workers, route handlers) it does not memoize
(`visibility.ts:87-88`). An earlier comment claiming a 5-minute Redis cache was
false and is corrected in place (`visibility.ts:77-79`).

### Where it is enforced

- **Reads**: every list query spreads a `visibilityWhere`-derived `where`.
- **Writes**: `assertRecordVisible(ctx, module, record, db, action, ownerField)`
  (`visibility.ts:166-183`), called **inside** the transaction after loading the
  row — the file states that checking only on read is the classic IDOR, because a
  PATCH never passes through the list query (`visibility.ts:21-24`). It must be
  passed the transaction client, not the global one, or RLS's `app.tenant_id`
  lands on the wrong pooled connection (`visibility.ts:8-16`, `:163-165`). A
  record with a null owner passes (`visibility.ts:180`) — claiming is governed by
  `ASSIGN`.

### Module-specific scope helpers (`src/lib/security/record-scope.ts`)

- `callScope` / `assertCallInScope` — `callerId` as the owner; no grant falls
  back to the caller's own calls (`record-scope.ts:25-42`).
- `eventListScope` / `assertEventInScope` — events have no owner column: host or
  creator, plus invitee at `VIEW` only (`record-scope.ts:51-70`).
- `assignableUserWhere` / `assertAssignableUser` / `assignableUsers` — who may be
  handed work: active members inside the caller's scope
  (`record-scope.ts:95-129`), on top of `activeMemberWhere`
  (`record-scope.ts:78-83`).
- `leadScope` / `assertLeadInScope` — leads with `secondaryOwnerId` as a co-owner
  (`record-scope.ts:171-202`).
- `assertRecordInScope` — converts a 403 into a 404 so ids are not confirmed
  (`record-scope.ts:209-224`).
- `ownerReach` / `leadReach` — the same rule as a predicate, so a list only shows
  buttons whose routes would succeed (`record-scope.ts:288-309`).
- `assertOwnerInScope` (`record-scope.ts:337-351`), `workListScope` (`:277-281`),
  `leadsInScope` (`:316-326`), `assertContactInScope` (`:255-267`),
  `assertLeadCallable` (`:233-244`).
- `targetReach` / `targetAssignees` / `assertTargetAssignee` — targets exclude the
  caller below ORGANIZATION (`record-scope.ts:138-156`).
- `mayEditPlaybook` / `assertPlaybookEditor` — `calls` at ORGANIZATION
  (`record-scope.ts:359-363`).

`Role.defaultScope` (`prisma/schema.prisma:3232`) is only a default for the role
editor; the enforced scope is always the `RolePermission.scope` of the row.

---

## C. Multi-role — the decisive question

**Multi-role is implemented end to end: resolver, API and UI. It is not a gap.**
What is thin is the UI (one admin form), and two deliberate shortcuts plus one
genuine hole (field security) remain.

### `User.roleId` vs `MembershipRole`

- `User.roleId` → `Role.users User[]` (`prisma/schema.prisma:3238`) is the single
  **primary role**. It is loaded with the user in `loadActor`
  (`src/lib/auth/session.ts:171-178`) and reported as `Actor.roleId` /
  `Actor.roleKey` (`session.ts:845-846`). It carries no scope of its own, no
  effective window and no history.
- `MembershipRole` (`prisma/schema.prisma:1587-1610`) is an **additional,
  effective-dated, scoped assignment** hung off a `WorkspaceMembership`:
  `scopeType` (string, default `"ORGANIZATION"`), `scopeId`, `effectiveFrom`,
  `effectiveTo`, `status` (default `"ACTIVE"`), `assignedById`, `revokedById`,
  `revokedAt`, `revocationReason`. Unique on `[membershipId, roleId]` (`:1607`),
  so the same role cannot be assigned twice to one membership — which also means
  two _different windows_ of the same role cannot coexist; re-assigning reuses
  and overwrites the row (`src/services/identity/roles.ts:412-444`).
  `scopeType` is a plain `String`, **not** the `VisibilityScope` enum.

The designated-owner flag is separate again:
`WorkspaceMembership.isPrimaryAdmin` (see E).

### The resolver combines them

`loadActor` (`src/lib/auth/session.ts:170-856`) builds the permission map:

1. `grant(key, scope)` keeps the **strongest** scope seen for a key
   (`session.ts:181-184`): `SCOPE_RANK[scope] > SCOPE_RANK[held]`.
2. The primary role's grants are applied **only if `user.role.isActive`**
   (`session.ts:187-192`), skipping rows with `granted: false`.
3. Every `ACTIVE`, in-window `MembershipRole` for this user is loaded
   (`session.ts:794-807`) — `status: 'ACTIVE'`, `effectiveFrom` null or `<= now`,
   `effectiveTo` null or `>= now`, with the role's permissions included.
4. Each assignment's grants are applied **capped at the assignment's own scope**
   (`session.ts:815-821`): `ASSIGNMENT_SCOPE_CAP[assignment.scopeType]`, falling
   back to `ORGANIZATION` for unknown values (`session.ts:730-739`:
   `ORGANIZATION→ORGANIZATION, REGION→REGION, BRANCH→BRANCH, TEAM→TEAM,
DEPARTMENT→TEAM, DIRECT_REPORTS→TEAM, OWN→OWN, OWN_RECORD→OWN`). A
   deactivated role contributes nothing (`session.ts:814`).

**So: each grant is capped by its own assignment's scope as it is applied, but
the resulting map is flat and the strongest scope wins per `module:ACTION`.**
Once the map is built there is no record of _which_ role conferred a key. A
primary role granting `leads:VIEW` at `OWN` plus an assignment granting it at
`BRANCH` yields `leads:VIEW → BRANCH`; the OWN grant becomes invisible. There is
no deny-overrides semantic — `granted: false` rows are skipped, not subtractive
(`session.ts:189`, `:817`).

Two further combinations:

- **Rank** — `Actor.roleRank` is the _strongest_ (numerically lowest) rank across
  the primary role and every active assignment (`session.ts:806`, `:822-824`,
  `rbac.ts:52`), so the escalation guards treat a deputy holding an assigned
  admin role as an admin.
- **Locations** — BRANCH/REGION assignments add `scopeId` to
  `grantedBranchIds` / `grantedRegionIds` (`session.ts:825-826`), which
  `resolveOwnerIds` unions with the actor's own (`visibility.ts:112`, `:122`).
  **Known shortcut, stated in the code** (`session.ts:808-811`): the location
  grants are _pooled across assignments rather than tracked per permission_, so a
  user holding two branch-scoped roles can see either branch at any BRANCH-scoped
  permission they hold. This is the one place the per-grant scope genuinely
  leaks, and it matters for a brokerage model where one person covers two
  branches with different authority in each.

Recomputed per request, so a revoked or expired assignment stops working on the
next call rather than the next login (`session.ts:786-793`) — subject to the
Redis actor cache in `src/lib/auth/actorCache.ts` (`session.ts:150-168`); the
session itself is never cached, so sign-out is immediate.

### API and UI for assigning more than one role

Both exist.

- Service layer: `assignRole` (`src/services/identity/roles.ts:378-449`),
  `revokeRoleAssignment` (`:453-497`), `hasOtherAdminAssignment` (`:501-526`),
  `roleAssignmentHistory` (`:530-...`). `assignRole`'s own comment calls this
  "how cover works — someone acts up while a manager is on leave, and the grant
  lapses on its own" (`roles.ts:373-376`).
- API: `POST .../roles/assign` and `.../roles/revoke`
  (`src/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route.ts:28-39`,
  `:140-155`), gated on `roles:MANAGE_CONFIGURATION` (`:80`);
  `GET .../history` on `roles:VIEW` (`:45-72`).
- UI: `src/app/(workspace)/[workspaceSlug]/admin/roles/page.tsx` — an "Assign a
  role" form (`:270-322`) with employee, role, scope (`ORGANIZATION, REGION,
BRANCH, TEAM, DIRECT_REPORTS, OWN_RECORD` — `:297-306`), optional scope id,
  start and end date; a "Users holding …" table that labels each holder
  `primary role` or `assignment` (`:325-346`); and an "Assignment history" table
  with a revoke button (`:351-379`).

Guards on assignment: `assertMayGrantRole` (`roles.ts:39-46`) — strictly below
your own rank, except a peer grant at the workspace's top tier; a deactivated
role cannot be assigned (`roles.ts:394`); an already-ACTIVE assignment of the
same role is a conflict (`roles.ts:415`); every assign and revoke revokes the
holder's sessions (`roles.ts:439`, `:490`) and writes a `PERMISSION_CHANGED`
audit row (`roles.ts:440-447`, `:491-497`).

### What is actually missing

1. **No per-grant provenance.** Once `Actor.permissions` is flat, nothing can
   answer "which role gave this?" — so no UI can explain an effective
   permission, and no rule can say "this role's TEAM scope must not be widened by
   that one".
2. **The `ORGANIZATION` default cap is permissive.**
   `MembershipRole.scopeType` defaults to `"ORGANIZATION"`
   (`schema.prisma:1592`), the assign route makes `scopeType` optional
   (`route.ts:146`), `assignRole` defaults it to `"ORGANIZATION"`
   (`roles.ts:433`), and an unrecognised value also caps at `ORGANIZATION`
   (`session.ts:739`). An assignment made without a stated scope confers the
   role's own scopes unnarrowed.
3. **`scopeType` is an unvalidated `String`.** Not the enum, no DB constraint,
   only `z.string().max(40)` at the route (`route.ts:149`); a typo silently
   becomes `ORGANIZATION`.
4. **Pooled location grants** (above, `session.ts:808-811`).
5. **No per-user assignment screen.** Assignment lives only on the admin roles
   page, keyed by `membershipId` picked from a flat dropdown; there is no "roles"
   tab on an employee record.
6. **`FieldPermission` is resolved from the primary role only** — see F. This is
   the one half of the system that multi-role has **not** reached.

---

## D. Module entitlements

`ModuleEntitlement` (`prisma/schema.prisma:712-727`) is per tenant per
`ModuleKey`: `state: SubscriptionState` (default `TRIAL`), `limits Json`,
`startsAt`, `endsAt`, unique on `[tenantId, module]`. Product modules are
`HRMS, SALES, REAL_ESTATE, LEAD_EAGLE`
(`src/lib/security/entitlements.ts:15-20`).

Usability is one rule, `isEntitlementUsable`
(`src/lib/security/entitlements.ts:167-174`): state in
`['TRIAL','ACTIVE','GRACE']` (`:158`) **and** `endsAt` null or in the future. Its
comment records that the dashboard cards, the console counts and the P&L each
previously kept their own copy that forgot `endsAt` (`:160-166`).
`usableEntitlementWhere` is the same rule as a Prisma fragment (`:177-181`).

`assertModuleEntitlement(tenantId, module)` (`:64-75`) reads through a
60-second Redis cache (`:54-56`); the TTL is deliberately short because this is
the check that stops a workspace using a module it no longer pays for (`:45-53`),
and `invalidateEntitlements` deletes the keys by name after any write
(`:153-155`). `hasModuleEntitlement` (`:82-90`) turns only the 403 into `false`.
`assertAnyModuleEntitlement` (`:112-117`) accepts a list — `SALES_OR_REALTY`
(`:34`) and `LEAD_MODULES` (`:43`) exist because Sales, Real Estate and Lead
Eagle share one lead register.

### Where it sits relative to the permission check

In the kernel's step 3, **immediately before** `assertPermission`:

```
handler.ts:221  assertMonitoringReadOnly(ctx, req.method, spec.selfService)
handler.ts:227  if (spec.productModule) await assertAnyModuleEntitlement(ctx.tenantId, spec.productModule)
handler.ts:241  if (!spec.selfService && !spec.permissionInHandler) assertPermission(ctx, spec.module, spec.action)
```

So entitlement is checked first, and a workspace without the module is refused
whatever its roles say.

### Can a role grant something the subscription does not include?

**Yes, in three ways — the sharpest finding in this section.**

1. **A role can hold any grant in the catalogue regardless of entitlement.** The
   matrix editor's only ceiling is the administrator's own scope
   (`src/services/identity/roles.ts:316-325`); nothing consults
   `ModuleEntitlement`. `createWorkspace` grants the Company Administrator role
   _every_ `Permission` row in the database at `ORGANIZATION`
   (`src/services/platform/createWorkspace.ts:172-192`), irrespective of which
   product modules the workspace bought. The gate is the route, not the grant.
2. **Entitlement is enforced only where the route declares it.** `productModule`
   is optional (`handler.ts:24`) and checked only `if (spec.productModule)`
   (`handler.ts:227`). 178 of 210 `src/app/api/v1/**/route.ts` files mention
   `productModule`; **about 32 do not.** The comment at `handler.ts:222-226`
   explains the previous `?? 'SALES'` default was removed because it made "forgot
   to declare it" indistinguishable from "deliberately Sales" — platform surfaces
   (users, roles, profile, notifications) legitimately belong to no module. The
   consequence is that an undeclared route is ungated by design, and a _missing_
   declaration is indistinguishable from a deliberate omission. There is no
   script or test asserting that every product route declares one (contrast
   `scripts/check-permission-catalogue.ts` for permissions).
3. **Server pages are not covered by the kernel at all.** Pages call
   `hasModuleEntitlement` / `assertAnyModuleEntitlement` individually where their
   author remembered — e.g. `src/app/c/[workspaceSlug]/[key]/page.tsx:31`,
   `src/app/f/[workspaceSlug]/[formKey]/page.tsx:31`,
   `src/app/l/[workspaceSlug]/[pageSlug]/page.tsx:25`,
   `src/app/(workspace)/[workspaceSlug]/sales/listings/[id]/page.tsx:40`. There
   is no page-level equivalent of the `route()` kernel; `src/lib/workspace.ts`
   exports only `requireWorkspace` (`:5`).

There is also `PlanModule` / `PlanLimit` (`prisma/schema.prisma:729-741`) behind
subscription plans, and `limits Json` on the entitlement row — no quantitative
limit is enforced anywhere in the authorization path read here.

---

## E. Mandatory restrictions already implemented

### Self-approval prevention — present, but per-service, not a shared rule

Each approval path carries its own check. There is **no central
`assertNotSelfApproval` helper**; the pattern is copied, which is exactly how a
new approval flow ships without one.

- Leave: `if (self && request.employeeId === self.id) throw Forbidden('You cannot approve your own leave.')` — `src/services/hr/leave.ts:353`; the next line also requires the request be assigned to you unless HR admin (`:354`).
- Overtime: `src/services/hr/overtime.ts:438` — "You cannot decide your own overtime claim."
- Attendance exception: `src/services/hr/requests.ts:302` — "You cannot decide your own attendance exception."
- Temporary location: `src/services/hr/requests.ts:117-121` — "Nobody approves their own request, however senior."
- Requisition: `src/services/hr/recruitment.ts:179-184` — the hiring manager who raised it cannot approve it.
- Performance: `src/services/hr/performance.ts:431` — you cannot write the manager review of your own record.
- Daily targets: `setsOwnTarget` (`src/lib/security/record-scope.ts:138`) and `targetReach` (`:141-144`) exclude the caller below ORGANIZATION, because a self-lowered target would walk past the check-out gate it feeds (`:133-137`).
- Shift swap: `src/services/hr/roster.ts:604` — "Pick a colleague's shift, not your own."
- Role administration: `assertMayAdministerRole` (`src/lib/security/rbac.ts:160-163`) — never your own role and never a role at or above your rank; `assertMayEditRole` (`src/services/identity/roles.ts:25-28`); `updateRole` refuses raising a rank to or above your own (`roles.ts:178-179`); account administration `src/services/distribution/agentSettings.ts:47-49`.
- **Absent:** nothing of this kind on commission or payout approval
  (`commissions:APPROVE`, `payouts:APPROVE`, `collections:APPROVE`,
  `agencyfee:APPROVE`). The money approvals rely on scope and rank alone. For a
  brokerage model this is the gap that matters.

### Deactivated-account denial — present, at authentication

- `loadActor`: `if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Unauthorized()` — `src/lib/auth/session.ts:769` (same at `:449` for the platform user, `:347` for the device path).
- `resolveCtx` resolves the membership with `status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null }, salesUser: { status: 'ACTIVE', deletedAt: null }` — `src/lib/auth/session.ts:590-601`; no actor, and `Unauthorized('Your workspace access is not active.')` at `:611`.
- Assignment targets: `activeMemberWhere` (`src/lib/security/record-scope.ts:78-83`) excludes anyone whose workspace membership is not ACTIVE — the platform console can suspend a membership while leaving the workspace `User` ACTIVE.
- Deactivating an account suspends it and revokes its sessions (`src/services/identity/accounts.ts:462-472`, reason `ACCOUNT_SUSPENDED`), handing over open work (`:469`).
- A **deactivated role** grants nothing wherever it is held (`session.ts:186-192`, `:814`), and deactivating one signs out every holder, primary or assigned (`src/services/identity/roles.ts:188-205`). System roles cannot be deactivated or deleted (`roles.ts:180-181`, `:276`).
- Sessions are revoked on any permission change (`roles.ts:207`, `:439`, `:490`) because a live session carries the map it was built with (`roles.ts:303-306`).

### Read-only / monitoring sessions — present, for platform staff only

- `Actor.platformMode?: 'monitoring' | 'break-glass' | 'service'` and `credentialPurpose?: 'PLATFORM_ADMIN' | 'MONITORING' | null` (`src/lib/security/rbac.ts:68`, `:73`), written to every audit row so an elevated read is distinguishable afterwards (`rbac.ts:62-67`).
- `assertMonitoringReadOnly(ctx, method, selfService)` (`src/lib/api/handler.ts:561-569`): a monitoring actor is refused on anything but `GET`/`HEAD` — "Monitoring is read-only." — and on any `selfService` route outright. Called first in step 3 (`handler.ts:221`).
- A monitoring session never becomes a workspace member even where the identity is one: the membership lookup is skipped entirely (`session.ts:582-589`).
- Entering a workspace requires a grant or coverage, re-checked **per request** so revocation takes effect immediately (`supportSessionActor`, `session.ts:655-673`, reasoning at `:642-653`); break-glass is refused to a MONITORING credential (`session.ts:658-662`).
- `spec.sensitive` (`handler.ts:58-65`) requires a grant flagged `sensitive` for recordings, transcripts and AI analyses, checked after the permission and before the body (`handler.ts:242`).
- Every request from a platform identity is recorded, not only audited routes (`recordPlatformAccess`, `handler.ts:294-316`), awaited unguarded so a failed audit fails the request.
- **Absent:** no customer-facing read-only session mode. A workspace user is made
  read-only only by their grants — there is a seeded `read_only` role and an
  `executive_read_only` role (`prisma/seed/roles.ts:537`, `:583`) — but no
  session-level flag. A brokerage "observer" is a role, not a mode.

### "Last administrator" protection — present, in three places

- **Revoking your own last administrative role** (`src/services/identity/roles.ts:465-479`): if the assignment being revoked `isAdminCapable` and you would keep no other admin capability — not your primary role, not another in-force assignment (`hasOtherAdminAssignment`, `:501-526`) — it is refused: "This is your last administrative role. Hand administration to someone else before revoking it." `isAdminCapable` is defined as holding `roles:MANAGE_CONFIGURATION` at any scope above NONE (`roles.ts:49-61`). Relinquishing a role you hold otherwise needs no rank (`roles.ts:465-468`).
- **Removing the last administrator account** (`src/services/identity/accounts.ts:548-552`): `role.rank <= ADMIN_ROLE_RANK` and `otherActiveAdmins(...) === 0` → "This is the last active administrator. Promote someone else before removing this account, or the workspace locks itself out."
- **The designated primary administrator** cannot be removed at all (`accounts.ts:537-546`): `WorkspaceMembership.isPrimaryAdmin` is a single named row, refused outright rather than guarded by a count. The same rule is surfaced ahead of time as a deletion blocker (`src/services/identity/accountDeletion.ts:95-105`, reasons `PRIMARY_ADMIN` and the rank check at `:100-105`).
- Note the two guards use **different definitions of administrator**: `roles.ts`
  uses the `roles:MANAGE_CONFIGURATION` capability, `accounts.ts` uses
  `rank <= ADMIN_ROLE_RANK`. Nothing reconciles them, so a role with the
  capability but a weak rank satisfies one and not the other.

---

## F. Sensitive data

Two independent mechanisms, and field security is where multi-role stops.

### `FieldPermission`

`prisma/schema.prisma:3281-3297`: per `[roleId, objectType, fieldKey]` with
`canView`, `canEdit` and an optional `maskStrategy`. Strategies are
`HIDE | MASK_ALL | MASK_PARTIAL | MASK_EMAIL`
(`src/lib/security/fieldSecurity.ts:6`).

`loadFieldRules(ctx, objectType)` (`fieldSecurity.ts:20-26`) queries
`{ tenantId, roleId: ctx.actor.roleId, objectType }` — **`ctx.actor.roleId` is
the primary role only.** Field rules attached to a role held by assignment are
never loaded. This is the clearest half-missing piece of multi-role support, and
it fails _open_ for a restrictive rule (a hiding rule on an assigned role does
not apply) and _closed_ for a permissive one.

The rules are applied in the serialiser, which the file states is the only place
that covers every egress path — list APIs, detail APIs, exports, report output,
webhook payloads and AI prompts (`fieldSecurity.ts:15-19`):

- `seesField(ctx, objectType, rules, field, sensitiveFields)`
  (`fieldSecurity.ts:48-59`): an explicit rule decides first (`rule.canView`); a
  field with no rule is visible unless it is listed in `sensitiveFields`, in
  which case it follows `VIEW_SENSITIVE_FIELDS`.
- `applyFieldSecurity` (`:61-81`) drops the key entirely for `HIDE` or a rule
  with no strategy, otherwise substitutes `mask(value, strategy)` (`:114-139`).
  `MASK_PARTIAL` keeps a phone's country code and last two digits, and nothing at
  all for a local number, because a lead can be found by its full number
  (`:121-127`).
- `stripUneditableFields` (`:84-92`) removes fields the role may not write, so a
  crafted payload cannot smuggle them in.
- `assertFilterableFields` (`:98-112`) **rejects** a filter or sort on a withheld
  field rather than ignoring it, because filtering recovers a masked value by
  binary search (`:94-97`).

### `leads:VIEW_SENSITIVE_FIELDS`

`VIEW_SENSITIVE_FIELDS` is an ordinary catalogue action, held on
`accounts, activities, calls, campaigns, contacts, leads, opportunities, tasks`
(`MANAGED_RECORD`), `documents, events, fieldsales, products, tickets`
(`RECORD`), plus `hr_documents`, `listings` and `recruitment`
(`permissionCatalogue.ts:100`, `:108`, `:118`).

The serialiser names an object type (`LEAD`) while the role editor grants a
module (`leads`), so `MODULE_OF` maps them:
`LEAD→leads, CONTACT→contacts, ACCOUNT→accounts, OPPORTUNITY→opportunities`
(`fieldSecurity.ts:37-42`). The comment records the bug this fixed: lower-casing
the object type checked `lead:VIEW_SENSITIVE_FIELDS`, which no role can hold, so
sensitive fields were withheld from every role (`fieldSecurity.ts:31-36`). Only
those four object types are mapped; any other falls back to
`objectType.toLowerCase()` (`fieldSecurity.ts:58`), which is a live trap for the
next object type added — `LISTING` would check `listing:…`, not `listings:…`.

Being a permission, `VIEW_SENSITIVE_FIELDS` **does** combine across roles via
`grant()`, unlike `FieldPermission`. The two halves of sensitive-data control
therefore disagree about multi-role.

---

## G. Existing default roles

There are **three** distinct role-creation paths, and they disagree about what a
new workspace gets.

### 1. Workspace provisioning — the real path

`src/services/platform/createWorkspace.ts:174-192` creates exactly one role:

- `company_admin` / "Company Administrator", `isSystem: true`, `rank: 10`,
  `defaultScope: 'ORGANIZATION'`, granted **every** `Permission` row in the
  database at `ORGANIZATION` (`:172`, `:185-192`).

The comment at `:150-171` records why: the previous hardcoded grant list had left
36 of 61 modules invisible in any new workspace, so the role now takes the whole
catalogue, matching the sentence it describes itself with.

It then creates the admin `User` on that role (`:193-206`), the
`WorkspaceMembership` with `isPrimaryAdmin: true` and
`roleSnapshot: 'company_admin'` (`:228-240`), **and a `MembershipRole` row for
the same admin role** (`:241-243`) — so the primary administrator holds it both
primarily and by assignment.

### 2. Lead Eagle starter roles

`provisionLeadWork` → `provisionStarterRoles`
(`src/services/platform/provisioning.ts:133-160`), called from
`createWorkspace.ts:251` and from the platform routes
(`src/app/api/v1/platform/subscriptions/[subscriptionId]/route.ts:92`,
`src/app/api/v1/platform/workspaces/[workspaceId]/route.ts`). `STARTER_ROLES`
(`provisioning.ts:52-129`) — all `isSystem: false`, so editable, deactivatable
and deletable like any other:

| key          | name       | rank | defaultScope | line                 |
| ------------ | ---------- | ---- | ------------ | -------------------- |
| `manager`    | Manager    | 20   | ORGANIZATION | `provisioning.ts:54` |
| `team_lead`  | Team Lead  | 30   | TEAM         | `:75`                |
| `agent`      | Agent      | 40   | OWN          | `:91`                |
| `telecaller` | Telecaller | 50   | OWN          | `:99`                |
| `viewer`     | Viewer     | 60   | ORGANIZATION | `:114`               |

Notes from the code: `allocation:APPROVE` does not narrow by scope so it is the
manager's alone, as is visit verification (`provisioning.ts:41-49`); Telecaller is
Agent minus `VIEW_SENSITIVE_FIELDS` and `EXPORT`, and sends from the lead without
the inbox because the inbox names a thread by its full number (`:100-112`);
Viewer reads everything without full contact details and without the inbox
(`:114-128`). Attendance bundles: `OWN_ATTENDANCE` and `TEAM_ATTENDANCE`
(`provisioning.ts:38-39`). A role whose key or case-insensitive name is already
taken is skipped entirely, so an administrator's edits stand
(`provisioning.ts:130-138`).

### 3. The demo seed — 26 roles, and not what a customer gets

`prisma/seed/roles.ts` exports `ROLES: RoleSpec[]` (`:32`) with
`{ key, name, rank, defaultScope, grants }` (`:19-24`) and the scope shorthands
`A/R/B/T/O` (`:26-30`). The file states it mirrors the matrix in
`docs/01-PERMISSIONS.md §4` (`:14`) and that two consumers must not drift: the
seed, and `scripts/seed-role-defaults.ts`, which repairs an existing workspace
and deliberately only fills roles holding **no** grants at all, since a partly
granted role cannot be told apart from one an administrator trimmed (`:8-12`).

The 26 keys: `super_admin` rank 0 (`:33`), `org_admin` rank 10 (`:34`) — both
`{'*': {'*': A}}` — then `sales_director` 20 (`:36`), `regional_manager` 30
(`:71`), `branch_manager` (`:101`), `team_manager` (`:132`), `sales_rep`
(`:152`), `field_rep` (`:171`), `marketing_manager` (`:189`), `marketing_exec`
(`:212`), `service_manager` (`:230`), `service_agent` (`:253`), `analyst`
(`:272`), `hr_admin` (`:311`), `hr_executive` (`:343`), `payroll_officer`
(`:368`), `recruiter` (`:386`), `dept_manager` (`:402`), `site_manager` (`:422`),
`it_admin` (`:442`), `finance_admin` (`:462`), `auditor` (`:487`), `employee`
(`:513`), `read_only` (`:537`), `call_qa` (`:565`), `executive_read_only`
(`:583`).

`prisma/seed/index.ts:575-608` upserts each spec and expands `'*'` wildcards into
every catalogue permission at `ORGANIZATION` (`:593-600`); `calls` and `events`
mirror each role's `leads` grants (`:325-334`).

**The important absence:** this 26-role matrix is the _demo_ catalogue. A real
workspace created through `createWorkspace` gets `company_admin` plus the five
Lead Eagle starter roles — six roles — and none of `sales_director`,
`regional_manager`, `branch_manager`, `team_manager`, `sales_rep`,
`finance_admin` or `auditor` exists in it. Any design that assumes the seeded
names are present in a customer workspace is wrong.

---

## Summary of absences

- No per-grant provenance in `Actor.permissions`; one flat map, strongest scope wins, no deny-overrides (`session.ts:181-184`).
- `MembershipRole.scopeType` is an unvalidated `String` defaulting to `ORGANIZATION`, and an unknown value also caps at `ORGANIZATION` (`schema.prisma:1592`, `session.ts:739`, `route.ts:149`).
- BRANCH/REGION location grants are pooled across assignments, not tracked per permission (`session.ts:808-811`).
- `FieldPermission` is read from the primary role only (`fieldSecurity.ts:22`) — multi-role does not reach field security.
- `MODULE_OF` covers four object types; anything else falls back to a lower-cased type that matches no module (`fieldSecurity.ts:37-42`, `:58`).
- `RolePermission.conditions Json?` exists and is read nowhere in `src`.
- Entitlement is enforced only where a route declares `productModule`; ~32 of 210 `/api/v1` route files do not, and no check script asserts coverage (`handler.ts:227`).
- Server pages have no kernel: entitlement and permission are per-page calls (`src/lib/workspace.ts` exports only `requireWorkspace`).
- No central self-approval helper; the rule is copied per service, and the money approvals (`commissions`, `payouts`, `collections`, `agencyfee`) have none.
- No customer-facing read-only session mode; `platformMode` / `assertMonitoringReadOnly` are platform staff only (`handler.ts:561-569`).
- Two inconsistent definitions of "administrator" in the lock-out guards: `roles:MANAGE_CONFIGURATION` (`roles.ts:49-61`) versus `rank <= ADMIN_ROLE_RANK` (`accounts.ts:548`).
- `MembershipRole` is unique on `[membershipId, roleId]`, so one role cannot have two separate effective windows for the same person (`schema.prisma:1607`).
- Assignment UI exists only on the admin roles page; no per-employee roles tab.
- The 26-role seed matrix is demo-only; a real workspace gets `company_admin` plus five Lead Eagle starter roles.

---

## Verification pass

This inventory was produced by a delegated agent and then spot-checked against
the code. Two claims were confirmed and one was substantially wrong. Recorded
here because an inventory nobody checked is a guess with footnotes.

### Confirmed — `scopeType` is unvalidated and fails open

```
prisma/schema.prisma          scopeType String @default("ORGANIZATION")
roles/[action]/route.ts:148   scopeType: z.string().max(40).optional()
session.ts:735-739            unknown value → falls through to ORGANIZATION
```

Any string passes validation. A typo — `BRACNH` for `BRANCH` — is not rejected,
is not logged, and confers the role's scopes **unnarrowed at workspace level**.
So does omitting the field. This fails open, and it is the one finding here that
is a defect in its own right rather than a design input.

### Confirmed — multi-role is supported end to end

Resolver, API and UI all exist. Phase 3 reuses `MembershipRole`; it does not
need a new mechanism.

### Corrected — the money approvals are mostly guarded

The agent reported "**Nothing** on the money approvals
(`commissions`/`payouts`/`collections`/`agencyfee`)" and called it the biggest
gap for a brokerage. **Three of the four are guarded**, in
`src/services/money/`, which it did not search:

| Path                   | Guard                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `collections.ts:456`   | `receipt.recordedById === ctx.actor.id` — refused           |
| `payouts.ts:191`       | `payout.createdById === ctx.actor.id` on APPROVED — refused |
| `feeAmendments.ts:354` | `amendment.proposedById === ctx.actor.id` — refused         |
| `recoveryCases.ts:279` | `row.proposedById === ctx.actor.id` — refused               |

`collections/receipts/decide/route.ts` even documents the intent: _"the
permission keeps agents out, the identity check keeps a finance clerk from
approving their own entry — and there is no administrator exception to the
second."_

**`commissions.ts` is the real exception.** Confirming an accrual checks the
permission and nothing else (`:239`), as does a clawback (`:317`). Two distinct
questions follow, and the second is the one a brokerage cares about:

1. maker-checker — may the person who created the accrual confirm it?
2. **beneficiary** — may the agent the commission is payable _to_ confirm it,
   if they hold `commissions:APPROVE`?

Whether (2) is reachable depends entirely on whether a Sales Agent/Broker is
ever granted `commissions:APPROVE` — which is a decision the matrix makes. It
is therefore a matrix input **and** a gap, not one or the other.
