import type { ClientRequirement } from '@prisma/client';
import { prisma, type TxClient } from '@/lib/db';
import { audit, type SystemActor } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import type { RequirementDraft } from '@/lib/integrations/leadSources';
import { todayKey } from '../targets/dailyBoard';

type Db = TxClient | typeof prisma;

/**
 * A lead's requirement (Lead Eagle audit rows M4-05, M4-08): the open search
 * on its page, which the Overview's composer edits and intake writes. A closed
 * or fulfilled one stays as the record of what they wanted, and a new one
 * starts beside it.
 */
export function openRequirement(db: Db, tenantId: string, leadId: string) {
  return db.clientRequirement.findFirst({
    where: { tenantId, leadId, deletedAt: null, status: { in: ['OPEN', 'MATCHED'] } },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Intake's requirement (M6-29): what an enquiry said it wants, written beside
 * the enquiry unless the lead already has an open search, which a person may
 * have refined since.
 */
export async function takeRequirement(
  tx: TxClient,
  by: Ctx | SystemActor,
  leadId: string,
  draft: RequirementDraft | null | undefined,
  ownerId: string | null,
) {
  if (!draft || (await openRequirement(tx, by.tenantId, leadId))) return null;
  const created = await tx.clientRequirement.create({ data: { tenantId: by.tenantId, leadId, ownerId, ...draft } });
  await audit(
    by,
    { event: 'RECORD_CREATED', objectType: 'requirement', recordId: created.id, metadata: { leadId } },
    tx,
  );
  return created;
}

/** The requirement as the lead page's composer reads it: the possession date as the workspace's calendar day. */
export function requirementForPage(requirement: ClientRequirement | null, timeZone: string) {
  if (!requirement) return null;
  return {
    id: requirement.id,
    purpose: requirement.purpose,
    propertyTypes: requirement.propertyTypes as string[],
    subType: requirement.subType,
    bedroomsMin: requirement.bedroomsMin,
    bedroomsMax: requirement.bedroomsMax,
    budgetMin: requirement.budgetMin?.toNumber() ?? null,
    budgetMax: requirement.budgetMax?.toNumber() ?? null,
    currency: requirement.currency,
    locations: requirement.locations,
    possessionBy: requirement.possessionBy ? todayKey(timeZone, requirement.possessionBy) : null,
    notes: requirement.notes,
  };
}

export type LeadRequirement = NonNullable<ReturnType<typeof requirementForPage>>;
