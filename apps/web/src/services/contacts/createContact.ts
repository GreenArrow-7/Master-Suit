import { withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { nextReference } from '../shared/reference';
import { emit } from '../shared/events';
import { normalizePhone } from '../leads/normalizePhone';
import type { Ctx } from '@/lib/security/rbac';

export interface CreateContactInput {
  fullName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  accountId?: string;
  ownerId?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

export async function createContact(ctx: Ctx, input: CreateContactInput) {
  const phoneNormalized = input.phone ? normalizePhone(input.phone, 'AE') : null;

  const contact = await withTx(ctx.tenantId, async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'CONTACT');
    const ownerId = input.ownerId ?? ctx.actor.id;

    const created = await tx.contact.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        fullName: input.fullName,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        jobTitle: input.jobTitle ?? null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone ?? null,
        phoneNormalized,
        accountId: input.accountId ?? null,
        ownerId,
        tags: input.tags ?? [],
        customData: (input.custom ?? {}) as any,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'contact', recordId: created.id, newValue: { reference } },
      tx,
    );
    return created;
  });

  emit(ctx, 'contact.created', { contactId: contact.id });
  return contact;
}
