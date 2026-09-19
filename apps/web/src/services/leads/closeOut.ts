import { withTx } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Closing a lead out without deleting it.
 *
 * Permanent removal stays behind `leads:DELETE`, which only administrators hold.
 * Everyone who can edit a lead can instead say why it is no longer worth working —
 * invalid, a duplicate of another record, or simply archived — and the lead leaves
 * every working list while keeping its history for the administrator who decides
 * whether it is deleted. `OPEN` reverses any of them.
 */
export const CLOSE_OUT_STATUSES = ['INVALID', 'DUPLICATE', 'ARCHIVED'] as const;
export type CloseOutStatus = (typeof CLOSE_OUT_STATUSES)[number];

/** Rows still being worked: `status` is null for every lead created before this existed. */
export const OPEN_LEADS_WHERE = { OR: [{ status: null }, { status: { notIn: [...CLOSE_OUT_STATUSES] } }] };
export const CLOSED_OUT_WHERE = { status: { in: [...CLOSE_OUT_STATUSES] } };

export async function closeOutLead(
  ctx: Ctx,
  id: string,
  input: { status: CloseOutStatus | 'OPEN'; duplicateOfId?: string | null },
) {
  return withTx(ctx.tenantId, async (tx) => {
    const before = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Lead');
    await assertRecordVisible(ctx, 'leads', before, tx, 'EDIT');

    let duplicateOfId: string | null = null;
    if (input.status === 'DUPLICATE' && input.duplicateOfId) {
      if (input.duplicateOfId === id)
        throw Invalid([{ field: 'duplicateOfId', code: 'self', message: 'A lead cannot duplicate itself.' }]);
      const other = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, id: input.duplicateOfId },
        select: { id: true },
      });
      if (!other) throw NotFound('Lead');
      duplicateOfId = other.id;
    }

    const after = await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: { status: input.status === 'OPEN' ? null : input.status, duplicateOfId, updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'lead', id, before, after, tx);
    return after;
  });
}
