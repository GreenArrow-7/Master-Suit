/**
 * The manager's view over analysed calls, and the numbers derived from it.
 *
 * Everything here reads what the pipeline already wrote — AIAnalysis,
 * ObjectionMatch, CallAudit, Communication, FollowUpTask — and computes on the
 * way out. Nothing is pre-aggregated into a rollup table: the dashboard reads a
 * few hundred rows per screen, and a rollup that can drift from its sources is
 * a debugging session waiting for the day it does.
 *
 * ponytail: JS aggregation over a WINDOW_MAX-row window instead of SQL GROUP BY
 * joins. Honest about being a window (the UI says so when it is hit). Move the
 * heavy queries to $queryRaw grouping when a workspace's ninety-day window
 * outgrows it.
 */
import { prisma } from '@/lib/db';
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';

const WINDOW_MAX = 2000;

/**
 * Opts a read out of the guard's `deletedAt: null` filter (see src/lib/db.ts).
 *
 * Used for one thing here: resolving the *name* of a playbook entry that has
 * since been retired. Those ids come from ObjectionMatch rows written while the
 * entry was live, and hiding it now would relabel historical findings as
 * "Deleted objection", making a manager's past coaching unreadable.
 *
 * Spread rather than written inline because the flag is stripped before the
 * query reaches Prisma and is therefore not part of its argument types.
 */
const INCLUDE_DELETED = { __includeDeleted: true } as Record<string, never>;

export interface CoachingFilters {
  callerId?: string;
  from?: Date;
  to?: Date;
  /** Lead stage, which is what "pipeline stage" means for calls made to leads. */
  stageId?: string;
  /**
   * Restrict to calls that actually carry an analysis.
   *
   * On by default from the dashboard. A workspace's completed calls are mostly
   * calls nobody uploaded a recording for, and listing them turned a coaching
   * screen into fifty rows of em-dashes with the handful of coachable calls
   * buried among them — the page promised "analysed calls" and delivered a call
   * log. Managers who want the backlog turn it off explicitly.
   */
  analysedOnly?: boolean;
}

/**
 * The caller ids this manager may see, or null for the whole workspace.
 * Reps see themselves; everything else resolves through the same helper the
 * lead lists use, so "my team" means the same thing on every screen.
 */
async function visibleCallerIds(ctx: Ctx): Promise<string[] | null> {
  const scope = scopeFor(ctx, 'calls', 'VIEW');
  if (scope === 'ORGANIZATION') return null;
  if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) return [ctx.actor.id];
  return resolveOwnerIds(ctx, scope);
}

async function callWhere(ctx: Ctx, filters: CoachingFilters) {
  const visible = await visibleCallerIds(ctx);
  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    deletedAt: null,
    status: 'COMPLETED',
  };
  if (visible)
    where.callerId = filters.callerId && visible.includes(filters.callerId) ? filters.callerId : { in: visible };
  else if (filters.callerId) where.callerId = filters.callerId;
  if (filters.from || filters.to) where.createdAt = { gte: filters.from, lte: filters.to };
  // `is: {}` means "the related row exists" — the analysis is a 1-1 relation, so
  // this is a join rather than a second query returning ids to filter on.
  if (filters.analysedOnly) where.analysis = { is: {} };
  if (filters.stageId) {
    const leads = await prisma.lead.findMany({
      where: { tenantId: ctx.tenantId, stageId: filters.stageId },
      select: { id: true },
      take: WINDOW_MAX,
    });
    where.leadId = { in: leads.map((l) => l.id) };
  }
  return where;
}

/** Which of these calls has had its follow-up email sent, by call id. */
async function followUpSentByCall(tenantId: string, callIds: readonly string[]): Promise<Map<string, Date>> {
  if (callIds.length === 0) return new Map();
  // The send route stamps { callId, kind: 'CALL_FOLLOW_UP' } into metadata;
  // filtering on the JSON path keeps this a single indexless-but-bounded query
  // rather than a schema change for one dashboard column.
  const communications = await prisma.communication.findMany({
    where: {
      tenantId,
      channel: 'EMAIL',
      status: { in: ['SENT', 'DELIVERED', 'READ', 'CLICKED', 'REPLIED'] },
      metadata: { path: ['kind'], equals: 'CALL_FOLLOW_UP' },
    },
    select: { metadata: true, sentAt: true },
    orderBy: { sentAt: 'asc' },
    take: WINDOW_MAX,
  });
  const wanted = new Set(callIds);
  const sent = new Map<string, Date>();
  for (const c of communications) {
    const callId = (c.metadata as { callId?: string }).callId;
    // First send wins: "time to follow-up" measures the follow-up, not a resend.
    if (callId && c.sentAt && wanted.has(callId) && !sent.has(callId)) sent.set(callId, c.sentAt);
  }
  return sent;
}

// ── The dashboard list ───────────────────────────────────────────────────────

/** How many calls match the filters with and without the analysed-only rule. */
export async function coachingCounts(ctx: Ctx, filters: CoachingFilters) {
  const [analysed, all] = await Promise.all([
    prisma.call.count({ where: await callWhere(ctx, { ...filters, analysedOnly: true }) }),
    prisma.call.count({ where: await callWhere(ctx, { ...filters, analysedOnly: false }) }),
  ]);
  return { analysed, all, awaitingAnalysis: all - analysed };
}

export async function coachingCallList(ctx: Ctx, filters: CoachingFilters, limit = 50) {
  const where = await callWhere(ctx, filters);

  const calls = await prisma.call.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      callerId: true,
      leadId: true,
      contactId: true,
      recipientNumber: true,
      outcome: true,
      durationSecs: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      caller: { select: { id: true, fullName: true } },
      analysis: { select: { status: true, sentiment: true, talkRatio: true, summary: true } },
      callAudits: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { overallScore: true, maxScore: true },
      },
      objectionMatches: { select: { addressed: true } },
      _count: { select: { coachingNotes: true } },
    },
  });

  const followUps = await followUpSentByCall(
    ctx.tenantId,
    calls.map((c) => c.id),
  );

  return calls.map((call) => {
    const audit = call.callAudits[0];
    return {
      id: call.id,
      caller: call.caller,
      leadId: call.leadId,
      recipientNumber: call.recipientNumber,
      outcome: call.outcome,
      durationSecs: call.durationSecs,
      at: call.startedAt ?? call.createdAt,
      analysisStatus: call.analysis?.status ?? null,
      sentiment: call.analysis?.sentiment ?? null,
      talkRatio: call.analysis?.talkRatio ?? null,
      score: audit?.maxScore ? Math.round(((audit.overallScore ?? 0) / audit.maxScore) * 100) : null,
      objections: call.objectionMatches.length,
      objectionsAddressed: call.objectionMatches.filter((m) => m.addressed).length,
      followUpSentAt: followUps.get(call.id) ?? null,
      coachingNotes: call._count.coachingNotes,
    };
  });
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function coachingAnalytics(ctx: Ctx, filters: CoachingFilters) {
  const where = await callWhere(ctx, filters);

  const calls = await prisma.call.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: WINDOW_MAX,
    select: {
      id: true,
      callerId: true,
      leadId: true,
      outcome: true,
      endedAt: true,
      caller: { select: { fullName: true } },
      analysis: { select: { talkRatio: true, status: true } },
      objectionMatches: { select: { objectionId: true, addressed: true } },
    },
  });

  const followUps = await followUpSentByCall(
    ctx.tenantId,
    calls.map((c) => c.id),
  );

  // 1. Talk-to-listen distribution by rep.
  const byRep = new Map<string, { rep: string; ratios: number[] }>();
  for (const call of calls) {
    const ratio = call.analysis?.talkRatio;
    if (ratio == null) continue;
    const entry = byRep.get(call.callerId) ?? { rep: call.caller?.fullName ?? 'Unknown', ratios: [] };
    entry.ratios.push(ratio);
    byRep.set(call.callerId, entry);
  }
  const talkToListenByRep = [...byRep.entries()]
    .map(([callerId, { rep, ratios }]) => ({
      callerId,
      rep,
      calls: ratios.length,
      avgTalkRatio: round(ratios.reduce((a, b) => a + b, 0) / ratios.length),
      minTalkRatio: round(Math.min(...ratios)),
      maxTalkRatio: round(Math.max(...ratios)),
    }))
    .sort((a, b) => b.calls - a.calls);

  // 2. Objection → next-step conversion: of the calls where each objection came
  // up, how often it was addressed, and how often the call still went somewhere
  // (a follow-up sent, or an outcome the pipeline counts as forward motion).
  const FORWARD = new Set(['INTERESTED', 'QUALIFIED', 'CONVERTED', 'CALLBACK_REQUESTED']);
  const byObjection = new Map<string, { calls: number; addressed: number; converted: number }>();
  for (const call of calls) {
    const seen = new Set<string>();
    for (const match of call.objectionMatches) {
      if (seen.has(match.objectionId)) continue;
      seen.add(match.objectionId);
      const entry = byObjection.get(match.objectionId) ?? { calls: 0, addressed: 0, converted: 0 };
      entry.calls += 1;
      if (match.addressed) entry.addressed += 1;
      if (followUps.has(call.id) || (call.outcome && FORWARD.has(call.outcome))) entry.converted += 1;
      byObjection.set(match.objectionId, entry);
    }
  }
  const objectionIds = [...byObjection.keys()];
  const objectionNames = objectionIds.length
    ? new Map(
        (
          await prisma.objection.findMany({
            where: { tenantId: ctx.tenantId, id: { in: objectionIds } },
            select: { id: true, name: true },
            ...INCLUDE_DELETED,
          })
        ).map((o) => [o.id, o.name]),
      )
    : new Map<string, string>();
  const objectionConversion = objectionIds
    .map((id) => {
      const stats = byObjection.get(id)!;
      return {
        objectionId: id,
        name: objectionNames.get(id) ?? 'Deleted objection',
        calls: stats.calls,
        addressedRate: round(stats.addressed / stats.calls),
        nextStepRate: round(stats.converted / stats.calls),
      };
    })
    .sort((a, b) => b.calls - a.calls);

  // 3. Time from call end to follow-up sent.
  const gaps: number[] = [];
  for (const call of calls) {
    const sentAt = followUps.get(call.id);
    if (sentAt && call.endedAt && sentAt > call.endedAt) {
      gaps.push((sentAt.getTime() - call.endedAt.getTime()) / 60_000);
    }
  }
  gaps.sort((a, b) => a - b);
  const followUpTiming = {
    calls: calls.length,
    followedUp: gaps.length,
    medianMinutes: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    p90Minutes: gaps.length ? Math.round(gaps[Math.floor(gaps.length * 0.9)]) : null,
  };

  // 4. Conversion by pipeline stage: for the leads these calls belong to, where
  // they sit now and how often their calls moved forward. Derived from the CRM
  // as it stands — a stage-history walk would say more and cost a table scan.
  const leadIds = [...new Set(calls.map((c) => c.leadId).filter((id): id is string => !!id))];
  const leadStages = leadIds.length
    ? await prisma.lead.findMany({
        where: { tenantId: ctx.tenantId, id: { in: leadIds } },
        select: { id: true, stage: { select: { id: true, name: true, position: true } } },
      })
    : [];
  const stageByLead = new Map(leadStages.map((l) => [l.id, l.stage]));
  const byStage = new Map<string, { name: string; position: number; calls: number; forward: number }>();
  for (const call of calls) {
    const stage = call.leadId ? stageByLead.get(call.leadId) : null;
    if (!stage) continue;
    const entry = byStage.get(stage.id) ?? { name: stage.name, position: stage.position, calls: 0, forward: 0 };
    entry.calls += 1;
    if (call.outcome && FORWARD.has(call.outcome)) entry.forward += 1;
    byStage.set(stage.id, entry);
  }
  const conversionByStage = [...byStage.entries()]
    .map(([stageId, s]) => ({
      stageId,
      stage: s.name,
      position: s.position,
      calls: s.calls,
      forwardRate: round(s.forward / s.calls),
    }))
    .sort((a, b) => a.position - b.position);

  return {
    window: { calls: calls.length, capped: calls.length === WINDOW_MAX },
    talkToListenByRep,
    objectionConversion,
    followUpTiming,
    conversionByStage,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
