import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { loadFieldRules, applyFieldSecurity, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { updateOpportunity, deleteOpportunity } from '@/services/opportunities/updateOpportunity';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'opportunities', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
    const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
    const opportunity = await prisma.opportunity.findFirst({
      where: { ...scope, id: params.id },
      include: {
        stage: true,
        pipeline: true,
        account: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!opportunity) throw NotFound('Opportunity');
    return applyFieldSecurity(ctx, 'OPPORTUNITY', rules, opportunity);
  },
);

const patchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    stageId: z.string().cuid().optional(),
    ownerId: z.string().cuid().nullable().optional(),
    amount: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    expectedCloseDate: z.string().datetime().nullable().optional(),
    status: z.enum(['OPEN', 'WON', 'LOST', 'ABANDONED']).optional(),
    lossReasonId: z.string().cuid().optional(),
    lossNotes: z.string().max(1000).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'opportunities',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
    const safe = stripUneditableFields(rules, body);
    const opportunity = await updateOpportunity(ctx, params.id, safe);
    return applyFieldSecurity(ctx, 'OPPORTUNITY', rules, opportunity);
  },
);

export const DELETE = route(
  { module: 'opportunities', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await deleteOpportunity(ctx, params.id);
    return { ok: true };
  },
);
