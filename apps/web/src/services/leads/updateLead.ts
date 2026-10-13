import type { Prisma } from '@prisma/client';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { AppError, Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit, auditDiff } from '@/lib/security/audit';
import { assertAssignableUser, assertLeadInScope } from '@/lib/security/record-scope';
import { can, type Ctx } from '@/lib/security/rbac';
import { enqueue } from '@/lib/queue';
import { notifyCrm } from '../crm/notify';
import { recordTargetProgress } from '../targets/progress';
import { dayBounds } from '../targets/dailyBoard';
import { BOOKING_FIELDS } from '@/lib/leads/stageBookings';
import { lockLeads, withRecompute } from './nextFollowUp';
import { findDuplicates } from './findDuplicates';
import { assertLeadSource } from './leadSources';
import { withCustomValues } from './customFields';
import { normalizePhone } from './normalizePhone';

export interface UpdateLeadInput {
  fullName?: string;
  email?: string;
  phone?: string;
  /** The main number is on WhatsApp. */
  phoneIsWhatsapp?: boolean;
  company?: string;
  jobTitle?: string;
  country?: string;
  city?: string;
  nationality?: string | null;
  /** A catalogue entry (LeadSource) of this workspace. */
  sourceId?: string | null;
  campaignName?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  /** Tags to add to the ones the lead has (the grid's bulk Add tag, M4-35). */
  addTags?: string[];
  stageId?: string;
  /** Why it moves: required when the target stage says so. */
  stageReason?: string;
  /** What the target stage books (lib/leads/stageBookings.ts): its time, and a visit's project. */
  visitAt?: string;
  projectId?: string;
  meetingAt?: string;
  ownerId?: string | null;
  /** A second person who works the lead; named under the same scope as the owner. */
  secondaryOwnerId?: string | null;
  /** Custom field values by key (M4-13); null or '' clears one. */
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Same visibility-then-mutate shape as every write in the platform: load the row
 * inside the transaction, re-check visibility there (a list-only check is an IDOR),
 * diff for the audit log, then hand off owner/stage side effects to the queues.
 */
export async function updateLead(ctx: Ctx, id: string, input: UpdateLeadInput) {
  if (!can(ctx, 'leads', 'ASSIGN') && !can(ctx, 'leads', 'REASSIGN')) {
    delete input.ownerId;
    delete input.secondaryOwnerId;
  }
  if (input.sourceId) await assertLeadSource(prisma, ctx.tenantId, input.sourceId);
  await refuseDuplicate(ctx, id, input);

  /**
   * What actually changed, carried out of the transaction so the notifications
   * can be written after it commits.
   *
   * Only these two are announced. "Lead updates" in the abstract includes fixing
   * a typo in a job title, and a bell that fires on every field edit is one
   * people learn to ignore — which would cost the stage and owner changes their
   * audience too. The audit log already records every field; this is for the two
   * events that change who is responsible and what happens next.
   */
  let stageChangedTo: string | null = null;
  /** Set only when the stage changes: the new stage's reason, or null. */
  let enteredReason: string | null | undefined;
  let stageChangedKey: string | null = null;
  let stageChangedCategory: string | null = null;
  let previousOwnerId: string | null = null;
  let ownerChanged = false;

  const updated = await withTx(ctx.tenantId, async (tx) => {
    // Tags are added to the row as it stands: locked first, so two adds at once both land.
    if (input.addTags) await lockLeads(tx, ctx.tenantId, [id]);
    const before = await assertLeadInScope(ctx, id, tx, 'EDIT');
    // The new owner: someone the scope of the action that allows the change reaches.
    const action = can(ctx, 'leads', 'ASSIGN') ? 'ASSIGN' : 'REASSIGN';
    if (input.ownerId && input.ownerId !== before.ownerId) {
      await assertAssignableUser(ctx, tx, 'leads', action, input.ownerId);
    }
    // One person is never both: naming the owner is refused, and the second owner made owner ends that role.
    const owner = input.ownerId !== undefined ? input.ownerId : before.ownerId;
    if (input.secondaryOwnerId && input.secondaryOwnerId === owner) {
      refuse('secondaryOwnerId', 'The second owner must be someone other than the owner.');
    }
    if (input.secondaryOwnerId === undefined && owner && before.secondaryOwnerId === owner) {
      input.secondaryOwnerId = null;
    }
    if (input.secondaryOwnerId && input.secondaryOwnerId !== before.secondaryOwnerId) {
      await assertAssignableUser(ctx, tx, 'leads', action, input.secondaryOwnerId);
    }

    // Added to the row as it stands, so a stale list on the screen removes nothing.
    const tags = input.addTags ? [...new Set([...(input.tags ?? before.tags), ...input.addTags])] : input.tags;
    if (tags && tags.length > 20) refuse('tags', 'A lead holds at most 20 tags.');

    // Each one a field of this workspace, checked by its type, after the scope
    // check above and before the stage's requirements below.
    const customData = input.custom
      ? await withCustomValues(tx, ctx.tenantId, id, before.customData, input.custom)
      : undefined;

    // Only a move into a stage books (below): a visit or meeting sent with no
    // move, e.g. to the stage the lead is already in, would vanish without a word.
    const moving = !!input.stageId && input.stageId !== before.stageId;
    if (!moving && [...BOOKING_FIELDS, 'projectId'].some((field) => input[field] !== undefined)) {
      refuse('stageId', 'The lead is already in this stage: book the visit or meeting from Site visits or Tasks.');
    }

    if (moving) {
      const stage = await tx.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: input.stageId } });
      if (!stage) throw NotFound('Lead stage');
      // A stage that claims something happened carries the evidence: its reason,
      // and the fields it names. Checked here, so every screen obeys it.
      const reason = input.stageReason?.trim() || null;
      if (stage.requiresReason && !reason) refuse('stageReason', `Moving a lead to ${stage.name} needs a reason.`);
      if (reason && stage.reasons.length && !stage.reasons.includes(reason)) {
        refuse('stageReason', `Choose one of ${stage.name}'s reasons: ${stage.reasons.join(', ')}.`);
      }
      const after = { ...before, ...input } as Record<string, unknown>;
      // A site visit is to somewhere: booking one names its project too.
      const needs = stage.requiredFields.includes('visitAt')
        ? [...stage.requiredFields, 'projectId']
        : stage.requiredFields;
      const missing = needs.filter((field) => !String(after[field] ?? '').trim());
      if (missing.length) refuse(missing[0]!, `${stage.name} needs: ${missing.join(', ')}.`);
      enteredReason = reason;
      stageChangedTo = stage.name;
      stageChangedKey = stage.key;
      stageChangedCategory = stage.category;
      await tx.leadStageHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: id,
          fromStageId: before.stageId,
          toStageId: stage.id,
          changedById: ctx.actor.id,
          reason,
        },
      });
      await book(ctx, tx, before, stage.requiredFields, input);
    }

    if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
      ownerChanged = true;
      previousOwnerId = before.ownerId;
      await tx.leadAssignmentHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: id,
          fromOwnerId: before.ownerId,
          toOwnerId: input.ownerId,
          assignedById: ctx.actor.id,
          reason: 'REASSIGNED',
        },
      });
    }

    const after = await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(customData && { customData: customData as Prisma.InputJsonValue }),
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.email !== undefined && { email: input.email.toLowerCase() }),
        // Both columns, as updateContact does: duplicate matching reads the
        // normalised one, and leaving it behind matched the old number forever.
        ...(input.phone !== undefined && { phone: input.phone, phoneNormalized: normalizePhone(input.phone) }),
        ...(input.phoneIsWhatsapp !== undefined && { phoneIsWhatsapp: input.phoneIsWhatsapp }),
        ...(input.company !== undefined && { company: input.company }),
        ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.nationality !== undefined && { nationality: input.nationality }),
        ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
        ...(input.campaignName !== undefined && { campaignName: input.campaignName }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(tags !== undefined && { tags }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.stageId !== undefined && { stageId: input.stageId }),
        ...(enteredReason !== undefined && { stageReason: enteredReason }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId, assignedAt: input.ownerId ? new Date() : null }),
        ...(input.secondaryOwnerId !== undefined && { secondaryOwnerId: input.secondaryOwnerId }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'lead', id, before, after, tx);
    return after;
  });

  await enqueue('automation', 'trigger', {
    tenantId: ctx.tenantId,
    event: 'record.updated',
    object: 'LEAD',
    recordId: id,
  });
  /**
   * Reassignment tells both ends. The new owner needs to know they have it; the
   * previous owner otherwise watches a record leave their list with no
   * explanation, which is the reassignment complaint every CRM eventually gets.
   */
  if (ownerChanged) {
    await notifyCrm(ctx, {
      event: 'lead.assigned',
      ownerId: updated.ownerId,
      alsoNotify: [previousOwnerId],
      title: `Lead assigned: ${updated.fullName}`,
      body: updated.reference,
      objectType: 'lead',
      recordId: id,
      priority: 'HIGH',
    });
  }

  /**
   * Target metrics ride the stage transition. LEADS_CONVERTED keys on the
   * stage's category — CONVERSION is the semantic "won" marker, tenant-safe.
   * LEADS_QUALIFIED has no category of its own, so it keys on the stage key
   * the seed and reference pipeline use; a workspace that renames the
   * qualified stage's key simply does not count that metric, which is the
   * honest behaviour until the schema grows a QUALIFIED category.
   */
  if (stageChangedCategory === 'CONVERSION') {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_CONVERTED');
  }
  if (stageChangedKey === 'qualified') {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_QUALIFIED');
  }
  if (ownerChanged && updated.ownerId) {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_ASSIGNED');
  }

  if (stageChangedTo) {
    await notifyCrm(ctx, {
      event: 'lead.stage_changed',
      ownerId: updated.ownerId,
      title: `${updated.fullName} moved to ${stageChangedTo}`,
      body: updated.reference,
      objectType: 'lead',
      recordId: id,
    });
  }

  return updated;
}

/** Soft delete: sets deletedAt rather than removing the row — every list query filters it out. */
export async function deleteLead(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const before = await assertLeadInScope(ctx, id, tx, 'DELETE');
    await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'lead', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}

/**
 * The grid's Undo of a delete (M4-36): the lead returns to every list it left.
 * Reached under the delete's own scope; a lead that is not deleted, or not
 * the caller's to delete, answers 404. One whose number or email another lead
 * took meanwhile answers 409, as creating it again would (`createLead`).
 */
export async function restoreLead(ctx: Ctx, id: string) {
  // Before the transaction, as `refuseDuplicate`: findDuplicates reads on its own connection.
  const deleted = await assertLeadInScope(ctx, id, prisma, 'DELETE', { deleted: true });
  const [match] = await findDuplicates(ctx.tenantId, {
    phoneNormalized: deleted.phoneNormalized,
    email: deleted.email,
    fullName: deleted.fullName,
    ignoreNameOnly: true,
    excludeId: id,
  });
  if (match) throw Conflict(`A lead with this ${match.matchedOn} was added since (${match.reference}).`);
  await withTx(ctx.tenantId, async (tx) => {
    const before = await assertLeadInScope(ctx, id, tx, 'DELETE', { deleted: true });
    await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: null, updatedById: ctx.actor.id },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_RESTORED',
        objectType: 'lead',
        recordId: id,
        fieldKey: 'deletedAt',
        previousValue: before.deletedAt,
        newValue: null,
      },
      tx,
    );
  });
  return { id, restored: true };
}

/**
 * The projects a stage's site visit may name, for the mini-form's picker: the
 * catalogue, to a role that reads it (as `GET /projects`). `book` holds a
 * request to the same rule. None where no stage books a visit: nothing asks.
 */
export async function bookableProjects(ctx: Ctx, stages: { requiredFields: string[] }[]) {
  if (!can(ctx, 'projects', 'VIEW') || !stages.some((stage) => stage.requiredFields.includes('visitAt'))) return [];
  // ponytail: the first 500 by name; a search picker when a catalogue outgrows it.
  return prisma.project.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
}

/**
 * What the stage books as the lead enters it (M4-18): a site visit to a project
 * of the caller's catalogue, a meeting task, or both — written and audited in
 * the transaction that moves the stage, so a failure here leaves the lead where
 * it was. Both are the caller's, as when booked from the Visits or Tasks screen.
 */
async function book(
  ctx: Ctx,
  tx: TxClient,
  lead: { id: string; fullName: string },
  fields: string[],
  input: UpdateLeadInput,
) {
  const visit = fields.includes('visitAt');
  const meeting = fields.includes('meetingAt');
  if (!visit && !meeting) return;
  const { timezone } = await tx.tenant.findFirstOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });

  if (visit) {
    if (!can(ctx, 'visits', 'CREATE')) throw Forbidden('Your role cannot book a site visit.');
    const project = can(ctx, 'projects', 'VIEW')
      ? await tx.project.findFirst({
          where: { tenantId: ctx.tenantId, id: String(input.projectId), deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!project) throw NotFound('Project');
    const scheduledAt = instant('visitAt', input.visitAt, timezone);
    // The visit register's rule (POST /site-visits): it is forward.
    if (scheduledAt.getTime() < Date.now() - 86_400_000) {
      refuse('visitAt', 'A site visit is booked ahead; log a past one as an activity.');
    }
    const row = await tx.siteVisit.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
        leadId: lead.id,
        projectId: project.id,
        scheduledAt,
      },
      select: { id: true },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'visits',
        recordId: row.id,
        newValue: { leadId: lead.id, projectId: project.id, scheduledAt },
      },
      tx,
    );
  }

  if (meeting) {
    const dueAt = instant('meetingAt', input.meetingAt, timezone);
    const type = await tx.taskType.findFirst({
      where: { tenantId: ctx.tenantId, key: 'meeting', isActive: true },
      select: { id: true },
    });
    if (!type) refuse('meetingAt', 'This workspace has no Meeting task type to book the meeting with.');
    // The lead's next follow-up may now be this meeting.
    const task = await withRecompute(tx, ctx.tenantId, [lead.id], () =>
      tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          typeId: type.id,
          category: 'APPOINTMENT',
          title: `Meeting with ${lead.fullName}`,
          leadId: lead.id,
          ownerId: ctx.actor.id,
          createdById: ctx.actor.id,
          startAt: dueAt,
          dueAt,
        },
        select: { id: true },
      }),
    );
    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'tasks', recordId: task.id, newValue: { leadId: lead.id, dueAt } },
      tx,
    );
  }
}

/**
 * "YYYY-MM-DDTHH:mm" (what the date fields send) is a time on the workspace's
 * clock; an ISO instant with its offset is itself.
 */
function instant(field: string, value: unknown, timeZone: string): Date {
  const text = String(value ?? '');
  const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text);
  // ponytail: the zone's offset at that day's midnight, so a zone with daylight
  // saving is an hour out on its change day; the UAE has none.
  const at =
    wall && !Number.isNaN(Date.parse(`${text}Z`))
      ? new Date(dayBounds(wall[1]!, timeZone).from.getTime() + (Number(wall[2]) * 60 + Number(wall[3])) * 60_000)
      : /T.+(Z|[+-]\d{2}:\d{2})$/.test(text)
        ? new Date(text)
        : new Date(NaN);
  if (Number.isNaN(at.getTime())) refuse(field, `${field} must be a date and time, e.g. 2026-11-20T16:30.`);
  return at;
}

/**
 * The duplicate check create runs (M4-51): a phone or email changed to a value
 * another lead holds — its main number, one of its other numbers, or its email,
 * normalised — answers the same 409. Only the fields that change are probed, so
 * an edit of something else never trips on a duplicate that was there already.
 * The lead's name goes in too, so a rule pairing it with the phone applies as on
 * create; a rule on the name alone does not, since the edit did not change it.
 * Also the check for a number added under "Other numbers" (leads/[id]/phones).
 * Outside the transaction, as create's is: the duplicate rules read through the
 * global client. A lead outside the caller's scope answers 404 first, never the
 * 409 that would confirm it exists.
 */
export async function refuseDuplicate(
  ctx: Ctx,
  id: string,
  input: Pick<UpdateLeadInput, 'phone' | 'email' | 'fullName'>,
) {
  if (input.phone === undefined && input.email === undefined) return;
  const current = await assertLeadInScope(ctx, id, prisma, 'EDIT');
  const phoneNormalized = input.phone !== undefined ? normalizePhone(input.phone) : null;
  const email = input.email?.toLowerCase();
  const probe = {
    phoneNormalized: phoneNormalized && phoneNormalized !== current.phoneNormalized ? phoneNormalized : null,
    email: email && email !== current.email ? email : null,
  };
  if (!probe.phoneNormalized && !probe.email) return;
  const [match] = await findDuplicates(ctx.tenantId, {
    ...probe,
    fullName: input.fullName ?? current.fullName,
    ignoreNameOnly: true,
    excludeId: id,
  });
  if (match) throw Conflict(`A lead with this ${match.matchedOn} already exists (${match.reference}).`);
}

/** A 422 whose detail is the sentence the screen shows. */
function refuse(field: string, message: string): never {
  throw new AppError(422, 'validation-failed', message, [{ field, code: 'required', message }]);
}
