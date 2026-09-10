/**
 * The unassigned-lead queue: opening an episode, closing one, and working out
 * who is accountable for it.
 *
 * Before this, `assignLead` had three `return` statements — no rule, empty pool,
 * lead already taken — and each of them left the lead with `ownerId = null` and
 * no record at all. It looked exactly like a lead nobody had reached yet. There
 * was no deadline, nobody accountable, and no statement of what had gone wrong.
 *
 * ── An episode, not a flag ──────────────────────────────────────────────────
 *
 * A lead can wait, be assigned, be routed back to a team pool and wait again.
 * "How long did it wait the second time" has to be answerable separately from
 * the first, so each wait is its own row with its own episode number. A boolean
 * on `Lead` would overwrite the first with the second.
 *
 * ── One open episode per lead ───────────────────────────────────────────────
 *
 * Enforced by a partial unique index rather than by a check-then-insert. Two
 * workers racing the same lead, a redelivered portal webhook and a BullMQ retry
 * all reach the same statement; the index refuses the loser and the caller reads
 * that as "already queued", which it is. A `findFirst` beforehand would take no
 * lock and both would insert.
 */
import { prisma, type TxClient } from '@/lib/db';

/** Named for `scripts/check-raw-sql-scope.mjs`. See eligibility.ts. */
type TransactionClient = TxClient;
import type { Ineligibility } from './eligibility';

export type TriageReason = 'NO_RULE' | 'EMPTY_POOL' | 'NO_ELIGIBLE_AGENT' | 'ALL_AT_CAPACITY';

/** What the queue shows under "why automatic assignment failed". */
export interface TriageDetail {
  /** Per-candidate refusal, in the order the rotation considered them. */
  candidates?: { userId: string; blockers: Ineligibility[] }[];
  /** Configuration the workspace enabled that this build cannot honour. */
  unsupported?: string[];
  /** The rule's name at the time, so the queue reads without a join. */
  ruleName?: string;
}

export interface OpenTriageInput {
  tenantId: string;
  leadId: string;
  reason: TriageReason;
  detail?: TriageDetail;
  rule?: {
    id: string;
    name: string;
    escalateAfterMins: number | null;
    fallbackTeamId: string | null;
    fallbackUserId: string | null;
  } | null;
  /** The lead's own team, used when the rule names no fallback. */
  leadTeamId?: string | null;
  now?: Date;
}

export interface Accountability {
  responsibleUserId: string | null;
  responsibleTeamId: string | null;
  /** Nothing in the configuration names anybody. An administrative exception. */
  routingPolicyMissing: boolean;
}

/**
 * Who has to clear this.
 *
 * In order: the rule's explicit fallback user, then its fallback team's manager,
 * then the lead's own team's manager. Each of those is somebody the workspace
 * has already designated — none of them is "whoever holds a broad permission",
 * because widening someone's data access to make a fallback work is exactly the
 * fix this must not be.
 *
 * When none of them exists, the entry says so. A queue entry with nobody
 * accountable is still visible and still counted; it is flagged as a
 * configuration problem, which is a different administrative task from clearing
 * the lead itself.
 */
export async function resolveAccountability(
  tenantId: string,
  rule: OpenTriageInput['rule'],
  leadTeamId: string | null | undefined,
  client: Pick<typeof prisma, 'team' | 'user'> = prisma,
): Promise<Accountability> {
  if (rule?.fallbackUserId) {
    const user = await client.user.findFirst({
      where: { tenantId, id: rule.fallbackUserId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (user) {
      return {
        responsibleUserId: user.id,
        responsibleTeamId: rule.fallbackTeamId ?? leadTeamId ?? null,
        routingPolicyMissing: false,
      };
    }
    // Configured but unusable is a configuration problem, not a reason to guess.
  }

  for (const teamId of [rule?.fallbackTeamId, leadTeamId]) {
    if (!teamId) continue;
    const team = await client.team.findFirst({
      where: { tenantId, id: teamId, deletedAt: null },
      select: { id: true, managerId: true },
    });
    if (!team) continue;
    if (team.managerId) {
      const manager = await client.user.findFirst({
        where: { tenantId, id: team.managerId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      if (manager) return { responsibleUserId: manager.id, responsibleTeamId: team.id, routingPolicyMissing: false };
    }
    // A team with no usable manager still names the team, so the queue can be
    // filtered by it; it just cannot name a person.
    return { responsibleUserId: null, responsibleTeamId: team.id, routingPolicyMissing: true };
  }

  return { responsibleUserId: null, responsibleTeamId: null, routingPolicyMissing: true };
}

/**
 * When somebody is expected to have dealt with it.
 *
 * `DistributionRule.escalateAfterMins` has been in the schema from the start and
 * was read by nothing. It is the configured review window, and where a workspace
 * has not set one **no deadline is invented**: the entry carries a null
 * `reviewDueAt` and `reviewPolicyMissing`, the queue shows "review window not
 * configured", and the lead stays visible rather than being quietly filtered out
 * of a deadline-ordered list.
 */
export function reviewDeadline(rule: OpenTriageInput['rule'], now: Date) {
  const mins = rule?.escalateAfterMins ?? null;
  if (mins === null || mins <= 0) return { reviewDueAt: null, reviewPolicyMissing: true };
  return { reviewDueAt: new Date(now.getTime() + mins * 60_000), reviewPolicyMissing: false };
}

export interface OpenTriageResult {
  /** Null when an episode was already open — which is the safe, common case. */
  entryId: string | null;
  episode: number | null;
  alreadyQueued: boolean;
}

/**
 * Open an episode, or do nothing because one is already open.
 *
 * Must be called inside the same transaction as the assignment attempt it
 * follows, so "we failed to assign" and "we recorded that we failed" commit
 * together or not at all.
 */
export async function openTriageEntry(tx: TransactionClient, input: OpenTriageInput): Promise<OpenTriageResult> {
  const now = input.now ?? new Date();
  const { reviewDueAt, reviewPolicyMissing } = reviewDeadline(input.rule, now);
  const who = await resolveAccountability(
    input.tenantId,
    input.rule,
    input.leadTeamId,
    tx as unknown as Pick<typeof prisma, 'team' | 'user'>,
  );

  /**
   * `MAX(episode) + 1` is read in the same statement that inserts, so it cannot
   * be stale — and the partial unique index is what actually decides, so two
   * racers computing the same number produce one row and one conflict rather
   * than two rows.
   */
  const rows = await tx.$queryRaw<{ id: string; episode: number }[]>`
    INSERT INTO "LeadTriageEntry" (
      "id", "tenantId", "leadId", "episode", "reason", "detail", "ruleId",
      "responsibleTeamId", "responsibleUserId", "reviewDueAt",
      "reviewPolicyMissing", "routingPolicyMissing", "status", "openedAt",
      "createdAt", "updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      ${input.tenantId},
      ${input.leadId},
      COALESCE((SELECT MAX(e."episode") FROM "LeadTriageEntry" e
                 WHERE e."tenantId" = ${input.tenantId} AND e."leadId" = ${input.leadId}), 0) + 1,
      ${input.reason}::"LeadTriageReason",
      ${JSON.stringify(input.detail ?? {})}::jsonb,
      ${input.rule?.id ?? null},
      ${who.responsibleTeamId},
      ${who.responsibleUserId},
      ${reviewDueAt},
      ${reviewPolicyMissing},
      ${who.routingPolicyMissing},
      'WAITING'::"LeadTriageStatus",
      ${now}, ${now}, ${now}
    ON CONFLICT DO NOTHING
    RETURNING "id", "episode"
  `;

  const created = rows[0];
  return created
    ? { entryId: created.id, episode: created.episode, alreadyQueued: false }
    : { entryId: null, episode: null, alreadyQueued: true };
}

/**
 * Close the open episode for a lead, if there is one.
 *
 * Called whenever a lead stops needing a human decision — somebody was given it,
 * it was deleted, it was merged away. Returns the entry it closed so the caller
 * can decide whether an escalation that was already raised needs answering.
 *
 * Idempotent: closing an already-closed lead's episode matches nothing and
 * reports it, rather than resurrecting a terminal row.
 */
export async function resolveTriageEntry(
  tx: TransactionClient,
  tenantId: string,
  leadId: string,
  outcome: { status: 'ASSIGNED' | 'CANCELLED'; resolvedById?: string | null; resolution: string; now?: Date },
): Promise<{ resolvedEntryId: string | null; wasEscalated: boolean }> {
  const now = outcome.now ?? new Date();
  const open = await tx.leadTriageEntry.findFirst({
    where: { tenantId, leadId, status: 'WAITING' },
    select: { id: true, escalatedAt: true },
  });
  if (!open) return { resolvedEntryId: null, wasEscalated: false };

  /**
   * Guarded on `status = 'WAITING'` rather than on the id alone: two managers
   * assigning the same lead at the same moment both find this row, and only the
   * one whose UPDATE matches has actually resolved it. The other's assignment
   * transaction will already have failed on the lead's own row lock, and this is
   * the second line of that defence rather than the first.
   */
  const changed = await tx.leadTriageEntry.updateMany({
    where: { tenantId, id: open.id, status: 'WAITING' },
    data: {
      status: outcome.status,
      resolvedAt: now,
      resolvedById: outcome.resolvedById ?? null,
      resolution: outcome.resolution,
    },
  });
  if (changed.count === 0) return { resolvedEntryId: null, wasEscalated: false };
  return { resolvedEntryId: open.id, wasEscalated: open.escalatedAt !== null };
}

/** Human-readable summary of why a lead is waiting, for a queue row. */
export function explainReason(reason: TriageReason, detail: TriageDetail | null): string {
  switch (reason) {
    case 'NO_RULE':
      return 'No active lead distribution rule';
    case 'EMPTY_POOL':
      return detail?.ruleName ? `${detail.ruleName} names nobody` : 'The distribution rule names nobody';
    case 'ALL_AT_CAPACITY': {
      const n = detail?.candidates?.length ?? 0;
      return n > 0 ? `All ${n} candidate${n === 1 ? '' : 's'} at quota or capacity` : 'Everyone is at their limit';
    }
    case 'NO_ELIGIBLE_AGENT':
    default: {
      const n = detail?.candidates?.length ?? 0;
      return n > 0 ? `No eligible agent among ${n} candidate${n === 1 ? '' : 's'}` : 'No eligible agent';
    }
  }
}
