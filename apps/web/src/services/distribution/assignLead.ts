import type { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { assessEligibility, lockAndVerify, policyFromRule, unsupportedPolicy, type Eligibility } from './eligibility';
import { openTriageEntry, resolveTriageEntry, type TriageDetail, type TriageReason } from './triage';

/**
 * Automatic lead assignment, and what happens when it cannot place one.
 *
 * ── What this used to do ────────────────────────────────────────────────────
 *
 * Three bare `return` statements — no rule, empty pool, lead already owned —
 * each leaving the lead with `ownerId = null` and recording nothing at all. The
 * lead dropped into the pool looking exactly like one nobody had reached yet:
 * no deadline, nobody accountable, no statement of what went wrong. A workspace
 * whose only distribution rule had been deactivated would quietly stop assigning
 * leads and nothing anywhere would say so.
 *
 * It also checked no eligibility whatsoever. `pool[(last + 1) % pool.length]`
 * was assigned regardless of whether that person was suspended, deactivated, on
 * approved leave, or ten leads past their daily quota. A deactivated employee
 * could be given a new lead by the automatic path, every time the rotation came
 * round to them.
 *
 * ── What it does now ────────────────────────────────────────────────────────
 *
 * Every path ends in a recorded outcome: assigned to a named person, or an
 * accountable triage episode saying why not. The rotation walks its pool asking
 * the one shared eligibility rule (see `eligibility.ts`), and the winner is
 * re-verified under a row lock inside the assignment transaction, because a
 * read outside the transaction is a guess by the time the transaction commits.
 *
 * `DistributionMethod` still supports only ROUND_ROBIN. The other methods are a
 * `switch (rule.method)` here when a workspace needs one; the eligibility gate
 * and the triage fallback are method-independent and will not need rewriting.
 */

export type AssignOutcome =
  | { outcome: 'assigned'; userId: string; leadId: string }
  | { outcome: 'already-assigned'; leadId: string }
  | { outcome: 'gone'; leadId: string }
  | { outcome: 'queued'; leadId: string; reason: TriageReason; entryId: string | null; alreadyQueued: boolean };

const RULE_SELECT = {
  id: true,
  name: true,
  candidatePool: true,
  lastAssignedUserId: true,
  escalateAfterMins: true,
  fallbackTeamId: true,
  fallbackUserId: true,
  respectLeave: true,
  respectQuotas: true,
  respectCapacity: true,
  respectWorkingHours: true,
} satisfies Prisma.DistributionRuleSelect;

export async function assignLead(tenantId: string, leadId: string, now = new Date()): Promise<AssignOutcome> {
  const lead = await prisma.lead.findFirst({
    where: { tenantId, id: leadId, deletedAt: null },
    select: { id: true, ownerId: true, teamId: true },
  });
  if (!lead) return { outcome: 'gone', leadId };
  if (lead.ownerId) return { outcome: 'already-assigned', leadId };

  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, objectType: 'LEAD', isActive: true, method: 'ROUND_ROBIN', deletedAt: null },
    orderBy: { position: 'asc' },
    select: RULE_SELECT,
  });

  // No rule at all. Previously a silent return; now an administrative exception
  // somebody is accountable for, which is the whole point of P1-1.
  if (!rule) {
    return queue(tenantId, lead, null, 'NO_RULE', {}, now);
  }

  const unsupported = unsupportedPolicy(rule);
  const pool = (rule.candidatePool as { userIds?: string[] })?.userIds ?? [];
  if (pool.length === 0) {
    return queue(tenantId, lead, rule, 'EMPTY_POOL', { ruleName: rule.name, unsupported }, now);
  }

  const policy = policyFromRule(rule);
  const verdicts = await assessEligibility(tenantId, pool, policy, now);
  const by = new Map(verdicts.map((v) => [v.userId, v]));

  /**
   * Walk the rotation from wherever it last stopped, taking the first person who
   * may actually work the lead — rather than giving up on the first ineligible
   * one, which would leave every later enquiry unassigned until somebody edited
   * the rule.
   */
  const lastIndex = rule.lastAssignedUserId ? pool.indexOf(rule.lastAssignedUserId) : -1;
  const order: string[] = [];
  for (let step = 1; step <= pool.length; step += 1) order.push(pool[(lastIndex + step) % pool.length]!);

  const detail: TriageDetail = {
    ruleName: rule.name,
    unsupported,
    candidates: order.map((userId) => ({ userId, blockers: by.get(userId)?.blockers ?? [] })),
  };

  const candidates = order.filter((userId) => by.get(userId)?.eligible);
  if (candidates.length === 0) {
    // Distinguish "nobody may take work" from "everybody is simply full": they
    // are different administrative fixes, and a manager who cannot tell them
    // apart cannot act on either.
    const onlyLimits = order.every((userId) => {
      const v = by.get(userId);
      return v ? v.blockers.every((b) => b.code === 'QUOTA_REACHED' || b.code === 'AT_CAPACITY') : false;
    });
    return queue(tenantId, lead, rule, onlyLimits ? 'ALL_AT_CAPACITY' : 'NO_ELIGIBLE_AGENT', detail, now);
  }

  /**
   * The read above is a shortlist, not a decision. Between it and the commit,
   * another worker can take the same person's last free slot, HR can approve
   * leave, or an administrator can suspend the account — so each candidate is
   * re-verified under a lock inside the transaction, and the shortlist is walked
   * until one of them still holds.
   */
  for (const userId of candidates) {
    const placed = await tryAssign(tenantId, lead.id, userId, rule, policy, now);
    if (placed.outcome !== 'retry') return placed.result;
    detail.candidates = detail.candidates?.map((c) =>
      c.userId === userId ? { userId, blockers: placed.blockers } : c,
    );
  }

  // Every shortlisted candidate lost their slot between the read and the lock.
  // Rare, and it must still end in a recorded outcome rather than a silent drop.
  return queue(tenantId, lead, rule, 'ALL_AT_CAPACITY', detail, now);
}

type TryResult = { outcome: 'done'; result: AssignOutcome } | { outcome: 'retry'; blockers: Eligibility['blockers'] };

/**
 * One attempt, entirely inside a transaction.
 *
 * **Lock order: `User`, then `Lead`.** `lockAndVerify` takes the user row, then
 * the lead is claimed by a conditional UPDATE. That ordering is this
 * subsystem's rule and is what keeps it deadlock-free against bulk allocation,
 * which takes the same order. The obligation subsystem uses the opposite order
 * (`Lead` first) and must never take a `User` lock while holding a `Lead` one —
 * see `docs/product/NEXT-ACTION-AND-REMINDER-CONTRACTS.md` §2.6.
 *
 * Assignment, history, the rotation pointer and the triage resolution all commit
 * together. A crash between any two of them leaves none of them.
 */
async function tryAssign(
  tenantId: string,
  leadId: string,
  userId: string,
  rule: { id: string; name: string },
  policy: ReturnType<typeof policyFromRule>,
  now: Date,
): Promise<TryResult> {
  return withTx(tenantId, async (tx) => {
    const verdict = await lockAndVerify(tx, tenantId, userId, policy, now);
    if (!verdict.eligible) return { outcome: 'retry' as const, blockers: verdict.blockers };

    /**
     * `ownerId IS NULL` in the WHERE is the claim. Two workers reaching this on
     * one lead produce one update of 1 row and one of 0 — the second is told the
     * lead is gone rather than overwriting the first worker's assignment, which
     * is how the same lead ends up promised to two agents.
     */
    const claimed = await tx.$executeRaw`
      UPDATE "Lead"
         SET "ownerId" = ${userId}, "assignedAt" = ${now}, "updatedAt" = ${now}
       WHERE "id" = ${leadId} AND "tenantId" = ${tenantId}
         AND "ownerId" IS NULL AND "deletedAt" IS NULL
    `;
    if (claimed === 0) {
      return { outcome: 'done' as const, result: { outcome: 'already-assigned' as const, leadId } };
    }

    await tx.leadAssignmentHistory.create({
      data: {
        tenantId,
        leadId,
        toOwnerId: userId,
        ruleId: rule.id,
        method: 'ROUND_ROBIN',
        reason: 'DISTRIBUTION_RULE',
      },
    });

    // The pointer moves only on a real assignment. Advancing it for a lead that
    // turned out to be taken would skip somebody's turn.
    await tx.distributionRule.updateMany({
      where: { tenantId, id: rule.id },
      data: { lastAssignedUserId: userId },
    });

    /**
     * An assignment ends any wait this lead was in — including one raised by an
     * earlier failed attempt at the same lead moments ago. Closing it here, in
     * the same transaction, is what makes "assigning a lead resolves its pending
     * escalation" true rather than eventually true.
     */
    const closed = await resolveTriageEntry(tx, tenantId, leadId, {
      status: 'ASSIGNED',
      resolution: `Automatically assigned by ${rule.name}`,
      now,
    });

    return {
      outcome: 'done' as const,
      result: { outcome: 'assigned' as const, userId, leadId },
      escalationAnswered: closed.wasEscalated,
    };
  });
}

/** Record the wait, in its own transaction, and say what to tell whom. */
async function queue(
  tenantId: string,
  lead: { id: string; teamId: string | null },
  rule: Parameters<typeof openTriageEntry>[1]['rule'],
  reason: TriageReason,
  detail: TriageDetail,
  now: Date,
): Promise<AssignOutcome> {
  const opened = await withTx(tenantId, (tx) =>
    openTriageEntry(tx, { tenantId, leadId: lead.id, reason, detail, rule, leadTeamId: lead.teamId, now }),
  );

  logger.info(
    { tenantId, leadId: lead.id, reason, entryId: opened.entryId, alreadyQueued: opened.alreadyQueued },
    opened.alreadyQueued ? 'lead already waiting for triage' : 'lead entered the triage queue',
  );

  return { outcome: 'queued', leadId: lead.id, reason, entryId: opened.entryId, alreadyQueued: opened.alreadyQueued };
}

/**
 * The next user in the tenant's round-robin, advancing the pointer.
 *
 * Shared with social enquiries so one rotation covers all inbound work rather
 * than two competing ones — a rep who just took a Facebook comment should be
 * behind their colleagues for the next website lead too.
 *
 * It used to check only `status = ACTIVE`, which meant the social path would
 * hand an enquiry to somebody on approved leave or past their daily quota. It
 * now asks the same eligibility rule as everything else; `note` carries the
 * reason so the caller can say why nobody was found rather than reporting an
 * empty pool for four different causes.
 */
export async function nextDistributionOwner(
  tenantId: string,
  now = new Date(),
): Promise<{ userId: string | null; note: string | null }> {
  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, objectType: 'LEAD', isActive: true, method: 'ROUND_ROBIN', deletedAt: null },
    orderBy: { position: 'asc' },
    select: RULE_SELECT,
  });
  if (!rule) return { userId: null, note: 'No matching distribution rule.' };

  const pool = (rule.candidatePool as { userIds?: string[] })?.userIds ?? [];
  if (pool.length === 0) return { userId: null, note: `No members in ${rule.name}.` };

  const policy = policyFromRule(rule);
  const verdicts = await assessEligibility(tenantId, pool, policy, now);
  const by = new Map(verdicts.map((v) => [v.userId, v]));
  const lastIndex = rule.lastAssignedUserId ? pool.indexOf(rule.lastAssignedUserId) : -1;

  for (let step = 1; step <= pool.length; step += 1) {
    const candidate = pool[(lastIndex + step) % pool.length]!;
    if (!by.get(candidate)?.eligible) continue;
    await prisma.distributionRule.updateMany({
      where: { tenantId, id: rule.id },
      data: { lastAssignedUserId: candidate },
    });
    return { userId: candidate, note: null };
  }

  const blocked = verdicts.filter((v) => v.blockers.length > 0).length;
  return { userId: null, note: `No eligible members in ${rule.name} (${blocked} of ${pool.length} unavailable).` };
}
