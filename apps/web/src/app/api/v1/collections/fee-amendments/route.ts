import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { listAmendments, proposeAmendment } from '@/services/money/feeAmendments';

/**
 * The agreed agency fee as a commercial term (D-20). Proposing needs
 * `agencyfee:CREATE`; deciding lives on `./decide` behind `agencyfee:APPROVE`.
 * The route layer keeps the two apart, and the service keeps the same person
 * from doing both.
 */
export const GET = route(
  {
    module: 'agencyfee',
    productModule: 'SALES',
    action: 'VIEW',
    query: z.object({ bookingId: z.string().cuid() }).strict(),
  },
  async ({ ctx, query }) => ({ data: await listAmendments(ctx, query.bookingId) }),
);

const proposeBody = z
  .object({
    bookingId: z.string().cuid(),
    proposedFee: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'A positive amount with at most two decimals.'),
    reason: z.string().min(4).max(1000),
    agreementReference: z.string().min(2).max(200),
  })
  .strict();

export const POST = route(
  { module: 'agencyfee', productModule: 'SALES', action: 'CREATE', body: proposeBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => proposeAmendment({ ctx, ...body }),
);
