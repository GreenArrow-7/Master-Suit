import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { decideAmendment } from '@/services/money/feeAmendments';

/** Finance decides; never the proposer. */
export const PATCH = route(
  {
    module: 'agencyfee',
    productModule: 'SALES',
    action: 'APPROVE',
    body: z
      .object({
        amendmentId: z.string().cuid(),
        to: z.enum(['APPROVED', 'REJECTED']),
        note: z.string().min(4).max(1000).optional(),
      })
      .strict(),
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => decideAmendment({ ctx, ...body }),
);
