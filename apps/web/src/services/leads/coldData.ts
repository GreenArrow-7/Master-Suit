import type { DataStatus } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Action, type Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
import { recordTargetProgress } from '@/services/targets/progress';
import { closeOutLead } from './closeOut';

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

/**
 * Bulk Move to Data (M4-39), one lead: it leaves the pipeline as a contact on
 * the day's "From pipeline <date>" list (the workspace's date), still its
 * owner's, and the lead is closed out as archived (`closeOutLead`, at the
 * lead's EDIT scope; outside it 404 and nothing is written). One transaction,
 * audited on the lead. Its other numbers go in the record's notes: a record
 * holds one number.
 */
export async function moveLeadToData(ctx: Ctx, id: string) {
  const batch = `From pipeline ${todayKey(await workspaceTimezone(ctx))}`;
  return withTx(ctx.tenantId, async (tx) => {
    const lead = await closeOutLead(ctx, id, { status: 'ARCHIVED' }, tx);
    const others = await tx.leadPhone.findMany({
      where: { tenantId: ctx.tenantId, leadId: id, normalized: { not: lead.phoneNormalized ?? '' } },
      orderBy: { createdAt: 'asc' },
      select: { normalized: true },
    });
    const notes = [lead.notes, others.length && `Other numbers: ${others.map((p) => p.normalized).join(', ')}`]
      .filter(Boolean)
      .join('\n');
    const record = await tx.dataRecord.create({
      data: {
        tenantId: ctx.tenantId,
        fullName: lead.fullName,
        phone: lead.phone,
        phoneNormalized: lead.phoneNormalized,
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
        metadata: { action: 'lead.moved_to_data', dataRecordId: record.id, batch },
      },
      tx,
    );
    return { id, dataRecordId: record.id, batch };
  });
}
