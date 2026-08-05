import { prisma } from '../db';
import { Forbidden } from '../errors';
import type { Ctx, Scope, Action } from './rbac';
import { scopeFor } from './rbac';

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
 * Cached 5 minutes at `t:{tid}:vis:{uid}:{scope}` — invalidated on team, branch or
 * manager change. Deliberately returns ids rather than a nested query so the
 * planner sees a plain IN list against the (tenantId, ownerId, …) indexes.
 */
export async function resolveOwnerIds(ctx: Ctx, scope: Scope): Promise<string[]> {
  const self = ctx.actor.id;

  switch (scope) {
    case 'OWN':
      return [self];

    case 'TEAM': {
      if (ctx.actor.teamIds.length === 0) return [self, ...ctx.actor.managedUserIds];
      const teamIds = await descendantTeamIds(ctx.tenantId, ctx.actor.teamIds);
      const rows = await prisma.userTeam.findMany({
        where: { tenantId: ctx.tenantId, teamId: { in: teamIds } },
        select: { userId: true },
      });
      return unique([self, ...ctx.actor.managedUserIds, ...rows.map((r) => r.userId)]);
    }

    case 'BRANCH': {
      if (!ctx.actor.branchId) return [self];
      const rows = await prisma.user.findMany({
        where: { tenantId: ctx.tenantId, branchId: ctx.actor.branchId },
        select: { id: true },
      });
      return unique([self, ...rows.map((r) => r.id)]);
    }

    case 'REGION': {
      if (!ctx.actor.regionId) return [self];
      const branches = await prisma.branch.findMany({
        where: { tenantId: ctx.tenantId, regionId: ctx.actor.regionId },
        select: { id: true },
      });
      const rows = await prisma.user.findMany({
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
async function descendantTeamIds(tenantId: string, roots: readonly string[]): Promise<string[]> {
  const seen = new Set(roots);
  let frontier = [...roots];
  while (frontier.length) {
    const children = await prisma.team.findMany({
      where: { tenantId, parentTeamId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  return [...seen];
}

/** Write-path check. Call inside the transaction, after loading the current row. */
export async function assertRecordVisible(
  ctx: Ctx,
  module: string,
  record: { tenantId: string; ownerId?: string | null } & Record<string, unknown>,
  action: Action = 'EDIT',
  ownerField = 'ownerId',
) {
  if (record.tenantId !== ctx.tenantId) throw Forbidden();
  const scope = scopeFor(ctx, module, action);
  if (scope === 'NONE') throw Forbidden();
  if (scope === 'ORGANIZATION') return;

  const ownerId = record[ownerField] as string | null | undefined;
  if (ownerId == null) return; // unassigned; claiming is governed by ASSIGN
  const allowed = await resolveOwnerIds(ctx, scope);
  if (!allowed.includes(ownerId)) throw Forbidden();
}

const unique = (xs: string[]) => [...new Set(xs)];
