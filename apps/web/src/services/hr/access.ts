/**
 * Who may do what in HR, expressed against the permission scopes the rest of the
 * product already uses.
 *
 * These live in their own module because both `leave.ts` and `settings.ts` need
 * them, and having settings import leave while leave imports settings is a
 * circular dependency. It happens to work today — ES modules tolerate a cycle as
 * long as nothing is read at module-evaluation time — but it breaks the moment
 * anyone adds a top-level constant, and it fails in a way that looks like an
 * unrelated `undefined is not a function`.
 */
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';

/** ORGANIZATION scope on hrms is what HR and company administrators hold. */
export const isHrAdmin = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'hrms', 'EDIT')] >= SCOPE_RANK.ORGANIZATION;

/** TEAM scope and above is a line manager: they decide for their own reports. */
export const isApprover = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'hrms', 'EDIT')] >= SCOPE_RANK.TEAM;
