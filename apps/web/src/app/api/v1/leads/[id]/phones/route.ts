import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, Invalid } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import type { Ctx } from '@/lib/security/rbac';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';

/**
 * A lead's other numbers (LeadPhone), governed like `phone` itself: whoever may
 * edit the lead and see and edit its phone field may add or remove one — a role
 * that sees the numbers masked (no `leads:VIEW_SENSITIVE_FIELDS`) may not. A
 * number the lead already has answers 409 from the unique index.
 */
const params = z.object({ id: z.string().cuid() });

/**
 * Outside the transaction, deliberately: the global client inside `withTx` runs
 * on another pooled connection with no tenant set, where row-level security
 * returns no rules at all — and no rule reads as "allowed".
 *
 * A lead outside the caller's scope answers 404 first, exactly like a missing
 * one; the role's refusal is for a lead they can reach.
 */
async function assertMayEditPhones(ctx: Ctx, leadId: string) {
  const rules = await loadFieldRules(ctx, 'LEAD');
  const editable = rules.get('phone')?.canEdit ?? true;
  if (seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS) && editable) return;
  await assertLeadInScope(ctx, leadId, prisma, 'EDIT');
  throw Forbidden('Your role cannot change this lead’s phone numbers.');
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
    await assertMayEditPhones(ctx, params.id);
    return withTx(ctx.tenantId, async (tx) => {
      const lead = await assertLeadInScope(ctx, params.id, tx, 'EDIT');
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
    await assertMayEditPhones(ctx, params.id);
    await withTx(ctx.tenantId, async (tx) => {
      await assertLeadInScope(ctx, params.id, tx, 'EDIT');
      await tx.leadPhone.delete({ where: { id: query.phoneId, leadId: params.id, tenantId: ctx.tenantId } });
    });
    return { ok: true };
  },
);
