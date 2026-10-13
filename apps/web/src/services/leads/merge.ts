import type { Prisma } from '@prisma/client';
import { withTx, type TxClient } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { audit, auditDiff } from '@/lib/security/audit';
import { assertLeadInScope } from '@/lib/security/record-scope';
import type { Ctx } from '@/lib/security/rbac';
import { withRecompute } from './nextFollowUp';

/** The values the compare screen offers, each taken from either lead (M4-31). */
export const MERGE_FIELDS = [
  'fullName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'city',
  'country',
  'nationality',
  'campaignName',
  'notes',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** Further columns the kept lead takes from the other only where it has none: never asked, never lost. */
const FILL = [
  'secondaryEmail',
  'secondaryPhone',
  'whatsappNumber',
  'industry',
  'state',
  'postalCode',
  'addressLine',
  'sourceId',
  'campaignId',
  'accountId',
  'productInterestId',
] as const;

/** Every record naming a lead, by model and column: each moves to the kept lead as it is. */
const NAMED_BY: readonly (readonly [string, string])[] = [
  ...[
    'activity',
    'task',
    'followUpTask',
    'document',
    'leadStageHistory',
    'leadAssignmentHistory',
    'leadScoreHistory',
    'call',
    'communication',
    'conversation',
    'clientRequirement',
    'clientProfile',
    'siteVisit',
    'booking',
    'opportunity',
    'ticket',
    'formSubmission',
    'campaignContact',
    'proposal',
    'testimonial',
    'referralCode',
    'detectedRequirement',
    'unitInventory',
    'fieldVisit',
  ].map((model) => [model, 'leadId'] as const),
  ['referral', 'referredLeadId'],
  ['referral', 'referrerLeadId'],
  ['dataRecord', 'convertedLeadId'],
  ['socialComment', 'linkedLeadId'],
];

/**
 * Records a lead holds once per something: each moves unless the kept lead
 * holds that one already, in which case the other's copy stays with it.
 */
const ONCE_PER = {
  leadPhone: 'normalized',
  leadProject: 'projectId',
  leadListing: 'listingId',
  eventInvitee: 'eventId',
  leadCustomFieldValue: 'definitionId',
} as const;

type Delegate = {
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  findMany(args: { where: object; select: object }): Promise<Record<string, unknown>[]>;
};
const model = (tx: TxClient, name: string) => (tx as unknown as Record<string, Delegate>)[name]!;

const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * Merge two leads into one (M4-31), in one transaction. Everything the other
 * lead holds moves to the kept one: its timeline, numbers (each once), tasks
 * and follow-ups, documents, stage and assignment history, calls, messages,
 * requirements, interests and custom values. The kept lead takes the values
 * named in `take`, fills its own gaps from the other, keeps its stage and
 * owner, takes the higher score, and its next follow-up is worked out again.
 *
 * The other lead is not deleted outright: it stays, merged (`isMerged`,
 * `duplicateOfId`) and out of every list (`deletedAt`), so its reference and
 * its page still lead to the kept one. Both leads must be in the caller's EDIT
 * scope (404 otherwise), and both are audited.
 */
export async function mergeLeads(ctx: Ctx, keptId: string, otherId: string, take: readonly MergeField[]) {
  if (keptId === otherId) {
    throw Invalid([{ field: 'otherId', code: 'self', message: 'A lead cannot be merged into itself.' }]);
  }
  const t = ctx.tenantId;
  return withTx(t, (tx) =>
    // Both locked first, in id order; both next follow-ups worked out again after.
    withRecompute(tx, t, [keptId, otherId], async () => {
      const kept = await assertLeadInScope(ctx, keptId, tx, 'EDIT');
      const other = await assertLeadInScope(ctx, otherId, tx, 'EDIT');

      const patch: Record<string, unknown> = {};
      for (const field of take) if (other[field] != null && other[field] !== '') patch[field] = other[field];
      if (patch.phone !== undefined) {
        Object.assign(patch, { phoneNormalized: other.phoneNormalized, phoneIsWhatsapp: other.phoneIsWhatsapp });
      }
      for (const field of FILL) if (kept[field] == null && other[field] != null) patch[field] = other[field];
      const main = patch.phone !== undefined ? other : kept;
      const replaced = main === kept ? other : kept;

      let moved = 0;
      for (const [name, column] of NAMED_BY) {
        moved += (
          await model(tx, name).updateMany({ where: { tenantId: t, [column]: other.id }, data: { [column]: kept.id } })
        ).count;
      }
      for (const [name, key] of Object.entries(ONCE_PER)) {
        const held = (
          await model(tx, name).findMany({ where: { tenantId: t, leadId: kept.id }, select: { [key]: true } })
        ).map((row) => row[key]);
        if (name === 'leadPhone' && main.phoneNormalized) held.push(main.phoneNormalized);
        moved += (
          await model(tx, name).updateMany({
            where: { tenantId: t, leadId: other.id, [key]: { notIn: held } },
            data: { leadId: kept.id },
          })
        ).count;
      }
      // The main number that is no longer one becomes another number, unless the
      // kept lead has it; the new main number is not also an other number.
      if (main.phoneNormalized) {
        await tx.leadPhone.deleteMany({ where: { tenantId: t, leadId: kept.id, normalized: main.phoneNormalized } });
      }
      const spare = replaced.phoneNormalized;
      if (
        spare &&
        spare !== main.phoneNormalized &&
        !(await tx.leadPhone.findFirst({ where: { tenantId: t, leadId: kept.id, normalized: spare } }))
      ) {
        await tx.leadPhone.create({
          data: {
            tenantId: t,
            leadId: kept.id,
            raw: replaced.phone ?? spare,
            normalized: spare,
            label: `Main number of ${replaced.reference}`,
            isWhatsapp: replaced.phoneIsWhatsapp,
          },
        });
      }

      const score = Math.max(kept.score, other.score);
      const after = await tx.lead.update({
        where: { tenantId: t, id: kept.id },
        data: {
          ...(patch as Prisma.LeadUncheckedUpdateInput),
          tags: [...new Set([...kept.tags, ...other.tags])],
          // Its own values win; the other's fill the fields it has none for.
          customData: {
            ...(other.customData as Record<string, unknown>),
            ...(kept.customData as Record<string, unknown>),
          } as Prisma.InputJsonValue,
          score,
          lastActivityAt: latest(kept.lastActivityAt, other.lastActivityAt),
          firstContactedAt: earliest(kept.firstContactedAt, other.firstContactedAt),
          updatedById: ctx.actor.id,
        },
      });
      if (score !== kept.score) {
        await tx.leadScoreHistory.create({
          data: {
            tenantId: t,
            leadId: kept.id,
            delta: score - kept.score,
            scoreAfter: score,
            reason: `Merged with ${other.reference}`,
          },
        });
      }
      const merged = await tx.lead.update({
        where: { tenantId: t, id: other.id },
        data: { isMerged: true, duplicateOfId: kept.id, deletedAt: new Date(), updatedById: ctx.actor.id },
      });
      // A lead marked a duplicate of the other, or merged into it before, now names the kept one.
      await tx.lead.updateMany({ where: { tenantId: t, duplicateOfId: other.id }, data: { duplicateOfId: kept.id } });

      await audit(
        ctx,
        {
          event: 'RECORD_UPDATED',
          objectType: 'lead',
          recordId: kept.id,
          fieldKey: 'mergedFrom',
          newValue: { id: other.id, reference: other.reference },
          metadata: { moved, took: take },
        },
        tx,
      );
      await auditDiff(ctx, 'lead', kept.id, kept, after, tx);
      await auditDiff(ctx, 'lead', other.id, other, merged, tx);
      return { id: kept.id, reference: kept.reference, merged: other.reference, moved };
    }),
  );
}
