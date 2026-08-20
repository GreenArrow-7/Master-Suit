import { cache } from 'react';
import { prisma, type TxClient } from '../db';
import { Forbidden } from '../errors';
import type { Ctx, Scope, Action } from './rbac';
import { scopeFor } from './rbac';

/**
 * The client visibility lookups run on.
 *
 * It matters which one. These helpers are called from inside `withTx`, and
 * `withTx` sets `app.tenant_id` on *its own* connection. A query issued through
 * the global client from inside that callback lands on a different pooled
 * connection with no tenant context, so once RLS was enforced the team and
 * branch lookups returned nothing and a manager's legitimate edit was refused.
 * Callers inside a transaction must pass `tx`.
 */
type VisibilityDb = TxClient | typeof prisma;

/**
 * Translates a permission scope into a Prisma `where` fragment on the owner column.
 *
 * Applied to every read. Re-applied on write by loading the record inside the
 * transaction and calling assertRecordVisible — checking only on read is the
 * classic IDOR, because a PATCH never passes through the list query.
 */
export interface VisibilityOptions {
  /** Column holding the owning user. Tickets use agentId, field visits use userId. */
  ownerField?: string;
  /** Include ownerless records. Requires ASSIGN at TEAM or wider — see docs/01 §2. */
  includeUnassigned?: boolean;
}

export async function visibilityWhere(
  ctx: Ctx,
  module: string,
  action: Action = 'VIEW',
  opts: VisibilityOptions = {},
): Promise<Record<string, unknown>> {
  const scope = scopeFor(ctx, module, action);
  const ownerField = opts.ownerField ?? 'ownerId';
  const base: Record<string, unknown> = { tenantId: ctx.tenantId };

  if (scope === 'ORGANIZATION') return base;
  if (scope === 'NONE') throw Forbidden();

  const ownerIds = await resolveOwnerIds(ctx, scope);
  const clauses: Record<string, unknown>[] = [{ [ownerField]: { in: ownerIds } }];

  const mayClaim = ['ASSIGN', 'REASSIGN'].some((a) => {
    const s = scopeFor(ctx, module, a as Action);
    return s !== 'NONE' && s !== 'OWN';
  });
  if (opts.includeUnassigned && mayClaim) clauses.push({ [ownerField]: null });

  return { ...base, OR: clauses };
}

/**
 * The set of user ids whose records the actor may see at the given scope.
 *
 * Memoized per request via React `cache` below — a dashboard render asks for
 * the leads scope several times, and each uncached answer for a TEAM viewer is
 * a team-tree walk plus a member lookup. (An earlier comment here claimed a
 * 5-minute Redis cache; none ever existed, and a cross-request cache would let
 * a team change linger — per-request is the honest window.) Deliberately
 * returns ids rather than a nested query so the planner sees a plain IN list
 * against the (tenantId, ownerId, …) indexes.
 */
export function resolveOwnerIds(ctx: Ctx, scope: Scope, db: VisibilityDb = prisma): Promise<string[]> {
  return ownerIdsMemo(ctx, scope, db);
}

// Outside a React request scope (workers, route handlers) `cache` simply does
// not memoize; behaviour there is unchanged.
const ownerIdsMemo = cache(resolveOwnerIdsUncached);

async function resolveOwnerIdsUncached(ctx: Ctx, scope: Scope, db: VisibilityDb): Promise<string[]> {
  const self = ctx.actor.id;

  switch (scope) {
    case 'OWN':
      return [self];

    case 'TEAM': {
      if (ctx.actor.teamIds.length === 0) return [self, ...ctx.actor.managedUserIds];
      const teamIds = await descendantTeamIds(ctx.tenantId, ctx.actor.teamIds, db);
      const rows = await db.userTeam.findMany({
        where: { tenantId: ctx.tenantId, teamId: { in: teamIds } },
        select: { userId: true },
      });
      return unique([self, ...ctx.actor.managedUserIds, ...rows.map((r) => r.userId)]);
    }

    case 'BRANCH': {
      // The actor's own branch, plus any branch a BRANCH-scoped role
      // assignment names — a manager covering a second branch sees it without
      // being moved there.
      const branchIds = unique(
        [ctx.actor.branchId, ...ctx.actor.grantedBranchIds].filter((id): id is string => !!id),
      );
      if (branchIds.length === 0) return [self];
      const rows = await db.user.findMany({
        where: { tenantId: ctx.tenantId, branchId: { in: branchIds } },
        select: { id: true },
      });
      return unique([self, ...rows.map((r) => r.id)]);
    }

    case 'REGION': {
      const regionIds = unique(
        [ctx.actor.regionId, ...ctx.actor.grantedRegionIds].filter((id): id is string => !!id),
      );
      if (regionIds.length === 0) return [self];
      const branches = await db.branch.findMany({
        where: { tenantId: ctx.tenantId, regionId: { in: regionIds } },
        select: { id: true },
      });
      const rows = await db.user.findMany({
        where: { tenantId: ctx.tenantId, branchId: { in: branches.map((b) => b.id) } },
        select: { id: true },
      });
      return unique([self, ...rows.map((r) => r.id)]);
    }

    default:
      return [];
  }
}

/** Team visibility descends the tree: a manager of a parent team sees its children. */
async function descendantTeamIds(
  tenantId: string,
  roots: readonly string[],
  db: VisibilityDb = prisma,
): Promise<string[]> {
  const seen = new Set(roots);
  let frontier = [...roots];
  while (frontier.length) {
    const children = await db.team.findMany({
      where: { tenantId, parentTeamId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  return [...seen];
}

/**
 * Write-path check. Call inside the transaction, after loading the current row.
 *
 * `db` must be the transaction client — see the note on VisibilityDb. It is
 * required rather than defaulted: every caller is already inside a transaction,
 * and a silent default is exactly how the wrong connection got used before.
 */
export async function assertRecordVisible(
  ctx: Ctx,
  module: string,
  record: { tenantId: string; ownerId?: string | null } & Record<string, unknown>,
  db: VisibilityDb,
  action: Action = 'EDIT',
  ownerField = 'ownerId',
) {
  if (record.tenantId !== ctx.tenantId) throw Forbidden();
  const scope = scopeFor(ctx, module, action);
  if (scope === 'NONE') throw Forbidden();
  if (scope === 'ORGANIZATION') return;

  const ownerId = record[ownerField] as string | null | undefined;
  if (ownerId == null) return; // unassigned; claiming is governed by ASSIGN
  const allowed = await resolveOwnerIds(ctx, scope, db);
  if (!allowed.includes(ownerId)) throw Forbidden();
}

const unique = (xs: string[]) => [...new Set(xs)];
