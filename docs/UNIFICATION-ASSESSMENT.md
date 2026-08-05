# Unified commercial SaaS assessment

1. **Current architecture:** one Next.js Sales shell and one FastAPI HRMS service,
   with separate legacy identity/session stores and separate domain models.
2. **Why it behaves as two apps:** separate login protocols, HRMS static files,
   direct port navigation and no canonical HR workspace ownership.
3. **Final architecture:** one public Next.js/BFF URL, shared PostgreSQL/Redis/object
   storage, private HRMS service, shared platform identity and explicit workspace context.
4. **Shared user model:** `PlatformUser` is global; `WorkspaceMembership` owns
   company access; `EmployeeProfile` carries HR employment data; the legacy Sales
   `User` is an adapter until Sales relations migrate.
5. **Workspace model:** evolve existing `Tenant` in place to preserve all Sales
   foreign keys, adding company profile, limits, trial and status fields.
6. **Subscription model:** `SubscriptionPlan`, `TenantSubscription` and
   `ModuleEntitlement` remain central; limits are copied to the workspace and may
   be overridden with an audited platform-owner action.
7. **Platform owner:** a global `PlatformRole`, global audit stream and isolated
   `/platform` routes; no customer role can grant this access.
8. **Company admin:** remains a workspace role/permission set linked through a
   membership and cannot reach platform-owner APIs.
9. **HRMS integration:** use shared employee IDs, migrate all HR tables to canonical
   tenant ownership, then accept only BFF service credentials and workspace claims.
10. **Sales integration:** retain existing domain logic behind the shared session,
    then move UI routes under `/app/{workspaceSlug}/sales` through redirects/adapters.
11. **Database migration:** additive tables first, deterministic backfill and
    reconciliation, HR import second, RLS activation third, destructive cleanup last.
12. **Auth migration:** preserve compatible Argon2 hashes, issue only platform
    sessions from the unified login, revoke all legacy web/HR sessions at cutover.
13. **Repository changes:** shared identity/session/policy code in Next.js, platform
    control-plane APIs/pages, HR BFF routes, internal HR authentication, SQL/RLS tests.
14. **Implementation stages:** foundation; control plane; login/workspace paths;
    HR migration; RLS; module completion; release and rollback rehearsal.
15. **Highest risks:** ambiguous duplicate emails, HR records without tenant owners,
    role drift, inactive RLS, premature removal of working HR routes, and rollback
    after new sessions or writes. Each stage therefore stays additive until verified.
