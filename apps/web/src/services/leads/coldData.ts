import { atLeast, type Ctx } from '@/lib/security/rbac';

/**
 * Whose cold data a person sees and works: everything with organisation-wide
 * lead access, otherwise the records assigned to them. A list arrives
 * unassigned; whoever holds leads:ASSIGN hands it out.
 */
export function coldDataScope(ctx: Ctx) {
  // ponytail: own-or-all; team managers see their own until someone needs a team view.
  return atLeast(ctx, 'leads', 'VIEW', 'ORGANIZATION')
    ? { tenantId: ctx.tenantId }
    : { tenantId: ctx.tenantId, ownerId: ctx.actor.id };
}
