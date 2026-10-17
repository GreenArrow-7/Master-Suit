import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { ringNewOwner } from '@/services/crm/notify';
import { assignLeads } from '@/services/leads/assign';

const body = z
  .object({
    leadIds: z.array(z.string().cuid()).min(1).max(500),
    ownerId: z.string().cuid(),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'ASSIGN', body, auditEvent: 'OWNER_CHANGED' },
  async ({ ctx, body: { leadIds, ownerId } }) => {
    const moved = await withTx(ctx.tenantId, (tx) => assignLeads(ctx, tx, leadIds, ownerId, 'bulk_assignment'));
    // The bell rows committed with the move; one push, not one per lead (audit M17-05).
    await ringNewOwner(ctx, ownerId, moved);
    return { assigned: moved.length };
  },
);
