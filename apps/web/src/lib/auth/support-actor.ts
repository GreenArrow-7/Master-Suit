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
 * The modules a monitoring identity may read, named one at a time.
 *
 * ── Why a list of what is allowed, not a list of what is not ────────────────
 *
 * This was `NEVER_AMBIENT_MODULES`: the loop below read every row in the
 * permission catalogue and skipped six HR ones. That is a denylist, and it is
 * wrong in a way the passing tests could not show — it granted every *other*
 * module, including every module that does not exist yet. A `commissions` or
 * `payouts` or `contests` table added next quarter would be readable by every
 * platform identity on the day its permission rows were seeded, with nobody
 * deciding that and no test failing.
 *
 * The set below is the whole of what a monitoring identity can reach. Adding a
 * module is a deliberate edit here, in review, which is the cost the requirement
 * asks for. `tests/security/platform-support-access.spec.ts` seeds a brand-new
 * permission module and asserts it is NOT granted, so the denylist cannot come
 * back by accident.
 *
 * ── What is on it, and why ──────────────────────────────────────────────────
 *
 * Exactly the operational surface the console is specified to expose: leads and
 * their follow-ups (the follow-up routes declare `leads`), call metadata,
 * activity, tasks, site visits, and service tickets — which with breached-SLA
 * leads are the "operational exceptions". Nothing else: not accounts, not
 * contacts, not opportunities, not reports, and above all not employment
 * records. A support question that genuinely needs one of those is a reason to
 * add it here on purpose.
 *
 * `VIEW_REPORTS` is deliberately absent from the action list below as well, so
 * this grants reading records and not the roll-ups built from them.
 */
export const MONITORING_MODULES = new Set(['leads', 'calls', 'activities', 'tasks', 'visits', 'tickets']);

/**
 * And the actions, which is the other half of "read-only".
 *
 * One action, not a range. `VIEW_REPORTS` used to ride along with `VIEW`; it is
 * a different capability (aggregate views across a workspace) and nothing in the
 * monitoring journey needs it.
 */
export const MONITORING_ACTIONS = ['VIEW'] as const;

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
 *     `VIEW` on the modules named in `MONITORING_MODULES` below, nothing else,
 *     and no `VIEW_SENSITIVE_FIELDS`.
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
  /**
   * `monitoringOnly`: the session was proven with the MONITORING password. It
   * gets the monitoring allowlist and nothing else — no break-glass elevation,
   * even for an OWNER holding a live WRITE grant. `credentialPurpose` is carried
   * onto the actor so audit rows can name it.
   */
  options: { monitoringOnly?: boolean; credentialPurpose?: 'PLATFORM_ADMIN' | 'MONITORING' | null } = {},
): Promise<Actor> {
  // Checked on every request rather than cached with the session: a grant that
  // has expired, or been handed back from another tab, must stop working now and
  // not at the next sign-in.
  //
  // The `=== 'OWNER'` is what makes the service identity structurally read-only:
  // there is no grant, no scope string and no column value that reaches this
  // branch for AI_SERVICE. Giving it write capability later means editing this
  // line, in review, which is the intended cost.
  const fullControl =
    !options.monitoringOnly && platformRole === 'OWNER' && (await activeGrant(platformUserId, tenantId)) !== null;
  /**
   * Three different questions, and only the first is a denylist-shaped one.
   *
   *   * break-glass (`fullControl`) — every permission there is, because a data
   *     repair cannot be scoped in advance. Audited, time-boxed, reason-carrying.
   *   * a service credential (`serviceScopes`) — already a positive allowlist:
   *     the scopes were minted one at a time and validated at mint time.
   *   * ambient monitoring — the allowlist above, and nothing else.
   */
  const grantable = await prisma.permission.findMany({
    ...(fullControl ? {} : { where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } } }),
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of grantable) {
    if (!fullControl && !serviceScopes) {
      // Ambient monitoring. Both halves are positive: the module must be named
      // on the allowlist and the action must be one this journey needs.
      if (!MONITORING_MODULES.has(permission.module)) continue;
      if (!(MONITORING_ACTIONS as readonly string[]).includes(permission.action)) continue;
    }
    // An absent list is "no narrowing" for staff; an empty one is "nothing
    // granted" for a credential, which is why the two cases are distinguished
    // rather than both treated as falsy. A credential minted with a forgotten
    // scopes argument must read nothing, not everything.
    if (serviceScopes && !serviceScopes.includes(`${permission.module}:read`)) continue;
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
    platformMode: platformRole === 'AI_SERVICE' ? 'service' : fullControl ? 'break-glass' : 'monitoring',
    credentialPurpose: options.credentialPurpose ?? null,
  };
}
