import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  acknowledgeCase,
  assignCase,
  listCases,
  proposeResolution,
  recordRecovery,
} from '@/services/money/recoveryCases';

/**
 * Recovery and adjustment cases. Everything a case-worker does is here under
 * `collections:CREATE`; the one thing that needs a second person — approving
 * a write-off or an adjustment — is on `./approve` under `collections:APPROVE`.
 */
export const GET = route(
  {
    module: 'collections',
    productModule: 'SALES',
    action: 'VIEW',
    query: z
      .object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLUTION_PROPOSED', 'RESOLVED']).optional(),
        assigneeId: z.string().cuid().optional(),
      })
      .strict(),
  },
  async ({ ctx, query }) => ({ data: await listCases(ctx, query) }),
);

const amount = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'A positive amount with at most two decimals.');
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ASSIGN'), caseId: z.string().cuid(), assigneeId: z.string().cuid() }).strict(),
  z.object({ action: z.literal('ACKNOWLEDGE'), caseId: z.string().cuid(), note: z.string().min(4).max(1000) }).strict(),
  z
    .object({
      action: z.literal('RECOVER'),
      caseId: z.string().cuid(),
      recoveredAmount: amount,
      resolutionReference: z.string().min(2).max(200),
      providerTransactionRef: z.string().min(4).max(200).optional(),
      evidenceDocumentId: z.string().cuid().optional(),
      note: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('PROPOSE'),
      caseId: z.string().cuid(),
      outcome: z.enum(['WRITTEN_OFF', 'ADJUSTED']),
      reason: z.string().min(4).max(1000),
    })
    .strict(),
]);

export const PATCH = route(
  { module: 'collections', productModule: 'SALES', action: 'CREATE', body, auditEvent: 'STAGE_CHANGED' },
  async ({ ctx, body }) => {
    switch (body.action) {
      case 'ASSIGN':
        return assignCase({ ctx, caseId: body.caseId, assigneeId: body.assigneeId });
      case 'ACKNOWLEDGE':
        return acknowledgeCase({ ctx, caseId: body.caseId, note: body.note });
      case 'RECOVER':
        return recordRecovery({ ctx, ...body });
      case 'PROPOSE':
        return proposeResolution({ ctx, caseId: body.caseId, outcome: body.outcome, reason: body.reason });
    }
  },
);
