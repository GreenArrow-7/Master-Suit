import type { DataStatus } from '@prisma/client';
import { ctxForUser } from '@/lib/auth/session';
import { prisma, withTx } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { loadFieldRules, seesField, type FieldRule } from '@/lib/security/fieldSecurity';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { can, type Action, type Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
import { recordTargetProgress } from '@/services/targets/progress';
import { CLOSE_OUT_STATUSES, closeOutLead } from './closeOut';
import { LEAD_SENSITIVE_FIELDS } from './createLead';
import { lockLeads, OPEN_STATUSES, recomputeNextFollowUp } from './nextFollowUp';
import { queueCalendarSync } from '../integrations/calendarSync';

/**
 * Whose cold data a person reaches for `action`, as a `where`: the lead rule
 * (`visibilityWhere` on the record's owner). TEAM, BRANCH and REGION are the
 * caller's resolved owners, ORGANIZATION everything, and an unassigned record
 * — a list arrives unassigned — is ORGANIZATION's to hand out, as follow-ups
 * and tasks read theirs. With no grant for the action, your own. Was
 * own-or-all: a team lead worked, handed on and converted only their own
 * records while the lead list beside it showed the team's.
 */
export function coldDataScope(ctx: Ctx, action: Action = 'VIEW'): Promise<Record<string, unknown>> {
  return can(ctx, 'leads', action)
    ? visibilityWhere(ctx, 'leads', action)
    : Promise.resolve({ tenantId: ctx.tenantId, ownerId: ctx.actor.id });
}

/** What a call found. `NOT_CONTACTED` resets a record; `CONVERTED` is the convert route's. */
export const CALL_OUTCOMES = [
  'NOT_REACHABLE',
  'NOT_INTERESTED',
  'INTERESTED',
  'INVALID',
] as const satisfies readonly DataStatus[];
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * Work a cold record: what the call found moves its status, and the call is
 * logged as an outbound-call Activity on the record, audited in the same
 * transaction (M5-06) — so it counts toward the daily calling target and the
 * check-out gate as a call to a lead does (`dailyBoard`, `recordTargetProgress`).
 * Every call is an attempt; the first call to a record in the workspace's day
 * is a lead called. Outside the caller's scope the record answers as a missing
 * one (P2025 → 404) and nothing is written.
 */
export async function logColdCall(
  ctx: Ctx,
  id: string,
  data: { status: CallOutcome; notes?: string | null; ownerId?: string | null },
) {
  const { tenantId } = ctx;
  const [scope, type, timeZone] = await Promise.all([
    coldDataScope(ctx, 'EDIT'),
    prisma.activityType.upsert({
      where: { tenantId_key: { tenantId, key: 'call_out' } },
      update: {},
      create: { tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3 },
      select: { id: true },
    }),
    workspaceTimezone(ctx),
  ]);
  const { from, to } = dayBounds(todayKey(timeZone), timeZone);
  const { record, first } = await withTx(tenantId, async (tx) => {
    const record = await tx.dataRecord.update({
      where: { ...scope, id, convertedLeadId: null },
      data,
      select: { id: true, status: true },
    });
    const earlier = await tx.activity.count({
      where: { tenantId, dataRecordId: id, ownerId: ctx.actor.id, deletedAt: null, createdAt: { gte: from, lte: to } },
    });
    const call = await tx.activity.create({
      data: {
        tenantId,
        typeId: type.id,
        dataRecordId: id,
        ownerId: ctx.actor.id,
        outcome: data.status,
        notes: data.notes ?? undefined,
      },
      select: { id: true },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'activity',
        recordId: call.id,
        metadata: { dataRecordId: id, outcome: data.status },
      },
      tx,
    );
    return { record, first: earlier === 0 };
  });
  await recordTargetProgress(ctx, ctx.actor.id, 'CALLS_ATTEMPTED');
  if (first) await recordTargetProgress(ctx, ctx.actor.id, 'LEADS_CALLED');
  return record;
}

/** Reads a lead's numbers in full (#158): what Cold Data shows its owner, so what Move to Data needs. */
const readsLeadNumbers = (ctx: Ctx, rules: Map<string, FieldRule>) =>
  seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS);

/**
 * Who may Move to Data (M4-39): a cold record (`leads:CREATE`; cold data is
 * lead work), the close-out (`leads:EDIT`), and the lead's numbers in full. An
 * own cold record reads as stored, so a role that reads lead numbers masked
 * (the Telecaller) would read them by moving its leads.
 */
export const mayMoveToData = (ctx: Ctx, rules: Map<string, FieldRule>) =>
  can(ctx, 'leads', 'CREATE') && can(ctx, 'leads', 'EDIT') && readsLeadNumbers(ctx, rules);

/**
 * Bulk Move to Data (M4-39), one lead, in one transaction: it leaves the
 * pipeline as a contact on the day's "From pipeline <date>" list (the
 * workspace's date), still its owner's; the lead is closed out as archived
 * (`closeOutLead`) and its open follow-ups and tasks are cancelled, so it
 * leaves every working list. Outside the caller's EDIT scope 404, and nothing
 * is written. A lead already closed out (moved before, a replay) or whose
 * owner reads lead numbers masked answers 409. Audited on the lead. The record
 * holds one number; the others go in its notes, which Cold Data masks as the
 * number is masked.
 */
export async function moveLeadToData(ctx: Ctx, id: string) {
  const { tenantId } = ctx;
  // The owner's permissions are read on their own connections, so before the transaction.
  const { ownerId } = await assertLeadInScope(ctx, id, prisma, 'EDIT');
  if (ownerId && ownerId !== ctx.actor.id) {
    const owner = await ctxForUser(ownerId, tenantId, ctx.requestId).catch(() => null);
    if (!owner || !readsLeadNumbers(owner, await loadFieldRules(owner, 'LEAD'))) {
      throw Conflict('Its owner reads lead numbers masked, and Cold Data would show them in full: reassign it first.');
    }
  }
  const batch = `From pipeline ${todayKey(await workspaceTimezone(ctx))}`;
  let cancelled: { followUps: string[]; tasks: string[] } = { followUps: [], tasks: [] };
  const moved = await withTx(tenantId, async (tx) => {
    // The row lock first: a second move of the same lead waits, then finds it closed out.
    await lockLeads(tx, tenantId, [id]);
    const before = await assertLeadInScope(ctx, id, tx, 'EDIT');
    if (before.ownerId !== ownerId) throw Conflict('The lead changed hands meanwhile: try again.');
    if ((CLOSE_OUT_STATUSES as readonly (string | null)[]).includes(before.status)) {
      throw Conflict('This lead is closed out: reopen it to move it to Cold Data.');
    }
    const lead = await closeOutLead(ctx, id, { status: 'ARCHIVED' }, tx);

    const open = { tenantId, leadId: id, deletedAt: null, status: { in: [...OPEN_STATUSES] } };
    const followUps = (await tx.followUpTask.findMany({ where: open, select: { id: true } })).map((f) => f.id);
    const tasks = (await tx.task.findMany({ where: open, select: { id: true } })).map((t) => t.id);
    await tx.followUpTask.updateMany({ where: { tenantId, id: { in: followUps } }, data: { status: 'CANCELLED' } });
    await tx.task.updateMany({
      where: { tenantId, id: { in: tasks } },
      data: { status: 'CANCELLED', updatedById: ctx.actor.id },
    });
    await recomputeNextFollowUp(tx, tenantId, id);
    cancelled = { followUps, tasks };

    const phones = await tx.leadPhone.findMany({
      where: { tenantId, leadId: id },
      orderBy: { createdAt: 'asc' },
      select: { raw: true, normalized: true },
    });
    // With no main number, its first other one: a record with none has nothing to dial.
    const main = lead.phoneNormalized ? { raw: lead.phone, normalized: lead.phoneNormalized } : phones[0];
    const others = phones.filter((p) => p.normalized !== main?.normalized);
    const notes = [lead.notes, others.length && `Other numbers: ${others.map((p) => p.normalized).join(', ')}`]
      .filter(Boolean)
      .join('\n');
    const record = await tx.dataRecord.create({
      data: {
        tenantId,
        fullName: lead.fullName,
        phone: main?.raw ?? null,
        phoneNormalized: main?.normalized ?? null,
        email: lead.email,
        company: lead.company,
        jobTitle: lead.jobTitle,
        city: lead.city,
        country: lead.country,
        notes: notes || null,
        batch,
        ownerId: lead.ownerId,
        createdById: ctx.actor.id,
      },
      select: { id: true },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'lead',
        recordId: id,
        metadata: {
          action: 'lead.moved_to_data',
          dataRecordId: record.id,
          batch,
          followUpsCancelled: followUps,
          tasksCancelled: tasks,
        },
      },
      tx,
    );
    return { id, dataRecordId: record.id, batch };
  });
  // The cancelled meetings off the workspace's calendars (M8-08, M8-09).
  await queueCalendarSync(tenantId, 'followUp', ...cancelled.followUps);
  await queueCalendarSync(tenantId, 'task', ...cancelled.tasks);
  return moved;
}
