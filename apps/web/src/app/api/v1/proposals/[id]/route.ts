import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { closeProposal, proposalDetail, sendProposal } from '@/services/proposals/proposals';

const params = z.object({ id: z.string().min(1) });

export const GET = route(
  { module: 'requirements', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params: { id } }) => proposalDetail(ctx, id),
);

const patchBody = z.object({
  /** Send mints the link; withdraw stops it resolving. */
  action: z.enum(['send', 'withdraw']),
});

export const PATCH = route(
  {
    module: 'requirements',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params: { id }, body }) => {
    if (body.action === 'send') return sendProposal(ctx, id);
    await closeProposal(ctx, id);
    return { url: null };
  },
);
