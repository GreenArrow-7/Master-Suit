import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { SCOPE_RANK, scopeFor, type Ctx, type Scope, type Action } from './rbac';
import { scopeCapFor } from './assignmentScope';

/**
 * Nobody may hand out authority they do not hold.
 *
 * Every path that grants a role checks **rank** — you cannot assign a role at
 * or above your own level. Rank and reach are different things: a rank-60
 * "Sales Agent" role can carry ORGANIZATION-scoped permission rows, so a
 * branch manager could assign it and confer a workspace-wide read they do not
 * themselves have. `tests/permission/grant-ceiling.spec.ts` demonstrated it.
 *
 * This is the ceiling, applied **per permission** rather than as one blanket
 * scope. Two parts, and both are needed:
 *
 *   1. **Rank of scope** — the conferred scope may not be wider than the
 *      assigner's own scope for that same `module:ACTION`.
 *   2. **Place** — ordering alone is not containment. A BRANCH-scoped manager
 *      of Marina must not grant BRANCH scope over Downtown. Where the
 *      assignment names a branch, team or region, that place has to sit inside
 *      the assigner's own, by id.
 *
 * It reads the assigner's authority from `ctx.actor.permissions` — the map the
 * session resolver already built — rather than resolving permissions a second
 * time. There is one permission engine and this is not a second one.
 */

/** Region ← Branch ← Team. Narrower places resolve upwards to be compared. */
interface Place {
  teamId?: string | null;
  branchId?: string | null;
  regionId?: string | null;
}

/** Everywhere the assigner's authority reaches, from the actor the resolver built. */
function reachOf(ctx: Ctx) {
  const branchIds = new Set<string>(ctx.actor.grantedBranchIds);
  if (ctx.actor.branchId) branchIds.add(ctx.actor.branchId);
  const regionIds = new Set<string>(ctx.actor.grantedRegionIds);
  if (ctx.actor.regionId) regionIds.add(ctx.actor.regionId);
  return { branchIds, regionIds, teamIds: new Set<string>(ctx.actor.teamIds) };
}

/**
 * Where the assignment applies, resolved up the hierarchy so a team can be
 * compared against a branch-scoped assigner.
 */
async function placeOf(tenantId: string, scopeType: string, scopeId: string | null): Promise<Place> {
  if (!scopeId) return {};
  if (scopeType === 'REGION') return { regionId: scopeId };
  if (scopeType === 'BRANCH') {
    const branch = await prisma.branch.findFirst({
      where: { tenantId, id: scopeId },
      select: { id: true, regionId: true },
    });
    return { branchId: branch?.id ?? scopeId, regionId: branch?.regionId ?? null };
  }
  if (scopeType === 'TEAM' || scopeType === 'DEPARTMENT') {
    const team = await prisma.team.findFirst({
      where: { tenantId, id: scopeId },
      select: { id: true, branchId: true, branch: { select: { regionId: true } } },
    });
    return { teamId: team?.id ?? scopeId, branchId: team?.branchId ?? null, regionId: team?.branch?.regionId ?? null };
  }
  return {};
}

/**
 * Does the assigner's authority cover where this grant applies?
 *
 * An ORGANIZATION assigner covers everything. Below that, the named place must
 * be one of theirs — and a place that resolves to nothing (a team with no
 * branch, under a branch-scoped assigner) is **not** covered, because "I cannot
 * tell where this is" is not permission to grant it.
 */
function placeCovered(actorScope: Scope, reach: ReturnType<typeof reachOf>, place: Place): boolean {
  if (actorScope === 'ORGANIZATION') return true;
  if (actorScope === 'REGION') return !!place.regionId && reach.regionIds.has(place.regionId);
  if (actorScope === 'BRANCH') return !!place.branchId && reach.branchIds.has(place.branchId);
  if (actorScope === 'TEAM') return !!place.teamId && reach.teamIds.has(place.teamId);
  // OWN reaches one person's own records; it confers nothing on anybody else.
  return false;
}

/** The narrower of the role's own permission scope and the assignment's cap. */
const narrower = (a: Scope, b: Scope): Scope => (SCOPE_RANK[a] < SCOPE_RANK[b] ? a : b);

export interface CeilingBreach {
  module: string;
  action: string;
  wouldGrant: Scope;
  assignerHolds: Scope;
  reason: 'wider_scope' | 'outside_place';
}

/**
 * Every permission this assignment would confer that the assigner may not.
 *
 * Returned rather than thrown so a caller can preview a grant — "show the
 * user's effective permissions before saving" needs the list, not an exception.
 */
export async function ceilingBreaches(
  ctx: Ctx,
  roleId: string,
  scopeType: string,
  scopeId: string | null,
): Promise<CeilingBreach[]> {
  const cap = scopeCapFor(scopeType);
  // An unreadable scope grants nothing, so it can breach nothing. The caller
  // rejects it on its own account.
  if (!cap) return [];

  const rows = await prisma.rolePermission.findMany({
    where: { tenantId: ctx.tenantId, roleId, granted: true, scope: { not: 'NONE' } },
    select: { scope: true, permission: { select: { module: true, action: true } } },
  });
  if (rows.length === 0) return [];

  const reach = reachOf(ctx);
  const place = await placeOf(ctx.tenantId, scopeType, scopeId);
  const breaches: CeilingBreach[] = [];

  for (const row of rows) {
    const { module, action } = row.permission;
    const wouldGrant = narrower(row.scope as Scope, cap);
    const assignerHolds = scopeFor(ctx, module, action as Action);

    /**
     * An OWN grant is the floor of the model, not a delegation.
     *
     * It confers access to the grantee's own records and to nothing else — no
     * reach over anything the assigner holds, or could reach, or could be
     * persuaded to reach. Every employee baseline is built from it: the
     * auto-created starter role carries `leads:VIEW` at OWN, and an HR
     * administrator who may create people does not hold `leads:VIEW` at all.
     * Refusing that would mean HR has to be given lead permissions before it
     * can onboard a salesperson, which inflates HR's own authority — the
     * opposite of what this ceiling exists to do. `tests/security/
     * hr-employee-escalation.spec.ts` is the case that holds this honest.
     *
     * Only the "does not hold it at all" arm is relaxed, and only at OWN.
     * Anything wider is refused exactly as before, which is where delegation
     * of authority over other people's records actually happens.
     */
    if (wouldGrant === 'OWN' && assignerHolds === 'NONE') continue;

    if (assignerHolds === 'NONE' || SCOPE_RANK[wouldGrant] > SCOPE_RANK[assignerHolds]) {
      breaches.push({ module, action, wouldGrant, assignerHolds, reason: 'wider_scope' });
      continue;
    }
    // Same width or narrower, but possibly somewhere else entirely: a Marina
    // branch manager granting BRANCH over Downtown passes the rank test and
    // must still be refused.
    if (scopeId && !placeCovered(assignerHolds, reach, place)) {
      breaches.push({ module, action, wouldGrant, assignerHolds, reason: 'outside_place' });
    }
  }
  return breaches;
}

/**
 * Refuses the grant when it would confer anything the assigner lacks.
 *
 * The message names one breach rather than all of them: the list can be long,
 * and the first is enough to act on.
 */
export async function assertWithinGrantCeiling(ctx: Ctx, roleId: string, scopeType: string, scopeId: string | null) {
  const breaches = await ceilingBreaches(ctx, roleId, scopeType, scopeId);
  if (breaches.length === 0) return;

  const first = breaches[0]!;
  const detail =
    first.reason === 'wider_scope'
      ? first.assignerHolds === 'NONE'
        ? `you do not hold ${first.module}:${first.action}`
        : `it would grant ${first.module}:${first.action} at ${first.wouldGrant} and you hold ${first.assignerHolds}`
      : `it would grant ${first.module}:${first.action} somewhere outside your own ${first.assignerHolds.toLowerCase()}`;

  throw Forbidden(
    `You cannot grant more than you hold: ${detail}.` +
      (breaches.length > 1 ? ` (${breaches.length} permissions in this role exceed your authority.)` : ''),
  );
}
