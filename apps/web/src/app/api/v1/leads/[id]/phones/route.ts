import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { loadFieldRules } from '@/lib/security/fieldSecurity';
import type { Ctx } from '@/lib/security/rbac';
import { assertRecordVisible } from '@/lib/security/visibility';
import { normalizePhone } from '@/services/leads/normalizePhone';

/**
 * A lead's other numbers (LeadPhone), governed like `phone` itself: whoever may
 * edit the lead and its phone field may add or remove one. A number the lead
 * already has answers 409 from the unique index.
 */
const params = z.object({ id: z.string().cuid() });

/**
 * Outside the transaction, deliberately: the global client inside `withTx` runs
 * on another pooled connection with no tenant set, where row-level security
 * returns no rules at all — and no rule reads as "allowed".
 */
async function assertMayEditPhones(ctx: Ctx) {
  const rule = (await loadFieldRules(ctx, 'LEAD')).get('phone');
  if (rule && !(rule.canView && rule.canEdit)) throw Forbidden('Your role cannot change this lead’s phone numbers.');
}

async function editableLead(ctx: Ctx, tx: TxClient, id: string) {
  const lead = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id } });
  if (!lead) throw NotFound('Lead');
  await assertRecordVisible(ctx, 'leads', lead, tx, 'EDIT');
  return lead;
}

export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: z
      .object({
        phone: z.string().trim().min(6).max(32),
        label: z.string().trim().max(40).optional(),
        isWhatsapp: z.boolean().default(false),
      })
      .strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const normalized = normalizePhone(body.phone);
    if (!normalized) throw Invalid([{ field: 'phone', code: 'invalid', message: 'Enter a phone number.' }]);
    await assertMayEditPhones(ctx);
    return withTx(ctx.tenantId, async (tx) => {
      const lead = await editableLead(ctx, tx, params.id);
      if (lead.phoneNormalized === normalized) throw Conflict('That is already this lead’s main number.');
      return tx.leadPhone.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          raw: body.phone,
          normalized,
          label: body.label || null,
          isWhatsapp: body.isWhatsapp,
        },
        select: { id: true, raw: true, label: true, isWhatsapp: true },
      });
    });
  },
);

export const DELETE = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    query: z.object({ phoneId: z.string().cuid() }),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, query }) => {
    await assertMayEditPhones(ctx);
    await withTx(ctx.tenantId, async (tx) => {
      await editableLead(ctx, tx, params.id);
      await tx.leadPhone.delete({ where: { id: query.phoneId, leadId: params.id, tenantId: ctx.tenantId } });
    });
    return { ok: true };
  },
);
