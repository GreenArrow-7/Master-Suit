import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';
import { emit } from '../shared/events';

export interface UpdateAccountInput {
  name?: string;
  accountType?: string;
  industry?: string;
  website?: string;
  mainPhone?: string;
  mainEmail?: string;
  ownerId?: string | null;
  customerTier?: string;
  status?: string;
  tags?: string[];
  [k: string]: unknown;
}

export async function updateAccount(ctx: Ctx, id: string, input: UpdateAccountInput) {
  const updated = await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.account.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Account');
    await assertRecordVisible(ctx, 'accounts', before, tx, 'EDIT');

    const after = await tx.account.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.accountType !== undefined && { accountType: input.accountType }),
        ...(input.industry !== undefined && { industry: input.industry }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.mainPhone !== undefined && { mainPhone: input.mainPhone }),
        ...(input.mainEmail !== undefined && { mainEmail: input.mainEmail.toLowerCase() }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.customerTier !== undefined && { customerTier: input.customerTier }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.tags !== undefined && { tags: input.tags }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'account', id, before, after, tx);
    return after;
  });

  emit(ctx, 'account.updated', { accountId: id });
  return updated;
}

export async function deleteAccount(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.account.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Account');
    await assertRecordVisible(ctx, 'accounts', before, tx, 'DELETE');
    await tx.account.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'account', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}
