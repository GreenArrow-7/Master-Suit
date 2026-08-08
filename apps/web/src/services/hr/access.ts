/**
 * Who may do what in HR.
 *
 * The whole module used to run on three permissions — `hrms:VIEW`, `hrms:CREATE`
 * and `hrms:EDIT` — with every finer distinction derived from the *scope* of one
 * of them. That collapsed unrelated authorities into one:
 *
 *   * `hrms:VIEW` returned the entire workspace, because a permission that
 *     coarse has nowhere to put "your own record only";
 *   * `hrms:CREATE` could write a PRESENT attendance record for any employee id,
 *     which is timesheet fraud with no approval step;
 *   * anyone at ORGANIZATION scope on `hrms:EDIT` implicitly read every passport
 *     scan in the company, because `isHrAdmin` was the only gate the document
 *     service had.
 *
 * They are separate permissions now. The mapping from the old three lives in
 * prisma/migrations/20260807030000_granular_hr_permissions — no role gained or
 * lost effective access in the upgrade.
 *
 * This file is separate from leave.ts and settings.ts because both need it, and
 * having settings import leave while leave imports settings is a circular
 * dependency that works only until someone adds a top-level constant.
 */
import { scopeFor, SCOPE_RANK, type Ctx, type Action, type Scope } from '@/lib/security/rbac';

const atLeast = (ctx: Ctx, module: string, action: Action, minimum: Scope) =>
  SCOPE_RANK[scopeFor(ctx, module, action)] >= SCOPE_RANK[minimum];

/**
 * Manages employee records across the workspace: hiring, department structure,
 * work locations, HR policy.
 *
 * Note what this no longer implies — see `mayReadSensitiveDocuments`.
 */
export const isHrAdmin = (ctx: Ctx) => atLeast(ctx, 'employee', 'EDIT', 'ORGANIZATION');

/**
 * Decides leave for other people. TEAM scope and above is a line manager acting
 * for their own reports; ORGANIZATION is HR acting for anyone.
 */
export const isApprover = (ctx: Ctx) => atLeast(ctx, 'leave', 'APPROVE', 'TEAM');

/** Decides attendance exceptions, and may record attendance for someone else. */
export const isAttendanceApprover = (ctx: Ctx) => atLeast(ctx, 'attendance', 'APPROVE', 'TEAM');

/**
 * Reads passport scans, visas, labour cards.
 *
 * Deliberately its own permission rather than a consequence of administering HR.
 * "May restructure the department tree" and "may read everyone's identity
 * documents" are different powers, and a company that wanted to grant the first
 * without the second previously had no way to say so.
 */
export const mayReadSensitiveDocuments = (ctx: Ctx) =>
  atLeast(ctx, 'hr_documents', 'VIEW_SENSITIVE_FIELDS', 'ORGANIZATION');

/** Reads employee records beyond their own. */
export const mayReadEmployees = (ctx: Ctx) => atLeast(ctx, 'employee', 'VIEW', 'TEAM');

/** True when this actor may read every employee record in the workspace. */
export const mayReadAllEmployees = (ctx: Ctx) => atLeast(ctx, 'employee', 'VIEW', 'ORGANIZATION');
