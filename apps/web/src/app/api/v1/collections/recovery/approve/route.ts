import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { decideResolution } from '@/services/money/recoveryCases';

/** The second person on a write-off or adjustment. Never the proposer. */
export const PATCH = route(
  {
    module: 'collections',
    productModule: 'SALES',
    action: 'APPROVE',
    body: z
      .object({ caseId: z.string().cuid(), approve: z.boolean(), note: z.string().min(4).max(1000).optional() })
      .strict(),
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => decideResolution({ ctx, ...body }),
);
