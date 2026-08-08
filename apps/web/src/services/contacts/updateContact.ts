import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';
import { emit } from '../shared/events';
import { normalizePhone } from '../leads/normalizePhone';

export interface UpdateContactInput {
  fullName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  accountId?: string | null;
  ownerId?: string | null;
  tags?: string[];
  [k: string]: unknown;
}

export async function updateContact(ctx: Ctx, id: string, input: UpdateContactInput) {
  const updated = await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.contact.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Contact');
    await assertRecordVisible(ctx, 'contacts', before, tx, 'EDIT');

    const after = await tx.contact.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
        ...(input.email !== undefined && { email: input.email.toLowerCase() }),
        ...(input.phone !== undefined && { phone: input.phone, phoneNormalized: normalizePhone(input.phone, 'AE') }),
        ...(input.accountId !== undefined && { accountId: input.accountId }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.tags !== undefined && { tags: input.tags }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'contact', id, before, after, tx);
    return after;
  });

  emit(ctx, 'contact.updated', { contactId: id });
  return updated;
}

export async function deleteContact(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.contact.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Contact');
    await assertRecordVisible(ctx, 'contacts', before, tx, 'DELETE');
    await tx.contact.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'contact', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}
