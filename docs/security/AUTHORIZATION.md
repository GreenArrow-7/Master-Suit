# Authorization

Current observed behaviour. VERIFIED from implementation unless labelled.

## Roles

- **Platform roles** (`enum PlatformRole`): `USER`, `OWNER`, `SUPPORT`,
  `SECURITY_AUDITOR`, `AI_SERVICE`. `isPlatformOwner` = `OWNER`;
  `isPrivilegedPlatformRole` = `OWNER | SUPPORT | SECURITY_AUDITOR` (MFA
  mandatory; may enter a workspace without a membership through a grant);
  `isPlatformServiceRole` = `AI_SERVICE`. E1 `src/lib/auth/platform-policy.ts`.
- **Workspace roles**: `Role` rows per tenant (rank-ordered), assigned via
  `MembershipRole`; permissions are `RolePermission` rows referencing
  `Permission` (`module` + `action`) with a `Scope`; optional
  `FieldPermission` rows restrict fields per object type. Default role sets
  are seeded by `scripts/seed-role-defaults.ts`;
  `backfill-admin-permissions.mjs` repairs administrators. E1 schema,
  scripts.

## Permissions and scopes

`Scope = NONE | OWN | TEAM | BRANCH | REGION | ORGANIZATION` (ranked);
`Action` enumerates view/create/edit/delete/export/… per module. The resolved
`PermissionMap` lives on `Ctx` (cached in Redis by `actorCache.ts`,
invalidated on role change — TESTED `tests/security/actor-cache`). E1
`src/lib/security/rbac.ts`.

Helpers: `scopeFor(ctx, module, action)`, `can()`, `assertPermission()`
(403 `Forbidden`), `assertScopeAtLeast()`, `assertMayAdministerRole()` (a user
may not grant above their own rank — TESTED `role-guard-rails`,
`admin-editors`).

## Server-side checks by layer

| Layer | Check | Evidence |
|---|---|---|
| Route kernel | `assertModuleEntitlement` then `assertPermission(ctx, spec.module, spec.action)`; `selfService` specs skip the permission check but still require auth + tenant | E1 `src/lib/api/handler.ts` |
| Page access | `requirePageAccess` / `resolveWorkspacePage` (`src/lib/workspace-page.ts`), layout computes `permitted` modules for navigation only | E1 |
| Record visibility | `visibilityWhere(ctx, module, action, …)` builds the Prisma `where` for the scope (owner ids via `resolveOwnerIds`: own / team / branch / region); `assertRecordVisible` for single records → 404 | E1 `src/lib/security/visibility.ts`; E3 `tests/tenant/visibility-where-merge`, `tests/permission/scope` |
| Field level | `loadFieldRules`, `applyFieldSecurity` (strip unreadable), `stripUneditableFields`, `assertFilterableFields` | E1 `fieldSecurity.ts`; E3 `tests/tenant/field-security` |
| Module entitlement | `assertModuleEntitlement(tenantId, 'HRMS'|'SALES')` from `ModuleEntitlement`/subscription, cached 60 s, cleared on revoke | E1 `entitlements.ts`; E3 `tests/tenant/module-entitlement`, `engagement-modules` |
| Data layer | Prisma tenant guard + PostgreSQL RLS (see `docs/architecture/DATABASE.md`) | E1; E3 `tests/tenant/*` |
| Workers | jobs run with a system/tenant `Ctx`; queue fairness per tenant | E1 `src/lib/queueFairness.ts`; E3 `tests/permission/queue-fairness` |

## Ownership checks

Ownership is expressed as scope `OWN` resolved to the actor's user id (and
`TEAM`/`BRANCH`/`REGION` to member sets) inside `visibilityWhere`; services
such as `updateLead`/`deleteLead` take `Ctx` and apply it. Follow-ups GET
scoping was confirmed in an earlier assessment (`tenantId + ownerId =
actor`). E1. Self-service routes (own profile, own API keys, own
notifications) are `selfService` and scoped to the actor — TESTED
`tests/tenant/notifications-self-service`, `tests/security/self-service-api-key`.

## Administrative authorization

- Platform console routes require a privileged platform role with
  `mfaSatisfied`; `SECURITY_AUDITOR` is read-oriented (INFERRED from name and
  policy comments — per-route matrix not compiled in Phase A).
- Support entry into a workspace: `PlatformAccessGrant` with reason (≥ 12
  chars) and duration (default 30, max 240 minutes); the earlier behaviour
  that gave `OWNER` every permission everywhere was replaced (comment in
  `platform-access.ts`). TESTED `platform-support-access`,
  `platform-break-glass`, `platform-admin-crud`, `platform-user-recovery`.
- Workspace administrators manage roles within rank limits; HR-sensitive
  actions carry their own checks (`tests/security/hr-employee-escalation`,
  `hr-overtime-scope` — the latter fixed a HIGH finding F-01 in
  `security/SECURITY_FINDINGS.md`).

## Known authorization boundaries and caveats

- 38 route files do not use the kernel; each implements its own checks
  (health, metrics, webhooks, public forms are expected to be
  unauthenticated). A per-route authorization matrix exists for an earlier
  date in `security/APPLICATION_ATTACK_SURFACE.md` (2026-08-08, "extracted
  from source"); it predates later routes. Refreshing it is a Phase A gap
  (GAP-SEC-02; evidence conflict **EVC-010**; observation SEC-OBS-002).
- Cross-tenant and out-of-scope records are indistinguishable (404) by
  design (`apps/web/docs/03-API.md`).
- `F-03` (an overtime approver may approve their own claim) is reported and
  not fixed by owner decision (E4 `security/SECURITY_FINDINGS.md`).
- UI `permitted` lists are convenience only; the server re-checks.

## Evidence Sources

E1: `apps/web/src/lib/security/{rbac,visibility,fieldSecurity,entitlements,audit}.ts`,
`src/lib/auth/{platform-policy,platform-access,actorCache}.ts`,
`src/lib/api/handler.ts`, `src/lib/workspace-page.ts`, `src/lib/queueFairness.ts`,
`prisma/schema.prisma` (`Role`, `Permission`, `RolePermission`,
`FieldPermission`, `MembershipRole`, `PlatformAccessGrant`),
`scripts/seed-role-defaults.ts`, `scripts/backfill-admin-permissions.mjs`.
E3: `apps/web/tests/permission/*`, `tests/tenant/*`, `tests/security/*`.
E4: `apps/web/docs/01-PERMISSIONS.md`, `apps/web/docs/03-API.md`,
`security/APPLICATION_ATTACK_SURFACE.md`, `security/SECURITY_FINDINGS.md`.
Unverified: per-route matrix for the 38 raw handlers; exact
`SECURITY_AUDITOR` write restrictions.
