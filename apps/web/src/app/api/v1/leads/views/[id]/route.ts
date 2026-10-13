import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { LEAD_LIST_VIEW } from '@/services/leads/leadList';

const params = z.object({ id: z.string().cuid() });

/** Deletes one of the caller's own saved lead views; anyone else's answers 404, like a missing id. */
export const DELETE = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', params },
  async ({ ctx, params }) =>
    withTx(ctx.tenantId, async (tx) => {
      const { count } = await tx.smartView.updateMany({
        where: { tenantId: ctx.tenantId, id: params.id, objectType: LEAD_LIST_VIEW, ownerId: ctx.actor.id },
        data: { deletedAt: new Date(), updatedById: ctx.actor.id },
      });
      if (count === 0) throw NotFound('View');
      await audit(ctx, { event: 'RECORD_DELETED', objectType: 'smart_views', recordId: params.id }, tx);
      return { id: params.id };
    }),
);
