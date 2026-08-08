import { withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { nextReference } from '../shared/reference';
import { emit } from '../shared/events';
import type { Ctx } from '@/lib/security/rbac';

export interface CreateAccountInput {
  name: string;
  accountType?: string;
  industry?: string;
  parentAccountId?: string;
  website?: string;
  mainPhone?: string;
  mainEmail?: string;
  ownerId?: string;
  customerTier?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

export async function createAccount(ctx: Ctx, input: CreateAccountInput) {
  const account = await withTx(ctx.tenantId, async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'ACCOUNT');
    const ownerId = input.ownerId ?? ctx.actor.id;

    const created = await tx.account.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        name: input.name,
        accountType: input.accountType ?? null,
        industry: input.industry ?? null,
        parentAccountId: input.parentAccountId ?? null,
        website: input.website ?? null,
        mainPhone: input.mainPhone ?? null,
        mainEmail: input.mainEmail?.toLowerCase() ?? null,
        ownerId,
        customerTier: input.customerTier ?? null,
        tags: input.tags ?? [],
        customData: (input.custom ?? {}) as any,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'account', recordId: created.id, newValue: { reference } },
      tx,
    );
    return created;
  });

  emit(ctx, 'account.created', { accountId: account.id });
  return account;
}
