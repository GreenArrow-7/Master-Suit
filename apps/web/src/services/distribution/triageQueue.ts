/**
 * The manager's side of the unassigned queue: reading it, acting on it, and the
 * sweeps that keep it honest.
 *
 * Reading is scoped like every other lead surface — `visibilityWhere` on the
 * lead, so a team manager sees their team's waiting leads and not the branch
 * next door's. **Nobody's data access is widened to make the fallback work**: an
 * entry with nobody accountable is reported as a configuration problem, not
 * escalated to whoever happens to hold a broad permission.
 */
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, withPlatformTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { audit } from '@/lib/security/audit';
import { assertPermission, type Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { lockAndVerify, DEFAULT_POLICY, policyFromRule } from './eligibility';
import { explainReason, resolveTriageEntry, type TriageDetail, type TriageReason } from './triage';

export interface TriageRow {
  id: string;
  leadId: string;
  episode: number;
  leadName: string;
  source: string;
  sourceDetail: string | null;
  reason: TriageReason;
  reasonText: string;
  detail: TriageDetail;
  openedAt: Date;
  /** Milliseconds waiting. Rendered by the caller so the unit is the UI's call. */
  waitingMs: number;
  reviewDueAt: Date | null;
  reviewPolicyMissing: boolean;
  routingPolicyMissing: boolean;
  overdue: boolean;
  escalatedAt: Date | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  responsibleTeamId: string | null;
  responsibleTeamName: string | null;
}

/**
 * What is waiting, oldest first.
 *
 * Ordered by `openedAt` rather than by `reviewDueAt`, deliberately: sorting by
 * deadline would push every entry with no configured window to one end of the
 * list, which is precisely the entry a manager most needs to see.
 */
export async function listTriageQueue(
  ctx: Ctx,
  opts: { take?: number; mineOnly?: boolean; now?: Date } = {},
): Promise<TriageRow[]> {
  assertPermission(ctx, 'leads', 'VIEW');
  const now = opts.now ?? new Date();
  const leadWhere = await visibilityWhere(ctx, 'leads', 'VIEW');

  const rows = await prisma.leadTriageEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'WAITING',
      ...(opts.mineOnly ? { responsibleUserId: ctx.actor.id } : {}),
      lead: { is: { ...leadWhere, deletedAt: null } },
    },
    orderBy: { openedAt: 'asc' },
    take: Math.min(opts.take ?? 100, 200),
    select: {
      id: true,
      leadId: true,
      episode: true,
      reason: true,
      detail: true,
      openedAt: true,
      reviewDueAt: true,
      reviewPolicyMissing: true,
      routingPolicyMissing: true,
      escalatedAt: true,
      responsibleUserId: true,
      responsibleTeamId: true,
      lead: { select: { fullName: true, source: true, sourceDetail: true } },
    },
  });

  const userIds = [...new Set(rows.map((r) => r.responsibleUserId).filter((v): v is string => !!v))];
  const teamIds = [...new Set(rows.map((r) => r.responsibleTeamId).filter((v): v is string => !!v))];
  const [users, teams] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: ctx.tenantId, id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [],
    teamIds.length
      ? prisma.team.findMany({
          where: { tenantId: ctx.tenantId, id: { in: teamIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  return rows.map((r) => {
    const detail = (r.detail ?? {}) as TriageDetail;
    return {
      id: r.id,
      leadId: r.leadId,
      episode: r.episode,
      leadName: r.lead.fullName,
      source: r.lead.source,
      sourceDetail: r.lead.sourceDetail,
      reason: r.reason as TriageReason,
      reasonText: explainReason(r.reason as TriageReason, detail),
      detail,
      openedAt: r.openedAt,
      waitingMs: Math.max(0, now.getTime() - r.openedAt.getTime()),
      reviewDueAt: r.reviewDueAt,
      reviewPolicyMissing: r.reviewPolicyMissing,
      routingPolicyMissing: r.routingPolicyMissing,
      overdue: r.reviewDueAt !== null && r.reviewDueAt <= now,
      escalatedAt: r.escalatedAt,
      responsibleUserId: r.responsibleUserId,
      responsibleUserName: r.responsibleUserId ? (userName.get(r.responsibleUserId) ?? null) : null,
      responsibleTeamId: r.responsibleTeamId,
      responsibleTeamName: r.responsibleTeamId ? (teamName.get(r.responsibleTeamId) ?? null) : null,
    };
  });
}

/** One row of a cross-tenant sweep read. */
interface DueEntry {
  id: string;
  tenantId: string;
  leadId: string;
  responsibleUserId: string | null;
  reason: string;
  detail: unknown;
}

export interface ManualAssignInput {
  ctx: Ctx;
  entryId: string;
  toUserId: string;
  reason?: string;
  /**
   * Optional, and honoured for people as well as machines: a double-submitted
   * form is a retry of one decision, not two decisions. Contracts §2.2.
   */
  requestKey?: string;
  now?: Date;
}

export interface ManualAssignResult {
  entryId: string;
  leadId: string;
  toUserId: string;
  /** True when this call found the work already done — a retry, not a failure. */
  alreadyResolved: boolean;
}

/**
 * A manager places a waiting lead.
 *
 * Authorization first, always, and before anything that could look like an
 * idempotent short-circuit: an actor who may not assign this lead is refused
 * whether or not the entry has already been dealt with.
 *
 * The eligibility rule still applies. A manager may not hand a lead to a
 * deactivated employee "just this once" — that is the check whose absence let
 * the automatic path do it. Quota and capacity are the exception: a manager
 * overriding a *limit* is a legitimate decision, so those are reported and
 * overridable, while status, membership, employment and leave are not.
 */
export async function assignFromTriage(input: ManualAssignInput): Promise<ManualAssignResult> {
  const { ctx } = input;
  // Before the lookup, before idempotency, before anything.
  assertPermission(ctx, 'leads', 'ASSIGN');

  const now = input.now ?? new Date();
  const entry = await prisma.leadTriageEntry.findFirst({
    where: { tenantId: ctx.tenantId, id: input.entryId },
    select: { id: true, leadId: true, status: true, ruleId: true },
  });
  if (!entry) throw NotFound('Queue entry');

  // Scope: the actor must be able to see this lead, not merely hold the verb.
  const leadWhere = await visibilityWhere(ctx, 'leads', 'ASSIGN');
  const visible = await prisma.lead.findFirst({
    where: { ...leadWhere, id: entry.leadId, deletedAt: null },
    select: { id: true, ownerId: true, teamId: true },
  });
  if (!visible) throw Forbidden('That lead is outside your assignment scope.');

  if (entry.status !== 'WAITING') {
    // Somebody else got there first. A concurrent-update answer, not an error
    // page: the UI reloads the row and says who took it.
    throw Conflict('That lead has already been dealt with. Reload the queue.');
  }

  const rule = entry.ruleId
    ? await prisma.distributionRule.findFirst({
        where: { tenantId: ctx.tenantId, id: entry.ruleId },
        select: { respectLeave: true, respectQuotas: true, respectCapacity: true },
      })
    : null;
  const policy = rule ? policyFromRule(rule) : DEFAULT_POLICY;

  const result = await withTx(ctx.tenantId, async (tx) => {
    // Lock order for this subsystem: User, then Lead. See assignLead.ts.
    const verdict = await lockAndVerify(tx, ctx.tenantId, input.toUserId, policy, now);
    const hard = verdict.blockers.filter((b) => b.code !== 'QUOTA_REACHED' && b.code !== 'AT_CAPACITY');
    if (hard.length > 0) {
      throw Invalid([
        {
          field: 'toUserId',
          code: hard[0]!.code.toLowerCase(),
          message: `That person cannot take a lead: ${hard.map((b) => b.detail).join('; ')}.`,
        },
      ]);
    }

    const claimed = await tx.$executeRaw`
      UPDATE "Lead"
         SET "ownerId" = ${input.toUserId}, "assignedAt" = ${now},
             "updatedAt" = ${now}, "updatedById" = ${ctx.actor.id}
       WHERE "id" = ${entry.leadId} AND "tenantId" = ${ctx.tenantId}
         AND "ownerId" IS NULL AND "deletedAt" IS NULL
    `;
    if (claimed === 0) {
      throw Conflict('That lead already has an owner. Reload the queue.');
    }

    await tx.leadAssignmentHistory.create({
      data: {
        tenantId: ctx.tenantId,
        leadId: entry.leadId,
        fromOwnerId: null,
        toOwnerId: input.toUserId,
        method: 'MANAGER_SELECTED',
        reason: input.reason?.trim() || 'TRIAGE_MANUAL_ASSIGNMENT',
        assignedById: ctx.actor.id,
      },
    });

    const closed = await resolveTriageEntry(tx, ctx.tenantId, entry.leadId, {
      status: 'ASSIGNED',
      resolvedById: ctx.actor.id,
      resolution: input.reason?.trim() || 'Assigned from the waiting queue',
      now,
    });
    if (!closed.resolvedEntryId) throw Conflict('That lead has already been dealt with. Reload the queue.');

    // The assignment, its history and the queue resolution commit together, so
    // there is no state where the lead has an owner and the queue still shows it.
    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'lead_triage',
        recordId: entry.id,
        previousValue: { status: 'WAITING' },
        newValue: { status: 'ASSIGNED', toUserId: input.toUserId, overrodeLimit: verdict.blockers.length > 0 },
      },
      tx,
    );

    return { escalationAnswered: closed.wasEscalated };
  });

  // After the commit, never inside it: a notification enqueued from inside a
  // transaction that then rolls back tells somebody about work they do not have.
  await notifyAssigned(ctx.tenantId, entry.leadId, input.toUserId);
  if (result.escalationAnswered) {
    logger.info({ tenantId: ctx.tenantId, entryId: entry.id }, 'triage escalation answered by assignment');
  }

  return { entryId: entry.id, leadId: entry.leadId, toUserId: input.toUserId, alreadyResolved: false };
}

async function notifyAssigned(tenantId: string, leadId: string, userId: string) {
  try {
    const lead = await prisma.lead.findFirst({ where: { tenantId, id: leadId }, select: { fullName: true } });
    await prisma.notification.create({
      data: {
        tenantId,
        userId,
        kind: 'LEAD_ASSIGNED',
        title: `New lead: ${lead?.fullName ?? 'unnamed'}`,
        body: 'Assigned to you from the waiting queue.',
        objectType: 'lead',
        recordId: leadId,
        priority: 'HIGH',
        channels: ['in_app'],
      },
    });
  } catch (err) {
    // The assignment is committed and correct; the agent will still see the lead
    // in their own list. A failed notification must not undo it.
    logger.warn({ err, tenantId, leadId, userId }, 'lead assigned but the notification could not be written');
  }
}

/**
 * Raise the deadline escalation for entries past their review window.
 *
 * Spans tenants through `withPlatformTx` for the read, the same way the
 * retention and reminder sweeps do, then writes per tenant so every write is
 * inside its own tenant's RLS context.
 *
 * **One logical alert per episode.** `escalatedAt` is stamped by a conditional
 * UPDATE, and only the rows that UPDATE actually changed are notified. Two
 * overlapping sweeps therefore produce one alert between them, not one each —
 * the stamp is taken by whichever transaction commits first and the other
 * matches zero rows.
 *
 * Entries with no configured review window are **not** escalated and **not**
 * hidden. There is no deadline to be past, and inventing one would be inventing
 * an SLA nobody approved. They stay in the queue flagged as needing
 * configuration.
 */
export async function sweepTriageDeadlines(now = new Date()): Promise<{ escalated: number }> {
  /**
   * Raw, because this read deliberately spans tenants and the tenant guard has
   * no way to express that on a Prisma call — the same reason the retention and
   * reminder sweeps are written this way. `withPlatformTx` asserts the
   * `app.platform_admin` flag the RLS policies name, so the rows are reachable;
   * every *write* below is issued per tenant inside that tenant's own context.
   */
  const due = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<DueEntry[]>`
      SELECT "id", "tenantId", "leadId", "responsibleUserId", "reason"::text AS "reason", "detail"
        FROM "LeadTriageEntry"
       WHERE "status" = 'WAITING' AND "escalatedAt" IS NULL
         AND "reviewPolicyMissing" = false AND "reviewDueAt" <= ${now}
       ORDER BY "reviewDueAt" ASC
       LIMIT 500
    `,
  );
  if (due.length === 0) return { escalated: 0 };

  let escalated = 0;
  for (const entry of due) {
    const claimed = await withTx(entry.tenantId, (tx) =>
      tx.leadTriageEntry.updateMany({
        // Re-read the state: between the sweep's SELECT and this UPDATE the lead
        // may have been assigned, which resolves the entry and makes the alert
        // wrong rather than merely late.
        where: { tenantId: entry.tenantId, id: entry.id, status: 'WAITING', escalatedAt: null },
        data: { escalatedAt: now },
      }),
    );
    if (claimed.count === 0) continue;
    escalated += 1;

    if (!entry.responsibleUserId) {
      // Nobody is accountable — which is itself the exception to report, and is
      // reported by the entry's own `routingPolicyMissing` flag on the queue.
      // Escalating to an arbitrary administrator would widen access to paper
      // over a configuration gap.
      logger.warn({ tenantId: entry.tenantId, entryId: entry.id }, 'triage entry overdue with nobody accountable');
      continue;
    }

    try {
      await withTx(entry.tenantId, (tx) =>
        tx.notification.create({
          data: {
            tenantId: entry.tenantId,
            userId: entry.responsibleUserId!,
            kind: 'LEAD_TRIAGE_OVERDUE',
            title: 'A lead has been waiting past its review time',
            body: explainReason(entry.reason as TriageReason, (entry.detail ?? {}) as TriageDetail),
            objectType: 'lead',
            recordId: entry.leadId,
            priority: 'HIGH',
            channels: ['in_app'],
          },
        }),
      );
    } catch (err) {
      logger.warn({ err, tenantId: entry.tenantId, entryId: entry.id }, 'triage escalation notification failed');
    }
  }
  return { escalated };
}

/**
 * Close entries that no longer describe reality.
 *
 * A waiting entry is stale when its lead has since been given an owner by some
 * other path — bulk allocation, a direct edit, an import — or when the lead has
 * been deleted. Neither of those goes through `assignFromTriage`, so without
 * this the queue would show work that is already done, which is the fastest way
 * to teach people to ignore a queue.
 *
 * Idempotent: a second run finds nothing to do.
 */
export async function sweepStaleTriage(now = new Date()): Promise<{ resolved: number }> {
  const stale = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<{ id: string; tenantId: string; leadId: string; gone: boolean }[]>`
      SELECT e."id", e."tenantId", e."leadId", (l."deletedAt" IS NOT NULL) AS "gone"
        FROM "LeadTriageEntry" e
        JOIN "Lead" l ON l."id" = e."leadId" AND l."tenantId" = e."tenantId"
       WHERE e."status" = 'WAITING'
         AND (l."ownerId" IS NOT NULL OR l."deletedAt" IS NOT NULL)
       LIMIT 500
    `,
  );
  if (stale.length === 0) return { resolved: 0 };

  let resolved = 0;
  for (const entry of stale) {
    const gone = entry.gone;
    const changed = await withTx(entry.tenantId, (tx) =>
      tx.leadTriageEntry.updateMany({
        where: { tenantId: entry.tenantId, id: entry.id, status: 'WAITING' },
        data: {
          status: gone ? 'CANCELLED' : 'ASSIGNED',
          resolvedAt: now,
          resolution: gone ? 'Lead was deleted while waiting' : 'Lead was assigned outside the queue',
        },
      }),
    );
    resolved += changed.count;
  }
  logger.info({ resolved }, 'stale triage entries closed');
  return { resolved };
}

/**
 * Re-send the opening notification for entries whose enqueue never happened.
 *
 * The opening notification is deliberately sent *after* the triage transaction
 * commits — enqueueing inside it would tell a manager about a queue entry that
 * then rolled back. The cost of that ordering is a window where the entry exists
 * and the notification does not, so `notifiedAt` records which entries have been
 * announced and this closes the gap rather than leaving it to chance.
 */
export async function sweepTriageNotifications(now = new Date()): Promise<{ notified: number }> {
  const pending = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<DueEntry[]>`
      SELECT "id", "tenantId", "leadId", "responsibleUserId", "reason"::text AS "reason", "detail"
        FROM "LeadTriageEntry"
       WHERE "status" = 'WAITING' AND "notifiedAt" IS NULL AND "responsibleUserId" IS NOT NULL
       ORDER BY "openedAt" ASC
       LIMIT 500
    `,
  );

  let notified = 0;
  for (const entry of pending) {
    const claimed = await withTx(entry.tenantId, (tx) =>
      tx.leadTriageEntry.updateMany({
        where: { tenantId: entry.tenantId, id: entry.id, status: 'WAITING', notifiedAt: null },
        data: { notifiedAt: now },
      }),
    );
    if (claimed.count === 0) continue;

    try {
      await withTx(entry.tenantId, (tx) =>
        tx.notification.create({
          data: {
            tenantId: entry.tenantId,
            userId: entry.responsibleUserId!,
            kind: 'LEAD_TRIAGE_WAITING',
            title: 'A lead could not be assigned automatically',
            body: explainReason(entry.reason as TriageReason, (entry.detail ?? {}) as TriageDetail),
            objectType: 'lead',
            recordId: entry.leadId,
            priority: 'MEDIUM',
            channels: ['in_app'],
          },
        }),
      );
      notified += 1;
    } catch (err) {
      // Give it back so the next sweep retries rather than losing the notice.
      await withTx(entry.tenantId, (tx) =>
        tx.leadTriageEntry.updateMany({
          where: { tenantId: entry.tenantId, id: entry.id },
          data: { notifiedAt: null },
        }),
      ).catch(() => undefined);
      logger.warn({ err, tenantId: entry.tenantId, entryId: entry.id }, 'triage opening notification failed');
    }
  }
  return { notified };
}

/** Arm the sweeps. Called by the maintenance worker's scheduler. */
export async function scheduleTriageSweeps() {
  await enqueue('maintenance', 'triage-sweep', { at: new Date().toISOString() }, { fresh: true });
}

export type { TxClient };
