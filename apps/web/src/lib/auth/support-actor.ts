import { prisma } from '../db';
import type { Actor, Scope } from '../security/rbac';
import { activeGrant } from './platform-access';

/**
 * Platform roles allowed to open a customer workspace without a membership.
 *
 * `AI_SERVICE` is deliberately absent. This set gates the *session* path in
 * resolveCtx, and a service identity has no session to reach it with — it
 * arrives through requirePlatformServiceActor, which calls `buildSupportActor`
 * directly. Adding it here would create a second, session-shaped way in for a
 * credential that is supposed to have exactly one.
 */
const SUPPORT_ROLES = new Set(['OWNER', 'SUPPORT', 'SECURITY_AUDITOR']);

export const isSupportRole = (platformRole: string) => SUPPORT_ROLES.has(platformRole);

/**
 * What marks an `Actor.id` as platform staff rather than one of the customer's
 * own users, and how the platform user id is read back out of it.
 *
 * Exported because two other modules now depend on the shape: the API kernel and
 * the workspace page gate both decide "is this caller platform staff, and which
 * one" from the actor id alone, which is the only identity a Ctx carries once
 * the session has been resolved. Written out three times it is three chances for
 * an audit hook to stop recognising the caller it exists to record.
 */
export const PLATFORM_ACTOR_PREFIX = 'platform:';

export const platformUserIdOf = (actorId: string): string | null =>
  actorId.startsWith(PLATFORM_ACTOR_PREFIX) ? actorId.slice(PLATFORM_ACTOR_PREFIX.length) : null;

/**
 * Modules a platform identity never reaches ambiently.
 *
 * Employment records are the one category of a customer's data that platform
 * staff have no ordinary reason to see: a support question about a lead, a call
 * or a site visit is answered from the Sales modules, and none of the monitoring
 * journey touches People. Payroll is the sharpest of them — `mayReadPayroll` in
 * services/hr/payroll.ts is satisfied by `payroll:VIEW` at ORGANIZATION, which is
 * precisely what the loop below was handing out.
 *
 * Named rather than derived. A prefix test (`hr_*`) would miss `payroll`,
 * `employee`, `overtime`, `performance` and `recruitment`, which is most of the
 * list, and a "module the People screens use" lookup would be a second source of
 * truth that drifts. `attendance` and `leave` are deliberately absent: they carry
 * only APPROVE, and the loop grants VIEW and VIEW_REPORTS, so they were never
 * reachable this way — listing them would imply a protection that is not what
 * keeps them out.
 *
 * Two doors remain open, and both are deliberate. A break-glass grant is the
 * audited, time-boxed, reason-carrying way an OWNER repairs a customer's data,
 * and it must be able to reach payroll or it cannot fix a payroll fault. An
 * explicit `payroll:read` on a service credential is an owner's deliberate act,
 * minted per credential and audited per request. What is closed is the third
 * door: reaching it by simply being platform staff.
 */
const NEVER_AMBIENT_MODULES = new Set([
  'employee',
  'hr_documents',
  'overtime',
  'payroll',
  'performance',
  'recruitment',
]);

/**
 * The actor platform staff get inside a customer workspace.
 *
 * Platform staff hold no WorkspaceMembership by design — they are not employees
 * of the company — so there is no role to derive permissions from. Without this,
 * every workspace URL is unreachable for them and the People and Sales modules
 * cannot be seen at all from the platform console.
 *
 * Authority depends on the platform role, and — for OWNER — on whether they have
 * opened a break-glass grant:
 *
 *   * **OWNER without a grant** is read-only, exactly like SUPPORT. This used to
 *     be full control, permanently, from the moment a workspace was opened. The
 *     argument for it was that a read-only owner cannot fix a customer's data,
 *     which is true and is an argument for *elevation being available*, not for
 *     it being ambient — reading a customer's data and changing it are different
 *     acts.
 *   * **OWNER with a live grant** holds every permission at ORGANIZATION scope,
 *     until the grant expires. See lib/auth/platform-access.ts: a stated reason,
 *     a clock, and a row in the customer's audit trail.
 *   * **SUPPORT** and **SECURITY_AUDITOR** stay read-only and cannot elevate:
 *     VIEW and VIEW_REPORTS outside the HR modules below, nothing else, and no
 *     VIEW_SENSITIVE_FIELDS.
 *
 * This comment used to claim that "salary and identity documents stay behind the
 * company's own permission checks". They did not. `VIEW_SENSITIVE_FIELDS` is
 * withheld, which is what that sentence was describing, but payroll is not a
 * sensitive *field* — `services/hr/payroll.ts` gates it on `payroll:VIEW` at
 * ORGANIZATION scope, and the loop below handed exactly that to every support
 * role. A read-only platform identity could list every payroll run, open every
 * payslip with its net pay, read compensation history, and download any
 * employee's payslip PDF. The test that looked like it covered this asserted
 * only that VIEW_SENSITIVE_FIELDS was absent, so it passed throughout.
 *
 * Writes are attributed to the namespaced actor id below, so an audit row from
 * platform staff can never be mistaken for one of the customer's own users.
 * Entry is recorded as a PlatformAuditEvent by the route that sets it up.
 */
export async function buildSupportActor(
  tenantId: string,
  platformUserId: string,
  platformRole: string,
  /**
   * `module:read` strings from a service credential, narrowing the map further.
   *
   * Only meaningful for `AI_SERVICE`, which is the only caller that carries a
   * per-credential scope list. Omitted for staff, whose authority comes from
   * their platform role and — for OWNER — a break-glass grant.
   */
  serviceScopes?: string[],
): Promise<Actor> {
  // Checked on every request rather than cached with the session: a grant that
  // has expired, or been handed back from another tab, must stop working now and
  // not at the next sign-in.
  //
  // The `=== 'OWNER'` is what makes the service identity structurally read-only:
  // there is no grant, no scope string and no column value that reaches this
  // branch for AI_SERVICE. Giving it write capability later means editing this
  // line, in review, which is the intended cost.
  const fullControl = platformRole === 'OWNER' && (await activeGrant(platformUserId, tenantId)) !== null;
  const grantable = await prisma.permission.findMany({
    ...(fullControl ? {} : { where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } } }),
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of grantable) {
    // An absent list is "no narrowing" for staff; an empty one is "nothing
    // granted" for a credential, which is why the two cases are distinguished
    // rather than both treated as falsy. A credential minted with a forgotten
    // scopes argument must read nothing, not everything.
    if (serviceScopes && !serviceScopes.includes(`${permission.module}:read`)) continue;
    // Ambient means "granted for being platform staff". A break-glass grant is
    // not ambient, and neither is a scope an owner minted onto a credential —
    // both have already been asked for by name, so both pass. See the set above.
    if (NEVER_AMBIENT_MODULES.has(permission.module) && !fullControl && !serviceScopes) continue;
    permissions.set(`${permission.module}:${permission.action}`, 'ORGANIZATION');
  }

  /**
   * The role name follows who they *are*, not what they may currently do.
   *
   * Deriving it from `fullControl` made an un-elevated OWNER report as
   * `platform_support`, which puts the wrong name on every audit row they
   * generate and tells the console the wrong thing about who is signed in.
   * Authority lives in `permissions`; identity lives here.
   */
  const roleKey =
    platformRole === 'OWNER'
      ? 'platform_owner'
      : platformRole === 'AI_SERVICE'
        ? 'platform_service'
        : 'platform_support';

  return {
    // Namespaced so it can never collide with a real User id, and so anything
    // that does slip through to an audit row is obviously platform staff.
    id: `${PLATFORM_ACTOR_PREFIX}${platformUserId}`,
    tenantId,
    // What the chrome shows for staff inside a customer workspace — the staff
    // member's own name stays out of the customer-facing shell deliberately.
    // A service identity names the *kind* of caller rather than the account, for
    // the same reason: nothing tenant-facing should read as a person here.
    fullName: platformRole === 'AI_SERVICE' ? 'Platform service' : 'Platform staff',
    email: '',
    // From `roleKey` above, not from `fullControl`. Main's side of this merge
    // derived both from the grant, which is the behaviour the comment above
    // exists to describe as wrong: an un-elevated OWNER reported as
    // `platform_support`, putting the wrong name on every audit row they wrote.
    roleId: roleKey,
    roleKey,
    roleRank: 0,
    branchId: null,
    regionId: null,
    grantedBranchIds: [],
    grantedRegionIds: [],
    teamIds: [],
    managedUserIds: [],
    permissions,
  };
}
