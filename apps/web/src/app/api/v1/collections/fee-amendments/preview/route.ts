import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { previewAmendment } from '@/services/money/feeAmendments';

/** What approving a fee would do, before anyone proposes it. Read-only. */
export const GET = route(
  {
    module: 'agencyfee',
    productModule: 'SALES',
    action: 'CREATE',
    query: z.object({ bookingId: z.string().cuid(), proposedFee: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/) }).strict(),
  },
  async ({ ctx, query }) =>
    withTx(ctx.tenantId, (tx) =>
      previewAmendment(tx, ctx.tenantId, query.bookingId, new Prisma.Decimal(query.proposedFee)),
    ),
);
