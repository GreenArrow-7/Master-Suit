import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { decideReceipt } from '@/services/money/collections';

/**
 * The second person.
 *
 * `collections:APPROVE` gets you in the door; the service still refuses if you
 * are the one who recorded it. Both halves are needed: the permission keeps
 * agents out, the identity check keeps a finance clerk from approving their
 * own entry — and there is no administrator exception to the second.
 */
const body = z
  .object({
    receiptId: z.string().cuid(),
    to: z.enum(['VERIFIED', 'REJECTED']),
    reason: z.string().min(4).max(1000).optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'collections', productModule: 'SALES', action: 'APPROVE', body, auditEvent: 'STAGE_CHANGED' },
  async ({ ctx, body }) => decideReceipt({ ctx, ...body }),
);
