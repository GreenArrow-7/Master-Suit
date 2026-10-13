import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { leadScope } from '@/lib/security/record-scope';
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
    // Audited by the intake, as this person, naming the lead it made or touched.
  },
  async ({ ctx, params }) => {
    // A record the caller may work (the lead rule at EDIT); outside it, not found.
    const record = await prisma.dataRecord.findFirst({
      where: { ...(await coldDataScope(ctx, 'EDIT')), id: params.id, convertedLeadId: null },
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
        actor: ctx,
      },
    );
    if (!result || !('leadId' in result)) throw NotFound('Record');

    const { leadId } = result;
    await withTx(ctx.tenantId, async (tx) => {
      await tx.dataRecord.update({
        where: { tenantId: ctx.tenantId, id: record.id },
        data: { status: 'CONVERTED', convertedLeadId: leadId, convertedAt: new Date() },
      });
      // Its calls (M5-06) become the lead's history, re-pointed, not copied; they
      // were the work, so the lead is not "handed over and untouched" at check-out.
      const { count } = await tx.activity.updateMany({
        where: { tenantId: ctx.tenantId, dataRecordId: record.id },
        data: { leadId },
      });
      if (count === 0) return;
      await tx.lead.updateMany({ where: { tenantId: ctx.tenantId, id: leadId }, data: { lastActivityAt: new Date() } });
      // The first of those calls is when the lead was first contacted, as touchLead keeps it.
      const { _min } = await tx.activity.aggregate({
        where: { tenantId: ctx.tenantId, dataRecordId: record.id },
        _min: { occurredAt: true },
      });
      const first = _min.occurredAt!;
      await tx.lead.updateMany({
        where: {
          tenantId: ctx.tenantId,
          id: leadId,
          OR: [{ firstContactedAt: null }, { firstContactedAt: { gt: first } }],
        },
        data: { firstContactedAt: first },
      });
      await audit(
        ctx,
        {
          event: 'RECORD_UPDATED',
          objectType: 'lead',
          recordId: leadId,
          metadata: { action: 'lead.cold_calls_attached', dataRecordId: record.id, calls: count },
        },
        tx,
      );
    });
    // The match may be another agent's lead; the touch and the owner's bell still
    // happen (intake.ts), but the screen must not open a 404. Same rule as the
    // lead page, so the flag can never disagree with it.
    const visible = !!(await prisma.lead.findFirst({
      where: { ...(await leadScope(ctx, 'VIEW', { includeUnassigned: true })), id: leadId },
      select: { id: true },
    }));
    return { ...result, visible };
  },
);
