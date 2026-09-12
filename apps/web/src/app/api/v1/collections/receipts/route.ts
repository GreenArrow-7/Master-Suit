import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { listReceipts, recordReceipt } from '@/services/money/collections';

/**
 * Agency-fee receipts.
 *
 * A new module rather than an action on `bookings`, because the point of
 * D-8.1 is that the selling agent's `bookings:EDIT` no longer reaches
 * collection at all. Recording needs `collections:CREATE`; verifying lives on
 * `./decide` behind `collections:APPROVE`, so the route layer — not a check
 * buried in a handler — is what keeps the two apart.
 */
const listQuery = z.object({ bookingId: z.string().cuid() }).strict();

export const GET = route(
  { module: 'collections', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => listReceipts(ctx, query.bookingId),
);

const recordBody = z
  .object({
    bookingId: z.string().cuid(),
    /** As a string, so "1234.56" arrives exactly and never as a float. */
    amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Amount must be a positive number with at most two decimals.'),
    currency: z.string().length(3).toUpperCase(),
    paidAt: z.coerce.date(),
    paymentReference: z.string().min(2).max(200),
    providerTransactionRef: z.string().min(4).max(200).optional(),
    evidenceDocumentId: z.string().cuid().optional(),
    /** Same key + same body = same receipt. Different body under a used key is refused. */
    requestKey: z.string().min(8).max(200).optional(),
  })
  .strict();

export const POST = route(
  { module: 'collections', productModule: 'SALES', action: 'CREATE', body: recordBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => recordReceipt({ ctx, ...body }),
);
