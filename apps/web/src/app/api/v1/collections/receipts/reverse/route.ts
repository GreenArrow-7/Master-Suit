import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { reverseReceipt } from '@/services/money/collections';

/**
 * Money going back.
 *
 * A reversal is recorded like a receipt — by someone with `collections:CREATE`
 * — and counts for nothing until a different person verifies it on `./decide`.
 * The original row is never touched; the reversal points at it.
 */
const body = z
  .object({
    receiptId: z.string().cuid(),
    amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Amount must be a positive number with at most two decimals.'),
    reason: z.string().min(4).max(1000),
    requestKey: z.string().min(8).max(200).optional(),
  })
  .strict();

export const POST = route(
  { module: 'collections', productModule: 'SALES', action: 'CREATE', body, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => reverseReceipt({ ctx, ...body }),
);
