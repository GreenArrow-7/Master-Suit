import type { Prisma } from '@prisma/client';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { Forbidden, Invalid, NotFound } from '@/lib/errors';
import { audit, auditDiff } from '@/lib/security/audit';
import { assertAssignableUser, assertLeadInScope, leadScope } from '@/lib/security/record-scope';
import { can, type Ctx } from '@/lib/security/rbac';
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
  updateManyAndReturn(args: { where: object; data: object; select: object }): Promise<Record<string, unknown>[]>;
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
 * scope (404 otherwise) and mergeable by them (`assertMayMerge`), and both are
 * audited, the kept lead's row naming every record that moved.
 *
 * `writable`: a column this role may write and sees whole (the route's field
 * rules). Any other stays the kept lead's, whether chosen or a gap to fill.
 */
export async function mergeLeads(
  ctx: Ctx,
  keptId: string,
  otherId: string,
  take: readonly MergeField[],
  writable: (field: string) => boolean = () => true,
) {
  if (keptId === otherId) {
    throw Invalid([{ field: 'otherId', code: 'self', message: 'A lead cannot be merged into itself.' }]);
  }
  const t = ctx.tenantId;
  return withTx(
    t,
    (tx) =>
      // Both locked first, in id order; both next follow-ups worked out again after.
      withRecompute(tx, t, [keptId, otherId], async () => {
        const kept = await assertLeadInScope(ctx, keptId, tx, 'EDIT');
        const other = await assertLeadInScope(ctx, otherId, tx, 'EDIT');
        await assertMayMerge(ctx, tx, kept, other);

        const took = take.filter(writable);
        const patch: Record<string, unknown> = {};
        for (const field of took) if (other[field] != null && other[field] !== '') patch[field] = other[field];
        if (patch.phone !== undefined) {
          Object.assign(patch, { phoneNormalized: other.phoneNormalized, phoneIsWhatsapp: other.phoneIsWhatsapp });
        }
        for (const field of FILL) {
          if (writable(field) && kept[field] == null && other[field] != null) patch[field] = other[field];
        }
        const main = patch.phone !== undefined ? other : kept;
        const replaced = main === kept ? other : kept;

        /** What moved, by model: ids (a once-per record, its key), for the audit. */
        const moved: Record<string, unknown[]> = {};
        const move = async (name: string, where: object, data: object, key = 'id') => {
          const rows = await model(tx, name).updateManyAndReturn({
            where: { tenantId: t, ...where },
            data,
            select: { [key]: true },
          });
          if (rows.length) (moved[name] ??= []).push(...rows.map((row) => row[key]));
        };
        for (const [name, column] of NAMED_BY) await move(name, { [column]: other.id }, { [column]: kept.id });
        for (const [name, key] of Object.entries(ONCE_PER)) {
          const held = (
            await model(tx, name).findMany({ where: { tenantId: t, leadId: kept.id }, select: { [key]: true } })
          ).map((row) => row[key]);
          if (name === 'leadPhone' && main.phoneNormalized) held.push(main.phoneNormalized);
          await move(name, { leadId: other.id, [key]: { notIn: held } }, { leadId: kept.id }, key);
        }
        // One live client profile per lead, and one live referral naming a lead as
        // the one referred (partial unique indexes, 20260809020000_client_profiling):
        // the other's move only where the kept lead has none. A referral between
        // the two would have the kept lead refer itself, so it stays behind too.
        const live = { tenantId: t, deletedAt: null };
        const profiled = await tx.clientProfile.count({ where: { ...live, leadId: kept.id } });
        await move(
          'clientProfile',
          { leadId: other.id, ...(profiled ? { deletedAt: { not: null } } : {}) },
          {
            leadId: kept.id,
          },
        );
        const referred = await tx.referral.count({ where: { ...live, referredLeadId: kept.id } });
        await move(
          'referral',
          {
            referredLeadId: other.id,
            OR: [{ referrerLeadId: null }, { referrerLeadId: { not: kept.id } }],
            ...(referred ? { deletedAt: { not: null } } : {}),
          },
          { referredLeadId: kept.id },
        );
        await move(
          'referral',
          { referrerLeadId: other.id, referredLeadId: { not: kept.id } },
          { referrerLeadId: kept.id },
        );
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
            // Closed out before as a duplicate of the other: not of itself now.
            ...(kept.duplicateOfId === other.id && { duplicateOfId: null }),
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
        const repointed = await tx.lead.updateManyAndReturn({
          where: { tenantId: t, duplicateOfId: other.id, NOT: { id: kept.id } },
          data: { duplicateOfId: kept.id },
          select: { id: true },
        });

        await audit(
          ctx,
          {
            event: 'RECORD_UPDATED',
            objectType: 'lead',
            recordId: kept.id,
            fieldKey: 'mergedFrom',
            newValue: { id: other.id, reference: other.reference },
            metadata: { moved, took, repointed: repointed.map((row) => row.id) },
          },
          tx,
        );
        await auditDiff(ctx, 'lead', kept.id, kept, after, tx);
        await auditDiff(ctx, 'lead', other.id, other, merged, tx);
        const count = Object.values(moved).reduce((n, ids) => n + ids.length, 0);
        return { id: kept.id, reference: kept.reference, merged: other.reference, moved: count };
      }),
    // Some forty statements: past Prisma's 5 s on a busy database, so more room for a rare, deliberate act.
    { timeout: 30_000 },
  );
}

/**
 * Whether this caller may merge these two, as the lead page would let them
 * make the same change (both the route and the compare screen ask). A lead with
 * no owner only for someone who may claim it (`leadScope`'s `includeUnassigned`,
 * the duplicate notice's rule): 404 otherwise, as for a lead out of reach. Two
 * leads different people own: the other's person passes to the kept lead's
 * owner, which needs what that owner change needs on the lead page
 * (`updateLead`): ASSIGN or REASSIGN, reaching that owner. 403 without either.
 */
export async function assertMayMerge(
  ctx: Ctx,
  db: TxClient | typeof prisma,
  kept: { id: string; ownerId: string | null },
  other: { id: string; ownerId: string | null },
) {
  if (kept.ownerId == null || other.ownerId == null) {
    const reach = await db.lead.count({
      where: {
        ...(await leadScope(ctx, 'EDIT', { includeUnassigned: true, db })),
        id: { in: [kept.id, other.id] },
      },
    });
    if (reach < 2) throw NotFound('Lead');
  }
  if (kept.ownerId === other.ownerId) return;
  const action = can(ctx, 'leads', 'ASSIGN') ? 'ASSIGN' : can(ctx, 'leads', 'REASSIGN') ? 'REASSIGN' : null;
  if (!action) {
    throw Forbidden(
      'Your role cannot merge leads that different people own: the merge hands one to the other’s owner.',
    );
  }
  if (kept.ownerId) await assertAssignableUser(ctx, db, 'leads', action, kept.ownerId);
}
