import { prisma } from '@/lib/db';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';
import { startOfLocalDay, workspaceTimezone } from '@/services/hr/attendance';
import type { CallOutcome } from '@prisma/client';

/**
 * The daily lead-target board: what each seller was asked to do today, what
 * they have done, and what is still pending — every number counted from the
 * work itself (calls, follow-ups, meetings, opportunities, attendance), never
 * typed in. A manager reads the board; a seller reads their own row.
 *
 * Definitions, so the numbers mean one thing everywhere:
 *   called      distinct leads with a completed or attempted call by the seller today
 *   connected   completed calls whose outcome says someone answered
 *   not answered  completed/missed calls nobody answered (no answer, busy, voicemail)
 *   cold        answered, not interested (or wrong number)
 *   warm        answered, asked to be called back
 *   interested  answered and interested, qualified or converted
 *   pending     target minus leads called (never below zero); with no target, the
 *               seller's assigned leads not yet called today
 */
export const ANSWERED: readonly CallOutcome[] = [
  'CONNECTED',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'INTERESTED',
  'QUALIFIED',
  'CONVERTED',
  'WRONG_NUMBER',
];
export const NOT_ANSWERED: readonly CallOutcome[] = ['NO_ANSWER', 'BUSY', 'VOICEMAIL'];
export const COLD: readonly CallOutcome[] = ['NOT_INTERESTED', 'WRONG_NUMBER'];
export const WARM: readonly CallOutcome[] = ['CALLBACK_REQUESTED', 'CONNECTED'];
export const INTERESTED: readonly CallOutcome[] = ['INTERESTED', 'QUALIFIED', 'CONVERTED'];

export function classify(outcome: CallOutcome | null): 'notAnswered' | 'cold' | 'warm' | 'interested' | 'unknown' {
  if (!outcome) return 'unknown';
  if (NOT_ANSWERED.includes(outcome)) return 'notAnswered';
  if (INTERESTED.includes(outcome)) return 'interested';
  if (COLD.includes(outcome)) return 'cold';
  if (WARM.includes(outcome)) return 'warm';
  return 'unknown';
}

export interface DailyBoardRow {
  userId: string;
  name: string | null;
  /** The day's LEADS_CALLED target, when one was assigned. */
  target: number | null;
  targetId: string | null;
  leadsAssigned: number;
  leadsCalled: number;
  callsCompleted: number;
  connected: number;
  notAnswered: number;
  cold: number;
  warm: number;
  interested: number;
  followUpsCreated: number;
  meetingsScheduled: number;
  opportunitiesCreated: number;
  dealsWon: number;
  pending: number;
  /** 0–100, null when no target was set. */
  completion: number | null;
  totalDurationSecs: number;
  averageDurationSecs: number | null;
  checkInAt: Date | null;
  checkedOut: boolean;
}

export interface DailyBoard {
  date: string;
  timeZone: string;
  from: Date;
  to: Date;
  rows: DailyBoardRow[];
}

/** The local day `date` (YYYY-MM-DD) covers, in the workspace's time zone. */
export function dayBounds(date: string, timeZone: string): { from: Date; to: Date; dateKey: string } {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error('date must be YYYY-MM-DD');
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const from = startOfLocalDay(noonUtc, timeZone);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from, to, dateKey: date };
}

/** Today's date key in the workspace's time zone. */
export function todayKey(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Who the caller may see on the board: their reports subtree, the whole
 * workspace at organization scope, or only themselves.
 */
export async function boardUserIds(ctx: Ctx): Promise<string[] | 'all' | 'self'> {
  const scope = scopeFor(ctx, 'reports', 'VIEW');
  if (scope === 'ORGANIZATION') return 'all';
  if (SCOPE_RANK[scope] >= SCOPE_RANK.TEAM) return resolveOwnerIds(ctx, scope);
  return 'self';
}

export async function dailyBoard(ctx: Ctx, date?: string): Promise<DailyBoard> {
  const timeZone = await workspaceTimezone(ctx);
  const dateKey = date ?? todayKey(timeZone);
  const { from, to } = dayBounds(dateKey, timeZone);
  const who = await boardUserIds(ctx);
  const userIds = who === 'self' ? [ctx.actor.id] : who === 'all' ? [] : who;
  if (who !== 'all' && userIds.length === 0) return { date: dateKey, timeZone, from, to, rows: [] };
  const tenantId = ctx.tenantId;
  const within = { gte: from, lte: to };
  const owner = userIds.length === 0 ? {} : { ownerId: { in: userIds } };
  const caller = userIds.length === 0 ? {} : { callerId: { in: userIds } };
  const ids = userIds.length === 0 ? {} : { id: { in: userIds } };

  const [users, targets, assigned, calls, distinctCalled, followUps, meetings, opportunities, deals, attendance] =
    await Promise.all([
      prisma.user.findMany({ where: { tenantId, deletedAt: null, ...ids }, select: { id: true, fullName: true } }),
      prisma.employeeTarget.findMany({
        where: {
          tenantId,
          metric: 'LEADS_CALLED',
          periodStart: { lte: to },
          periodEnd: { gte: from },
          ...(userIds.length === 0 ? {} : { userId: { in: userIds } }),
        },
        select: { id: true, userId: true, targetValue: true, period: true, periodStart: true },
        orderBy: { periodStart: 'desc' },
      }),
      prisma.lead.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, status: null, ...owner },
        _count: { _all: true },
      }),
      prisma.call.findMany({
        where: { tenantId, deletedAt: null, status: { in: ['COMPLETED', 'MISSED'] }, createdAt: within, ...caller },
        select: { callerId: true, outcome: true, status: true, durationSecs: true },
      }),
      prisma.call.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ['COMPLETED', 'MISSED', 'FAILED'] },
          createdAt: within,
          leadId: { not: null },
          ...caller,
        },
        select: { callerId: true, leadId: true },
        distinct: ['callerId', 'leadId'],
      }),
      prisma.followUpTask.groupBy({
        by: ['ownerId'],
        where: { tenantId, createdAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['ownerId'],
        where: { tenantId, createdAt: within, type: { key: 'meeting' }, ...owner },
        _count: { _all: true },
      }),
      prisma.opportunity.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, createdAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.opportunity.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, status: 'WON', updatedAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.hrAttendanceRecord.findMany({
        where: {
          tenantId,
          workDate: within,
          employee: {
            deletedAt: null,
            membership: userIds.length === 0 ? { salesUserId: { not: null } } : { salesUserId: { in: userIds } },
          },
        },
        select: {
          checkInAt: true,
          checkOutAt: true,
          employee: { select: { membership: { select: { salesUserId: true } } } },
        },
      }),
    ]);

  const rows = new Map<string, DailyBoardRow>();
  const row = (userId: string) => {
    let r = rows.get(userId);
    if (!r) {
      r = {
        userId,
        name: null,
        target: null,
        targetId: null,
        leadsAssigned: 0,
        leadsCalled: 0,
        callsCompleted: 0,
        connected: 0,
        notAnswered: 0,
        cold: 0,
        warm: 0,
        interested: 0,
        followUpsCreated: 0,
        meetingsScheduled: 0,
        opportunitiesCreated: 0,
        dealsWon: 0,
        pending: 0,
        completion: null,
        totalDurationSecs: 0,
        averageDurationSecs: null,
        checkInAt: null,
        checkedOut: false,
      };
      rows.set(userId, r);
    }
    return r;
  };
  for (const u of users) row(u.id).name = u.fullName;
  // Newest daily target wins; a weekly/monthly one applies only when no daily target exists.
  for (const t of targets) {
    const r = row(t.userId);
    if (r.targetId && t.period !== 'DAILY') continue;
    if (r.targetId && t.period === 'DAILY' && r.target !== null) continue;
    r.target = t.targetValue;
    r.targetId = t.id;
  }
  for (const g of assigned) if (g.ownerId) row(g.ownerId).leadsAssigned += g._count._all;
  const called = new Map<string, Set<string>>();
  for (const c of distinctCalled) {
    if (!c.leadId) continue;
    if (!called.has(c.callerId)) called.set(c.callerId, new Set());
    called.get(c.callerId)!.add(c.leadId);
  }
  for (const [userId, leads] of called) row(userId).leadsCalled = leads.size;
  for (const c of calls) {
    const r = row(c.callerId);
    if (c.status === 'COMPLETED') {
      r.callsCompleted += 1;
      r.totalDurationSecs += c.durationSecs ?? 0;
    }
    if (c.outcome && ANSWERED.includes(c.outcome)) r.connected += 1;
    const kind = c.status === 'MISSED' ? 'notAnswered' : classify(c.outcome);
    if (kind === 'notAnswered') r.notAnswered += 1;
    else if (kind === 'cold') r.cold += 1;
    else if (kind === 'warm') r.warm += 1;
    else if (kind === 'interested') r.interested += 1;
  }
  for (const g of followUps) if (g.ownerId) row(g.ownerId).followUpsCreated += g._count._all;
  for (const g of meetings) if (g.ownerId) row(g.ownerId).meetingsScheduled += g._count._all;
  for (const g of opportunities) if (g.ownerId) row(g.ownerId).opportunitiesCreated += g._count._all;
  for (const g of deals) if (g.ownerId) row(g.ownerId).dealsWon += g._count._all;
  for (const a of attendance) {
    const userId = a.employee.membership?.salesUserId;
    if (!userId) continue;
    const r = row(userId);
    if (a.checkInAt && (!r.checkInAt || a.checkInAt < r.checkInAt)) r.checkInAt = a.checkInAt;
    if (a.checkOutAt) r.checkedOut = true;
  }
  for (const r of rows.values()) {
    r.averageDurationSecs = r.callsCompleted ? Math.round(r.totalDurationSecs / r.callsCompleted) : null;
    if (r.target !== null && r.target > 0) {
      r.pending = Math.max(0, r.target - r.leadsCalled);
      r.completion = Math.min(100, Math.round((r.leadsCalled / r.target) * 100));
    } else {
      r.pending = Math.max(0, r.leadsAssigned - r.leadsCalled);
    }
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      (b.target ?? -1) - (a.target ?? -1) ||
      b.leadsCalled - a.leadsCalled ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
  return { date: dateKey, timeZone, from, to, rows: sorted };
}

export interface DailyCallRow {
  id: string;
  at: Date;
  leadId: string | null;
  leadName: string | null;
  recipientNumber: string | null;
  status: string;
  outcome: CallOutcome | null;
  kind: ReturnType<typeof classify>;
  durationSecs: number | null;
  notes: string | null;
}

/** Every call one seller made on the day, newest first: the rows behind the numbers. */
export async function dailyCalls(
  ctx: Ctx,
  userId: string,
  date?: string,
): Promise<{ board: DailyBoard; calls: DailyCallRow[] }> {
  const board = await dailyBoard(ctx, date);
  const visible = board.rows.some((r) => r.userId === userId);
  if (!visible) return { board: { ...board, rows: [] }, calls: [] };
  const calls = await prisma.call.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      callerId: userId,
      createdAt: { gte: board.from, lte: board.to },
      status: { in: ['COMPLETED', 'MISSED', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      leadId: true,
      recipientNumber: true,
      status: true,
      outcome: true,
      durationSecs: true,
      notes: true,
    },
  });
  const leadIds = [...new Set(calls.flatMap((c) => (c.leadId ? [c.leadId] : [])))];
  const names = new Map(
    (
      await prisma.lead.findMany({
        where: { tenantId: ctx.tenantId, id: { in: leadIds } },
        select: { id: true, fullName: true },
      })
    ).map((l) => [l.id, l.fullName]),
  );
  return {
    board: { ...board, rows: board.rows.filter((r) => r.userId === userId) },
    calls: calls.map((c) => ({
      id: c.id,
      at: c.createdAt,
      leadId: c.leadId,
      leadName: (c.leadId && names.get(c.leadId)) ?? null,
      recipientNumber: c.recipientNumber,
      status: c.status,
      outcome: c.outcome,
      kind: c.status === 'MISSED' ? 'notAnswered' : classify(c.outcome),
      durationSecs: c.durationSecs,
      notes: c.notes,
    })),
  };
}

/** The shortfall against today's LEADS_CALLED target for one seller (0 when none or met). */
export async function dailyTargetShortfall(ctx: Ctx, userId: string): Promise<number> {
  const board = await dailyBoard({ ...ctx, actor: { ...ctx.actor, id: userId } }, undefined);
  const r = board.rows.find((x) => x.userId === userId);
  return r && r.target !== null ? r.pending : 0;
}
