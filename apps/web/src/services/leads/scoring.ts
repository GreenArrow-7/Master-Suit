/**
 * Lead scoring (Lead Eagle audit row M4-11): a lead starts at its source's
 * points (`LeadSource.weight`), each logged activity adds its type's
 * `ActivityType.scoreDelta`, and the nightly decay takes a workspace rule's
 * `decayAmount` for every `decayDays` without activity (`ScoringRule`,
 * triggerType DECAY; none, or switched off, means no decay).
 *
 * The score moves by events rather than being recomputed from scratch, so the
 * other writers keep their meaning: the post-call AI temperature an agent
 * applies (calls/[id]/temperature), an import's or the move tool's carried
 * score. Every move is a LeadScoreHistory row, saying why, and an audit row.
 * The arithmetic is pinned in tests/unit/lead-scoring.spec.ts.
 */
import { prisma, withPlatformTx, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';
import { audit, type SystemActor } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { OPEN_LEADS_WHERE } from './closeOut';

type Db = TxClient | typeof prisma;

/** The workspace's decay rule: `ScoringRule.triggerType`. */
export const DECAY_TRIGGER = 'DECAY';

const DAY = 86_400_000;
/** A nightly run that fires a little early still counts the day. */
const GRACE = 3_600_000;
/** Leads per workspace per night; a larger backlog drains over the next nights. */
const PER_WORKSPACE_LIMIT = 500;

/** The score after `delta`: whole points, never below 0 or above 100. */
export const applyDelta = (score: number, delta: number) => Math.min(100, Math.max(0, Math.round(score + delta)));

/** The latest a lead's last activity, or its last decay step, may be for a step to be due at `now`. */
const decayCutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY + GRACE);

/**
 * Whether a lead idle since `idleSince` owes a decay step at `now`: one step for
 * every `days` without activity, counted from its last activity or its last
 * step, whichever is later.
 */
export const decayDue = (idleSince: Date, lastStepAt: Date | null, now: Date, days: number) =>
  Math.max(idleSince.getTime(), lastStepAt?.getTime() ?? 0) <= decayCutoff(now, days).getTime();

/**
 * Where a new lead from this entry starts: `{ sourceId, score }`, spread into
 * the create. A sub-source worth nothing takes its source's points.
 */
export async function withSourceScore(db: Db, tenantId: string, sourceId: string | null | undefined) {
  if (!sourceId) return { sourceId: null, score: 0 };
  const entry = await db.leadSource.findFirst({
    where: { tenantId, id: sourceId },
    select: { weight: true, parent: { select: { weight: true } } },
  });
  return { sourceId, score: applyDelta(0, entry?.weight || entry?.parent?.weight || 0) };
}

/** The workspace's decay rule as Administration → Sources shows it, or null when it has none. */
export async function decayRule(db: Db, tenantId: string) {
  const rule = await db.scoringRule.findFirst({
    where: { tenantId, triggerType: DECAY_TRIGGER },
    select: { decayDays: true, decayAmount: true, isActive: true },
  });
  return rule && { decayDays: rule.decayDays ?? 0, decayAmount: rule.decayAmount ?? 0, isActive: rule.isActive };
}

/** One move of a lead's score, read and written in `tx`, with its reason; nothing when it would not move. */
async function moveScore(
  tx: TxClient,
  by: Ctx | SystemActor,
  leadId: string,
  delta: number,
  reason: string,
  extra: { ruleId?: string; at?: Date; activityId?: string } = {},
) {
  const lead = await tx.lead.findFirst({
    where: { tenantId: by.tenantId, id: leadId },
    select: { id: true, score: true },
  });
  if (!lead) return null;
  const after = applyDelta(lead.score, delta);
  if (after === lead.score) return null;
  await tx.lead.update({ where: { tenantId: by.tenantId, id: lead.id }, data: { score: after } });
  await tx.leadScoreHistory.create({
    data: {
      tenantId: by.tenantId,
      leadId: lead.id,
      ruleId: extra.ruleId ?? null,
      delta: after - lead.score,
      scoreAfter: after,
      reason,
      ...(extra.at && { createdAt: extra.at }),
    },
  });
  await audit(
    by,
    {
      event: 'RECORD_UPDATED',
      objectType: 'lead',
      recordId: lead.id,
      fieldKey: 'score',
      previousValue: lead.score,
      newValue: after,
      metadata: { reason, ...(extra.activityId && { activityId: extra.activityId }) },
    },
    tx,
  );
  return after;
}

/** A logged activity adds its type's points to its lead, in the transaction that logged it. */
export async function scoreActivity(
  tx: TxClient,
  ctx: Ctx,
  activity: { id: string; leadId: string | null; typeId: string },
) {
  if (!activity.leadId) return null;
  const type = await tx.activityType.findFirst({
    where: { tenantId: ctx.tenantId, id: activity.typeId },
    select: { name: true, scoreDelta: true },
  });
  if (!type?.scoreDelta) return null;
  const sign = type.scoreDelta > 0 ? '+' : '';
  return moveScore(tx, ctx, activity.leadId, type.scoreDelta, `${type.name} ${sign}${type.scoreDelta}`, {
    activityId: activity.id,
  });
}

/**
 * The nightly decay, for every workspace with an active rule (or the named
 * ones: a test sweeps only its own). Open leads only, as recycling reads them:
 * a closed-out lead or one in a won or lost stage keeps its score. Idempotent:
 * a step is due only a whole period after the lead's last activity and its
 * last step, so a retry or a second run that night does nothing.
 */
export async function runScoreDecay(now = new Date(), tenantIds?: string[]) {
  // Cross-tenant by nature, so raw inside withPlatformTx, as the recycle sweep reads its settings.
  const rules = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<{ id: string; tenantId: string; decayDays: number; decayAmount: number }[]>`
      SELECT "id", "tenantId", "decayDays", "decayAmount"
        FROM "ScoringRule"
       WHERE "isActive" AND "triggerType" = 'DECAY' AND "decayDays" > 0 AND "decayAmount" > 0`,
  );
  let leads = 0;
  for (const rule of rules) {
    if (tenantIds && !tenantIds.includes(rule.tenantId)) continue;
    try {
      leads += await decayWorkspace(rule, now);
    } catch (err) {
      // One workspace's failure must not stop the rest; the next night picks it up.
      logger.error({ err, tenantId: rule.tenantId }, 'lead score decay failed for workspace');
    }
  }
  return { workspaces: rules.length, leads };
}

async function decayWorkspace(
  rule: { id: string; tenantId: string; decayDays: number; decayAmount: number },
  now: Date,
) {
  const { tenantId, decayDays: days } = rule;
  const cutoff = decayCutoff(now, days);
  const candidates = await prisma.lead.findMany({
    where: {
      tenantId,
      deletedAt: null,
      score: { gt: 0 },
      stage: { is: { category: 'OPEN' } },
      // Two OR groups, so AND: spreading OPEN_LEADS_WHERE beside another OR drops it (recycle.ts).
      AND: [
        OPEN_LEADS_WHERE,
        { OR: [{ lastActivityAt: { lte: cutoff } }, { lastActivityAt: null, createdAt: { lte: cutoff } }] },
      ],
      scoreHistory: { none: { ruleId: rule.id, createdAt: { gt: cutoff } } },
    },
    select: {
      id: true,
      score: true,
      lastActivityAt: true,
      createdAt: true,
      scoreHistory: {
        where: { ruleId: rule.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { id: 'asc' },
    take: PER_WORKSPACE_LIMIT,
  });
  const by = { tenantId, source: 'score-decay' };
  const reason = `No activity for ${days} days -${rule.decayAmount}`;
  let moved = 0;
  // A transaction per lead: one per workspace would outlive the transaction timeout on a big backlog.
  for (const lead of candidates) {
    if (!decayDue(lead.lastActivityAt ?? lead.createdAt, lead.scoreHistory[0]?.createdAt ?? null, now, days)) continue;
    const after = await withTx(tenantId, (tx) =>
      moveScore(tx, by, lead.id, -rule.decayAmount, reason, { ruleId: rule.id, at: now }),
    );
    if (after !== null) moved += 1;
  }
  return moved;
}
