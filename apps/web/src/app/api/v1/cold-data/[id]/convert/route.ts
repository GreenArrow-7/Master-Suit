import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { visibilityWhere } from '@/lib/security/visibility';
import { coldDataScope } from '@/services/leads/coldData';
import { takeEnquiry } from '@/services/leads/intake';

/**
 * A worked cold record becomes a lead, through the same intake as an enquiry:
 * somebody already in the pipeline — they were on a bought list and also
 * enquired last month — gets this as a fresh touch on their lead rather than a
 * second lead and a second agent. The record stays, marked converted, so the
 * list's conversion rate is still answerable.
 */
export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'CREATE',
    params: z.object({ id: z.string().cuid() }),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params }) => {
    const record = await prisma.dataRecord.findFirst({
      where: { ...coldDataScope(ctx), id: params.id, convertedLeadId: null },
    });
    if (!record) throw NotFound('Record');

    const result = await takeEnquiry(
      ctx.tenantId,
      {
        fullName: record.fullName,
        email: record.email?.toLowerCase() ?? null,
        phones: record.phone ? [record.phone] : [],
        message: record.notes,
        reference: null,
        details: [record.company, record.jobTitle, record.city].filter((v): v is string => !!v),
      },
      {
        label: `cold data, ${record.batch}`,
        source: 'IMPORT',
        sourceDetail: `data:${record.batch}`.slice(0, 200),
        // The agent who worked it keeps it.
        ownerId: record.ownerId ?? ctx.actor.id,
      },
    );
    if (!result || !('leadId' in result)) throw NotFound('Record');

    await prisma.dataRecord.update({
      where: { tenantId: ctx.tenantId, id: record.id },
      data: { status: 'CONVERTED', convertedLeadId: result.leadId, convertedAt: new Date() },
    });
    // The match may be another agent's lead; the touch and the owner's bell still
    // happen (intake.ts), but the screen must not open a 404. Same rule as the
    // lead page, so the flag can never disagree with it.
    const visible = !!(await prisma.lead.findFirst({
      where: { ...(await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true })), id: result.leadId },
      select: { id: true },
    }));
    return { ...result, visible };
  },
);
