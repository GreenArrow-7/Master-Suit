/**
 * One answer to "may this person be given a lead right now", for every path
 * that hands one out.
 *
 * There were three different answers before this file, and they disagreed:
 *
 *   - `assignLead` (the round-robin worker) checked **nothing**. It took
 *     `pool[(last + 1) % pool.length]` and assigned. A deactivated employee,
 *     somebody on approved leave, somebody over their daily quota — all of them
 *     could be handed a new lead by the automatic path.
 *   - `nextDistributionOwner` (the social path) checked `status = ACTIVE` and
 *     `deletedAt IS NULL`, and nothing else.
 *   - `headroom` (bulk allocation) checked quotas, capacity, `isAvailable` and
 *     `onLeaveUntil` — but **not** account status, so a SUSPENDED user still
 *     came back with headroom.
 *
 * Three paths, three definitions of eligible, and the strictest of them still
 * missed something. This is the one definition; the three call it.
 *
 * ── Leave, honestly ─────────────────────────────────────────────────────────
 *
 * `User.onLeaveUntil` and `User.isAvailable` are read by the old headroom check
 * and are written by **nothing in the application** — only by the seed. Approving
 * leave in the HR module never touched them, so "on leave" in the allocator has
 * never meant "on leave" in the HRMS.
 *
 * So leave is derived from the record that HR actually maintains: an APPROVED
 * `HrLeaveRequest` whose date range covers now, reached through
 * `EmployeeProfile` → `WorkspaceMembership` → `User`. The two denormalised
 * columns are still honoured where they are set, because a workspace may be
 * using them deliberately as a manual override, but they are no longer the only
 * thing consulted.
 *
 * What is *not* decided here: which leave **types** block allocation. Today every
 * approved leave blocks, which is the safe direction, and D-5 in
 * `docs/product/DECISIONS-REQUIRED.md` is the open question. When it is answered,
 * the answer goes in `HrLeaveType`, not in a constant in this file.
 */
import { prisma, type TxClient } from '@/lib/db';

/**
 * What `withTx` hands its callback, under the name
 * `scripts/check-raw-sql-scope.mjs` looks for.
 *
 * That checker reads the parameter's *annotation* to decide whether a raw
 * statement runs inside a tenant transaction — and a raw statement it cannot
 * classify is one nobody is checking. `TxClient` is the right type and does not
 * say so in text the checker can see, so it is named here rather than left
 * ambiguous.
 */
type TransactionClient = TxClient;

/** A read-only client: the request-scoped one, or a transaction. */
type Reader = Pick<typeof prisma, 'user' | 'lead' | 'leadAssignmentHistory' | 'hrLeaveRequest'>;

/**
 * Why somebody may not be given a lead.
 *
 * A code rather than a sentence, because the manager queue groups by it and the
 * tests assert on it. The human sentence is built from the code plus its detail
 * at the point of display.
 */
export type IneligibilityCode =
  | 'NOT_FOUND'
  | 'DELETED'
  | 'NOT_ACTIVE'
  | 'MEMBERSHIP_INACTIVE'
  | 'EMPLOYMENT_ENDED'
  | 'NOT_IN_TEAM'
  | 'MARKED_UNAVAILABLE'
  | 'ON_APPROVED_LEAVE'
  /** What an HR-sourced blocker becomes for a Sales viewer. See `redactForSales`. */
  | 'UNAVAILABLE'
  | 'QUOTA_REACHED'
  | 'AT_CAPACITY';

export interface Ineligibility {
  code: IneligibilityCode;
  /** Short, and safe for whoever it was redacted for. See `redactForSales`. */
  detail: string;
  /**
   * True when this blocker was softened on the way out: the real reason is HR
   * data and the reader is not authorised for it.
   */
  redacted?: boolean;
}

/**
 * Blockers whose specifics are HR records, not Sales operations.
 *
 * A sales manager needs to know somebody cannot take a lead. They do not need
 * that person's leave dates, and they certainly do not need an employment
 * status that may say `TERMINATED` or `ON_NOTICE`. Those are HR facts that
 * happen to be *reachable* from an allocation decision, and reachable is not the
 * same as disclosable.
 *
 * The un-redacted detail is never persisted into the triage entry either — it
 * would sit in a JSON column that anybody with queue access can read, and a
 * redaction applied only at render time is one somebody eventually forgets.
 */
const HR_SOURCED: ReadonlySet<IneligibilityCode> = new Set([
  'ON_APPROVED_LEAVE',
  'EMPLOYMENT_ENDED',
  'MARKED_UNAVAILABLE',
]);

/**
 * What a Sales viewer is allowed to be told.
 *
 * `mayReadHr` is the caller's answer to "does this person hold an HR
 * permission" — resolved from the actor's own grants, never assumed. Without
 * it, an HR-sourced blocker collapses to the one word that is both true and
 * safe: unavailable.
 */
export function redactForSales(blockers: Ineligibility[], mayReadHr: boolean): Ineligibility[] {
  if (mayReadHr) return blockers;
  const out: Ineligibility[] = [];
  let softened = false;
  for (const b of blockers) {
    if (!HR_SOURCED.has(b.code)) {
      out.push(b);
      continue;
    }
    // One "unavailable" however many HR reasons there were: three of them is
    // itself a disclosure about how much is going on with somebody.
    if (!softened) {
      softened = true;
      out.push({ code: 'UNAVAILABLE', detail: 'unavailable', redacted: true });
    }
  }
  return out;
}

export interface Eligibility {
  userId: string;
  eligible: boolean;
  /** Empty when eligible. */
  blockers: Ineligibility[];
  /** How many more they may take. `null` means no limit is configured. */
  available: number | null;
}

/**
 * Which checks apply. Straight off `DistributionRule`, whose four `respect*`
 * flags have been in the schema since the beginning and were read by nothing.
 *
 * `respectWorkingHours` is deliberately absent: there is no working-hours model
 * to consult, so honouring it would mean inventing one. `describePolicy` reports
 * it as unsupported rather than silently treating it as satisfied.
 */
export interface EligibilityPolicy {
  respectLeave: boolean;
  respectQuotas: boolean;
  respectCapacity: boolean;
  /** Candidates must belong to this team, when the rule scopes to one. */
  requireTeamId?: string | null;
}

export const DEFAULT_POLICY: EligibilityPolicy = {
  respectLeave: true,
  respectQuotas: true,
  respectCapacity: true,
};

export function policyFromRule(rule: {
  respectLeave: boolean;
  respectQuotas: boolean;
  respectCapacity: boolean;
}): EligibilityPolicy {
  return {
    respectLeave: rule.respectLeave,
    respectQuotas: rule.respectQuotas,
    respectCapacity: rule.respectCapacity,
  };
}

/** Configuration a workspace has switched on that this build cannot honour. */
export function unsupportedPolicy(rule: { respectWorkingHours: boolean }): string[] {
  return rule.respectWorkingHours ? ['respectWorkingHours — no working-hours schedule exists to consult; ignored'] : [];
}

const startOfUtcDay = (now: Date) => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const daysBefore = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000);

/**
 * Assess a set of candidates in one pass.
 *
 * Batched rather than per-user because the round-robin walks a pool and the
 * manager queue explains a whole pool at once; asking per user turns a rotation
 * of twenty into sixty queries.
 *
 * `client` takes a transaction so the *same* rule can be re-run inside the
 * assignment transaction — which is the point of §4's "re-check inside the
 * transaction". Outside one it reads through the request-scoped client.
 */
export async function assessEligibility(
  tenantId: string,
  userIds: string[],
  policy: EligibilityPolicy = DEFAULT_POLICY,
  now: Date = new Date(),
  client: Reader = prisma,
): Promise<Eligibility[]> {
  if (userIds.length === 0) return [];

  const users = await client.user.findMany({
    where: { tenantId, id: { in: userIds } },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      isAvailable: true,
      onLeaveUntil: true,
      dailyLeadQuota: true,
      weeklyLeadQuota: true,
      monthlyLeadQuota: true,
      activeLeadCapacity: true,
      teams: policy.requireTeamId ? { select: { teamId: true } } : false,
      workspaceMembership: {
        select: {
          status: true,
          employee: { select: { employmentStatus: true, exitedOn: true, id: true } },
        },
      },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  // Only the accounts that got past the cheap checks need the expensive ones.
  const live = users.filter((u) => u.deletedAt === null && u.status === 'ACTIVE').map((u) => u.id);

  const employeeIds = users
    .map((u) => u.workspaceMembership?.employee?.id)
    .filter((id): id is string => typeof id === 'string');

  const [onLeave, dayRows, weekRows, monthRows, heldRows] = await Promise.all([
    policy.respectLeave && employeeIds.length > 0
      ? client.hrLeaveRequest.findMany({
          where: {
            tenantId,
            employeeId: { in: employeeIds },
            status: 'APPROVED',
            cancelledAt: null,
            startDate: { lte: now },
            endDate: { gte: now },
          },
          select: { employeeId: true, endDate: true },
        })
      : Promise.resolve([] as { employeeId: string; endDate: Date }[]),
    counts(client, tenantId, live, policy.respectQuotas ? startOfUtcDay(now) : null),
    counts(client, tenantId, live, policy.respectQuotas ? daysBefore(now, 7) : null),
    counts(client, tenantId, live, policy.respectQuotas ? daysBefore(now, 30) : null),
    policy.respectCapacity && live.length > 0
      ? client.lead.groupBy({
          by: ['ownerId'],
          where: { tenantId, ownerId: { in: live }, deletedAt: null, stage: { is: { category: 'OPEN' } } },
          _count: { _all: true },
        })
      : Promise.resolve([] as { ownerId: string | null; _count: { _all: number } }[]),
  ]);

  const leaveByEmployee = new Map(onLeave.map((l) => [l.employeeId, l.endDate]));
  const used = (rows: { toOwnerId: string | null; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.toOwnerId === id)?._count._all ?? 0;

  return userIds.map((userId) => {
    const u = byId.get(userId);
    const blockers: Ineligibility[] = [];

    if (!u)
      return {
        userId,
        eligible: false,
        blockers: [{ code: 'NOT_FOUND' as const, detail: 'not in this workspace' }],
        available: 0,
      };
    if (u.deletedAt) blockers.push({ code: 'DELETED', detail: 'account removed' });

    // INVITED has not accepted yet; SUSPENDED and DEACTIVATED must never receive
    // work. This is the check `assignLead` did not have.
    if (u.status !== 'ACTIVE') {
      blockers.push({ code: 'NOT_ACTIVE', detail: `account is ${u.status.toLowerCase()}` });
    }
    if (u.workspaceMembership && u.workspaceMembership.status !== 'ACTIVE') {
      blockers.push({
        code: 'MEMBERSHIP_INACTIVE',
        detail: `workspace access is ${u.workspaceMembership.status.toLowerCase()}`,
      });
    }

    const employee = u.workspaceMembership?.employee;
    if (employee) {
      const ended = employee.exitedOn !== null && employee.exitedOn <= now;
      if (ended || employee.employmentStatus !== 'ACTIVE') {
        blockers.push({
          code: 'EMPLOYMENT_ENDED',
          detail: ended ? 'employment ended' : `employment is ${employee.employmentStatus.toLowerCase()}`,
        });
      }
    }

    if (policy.requireTeamId) {
      const inTeam = (u.teams as { teamId: string }[] | undefined)?.some((t) => t.teamId === policy.requireTeamId);
      if (!inTeam) blockers.push({ code: 'NOT_IN_TEAM', detail: 'not a member of the routed team' });
    }

    if (policy.respectLeave) {
      const until = employee ? leaveByEmployee.get(employee.id) : undefined;
      if (until) {
        blockers.push({
          code: 'ON_APPROVED_LEAVE',
          detail: `approved leave until ${until.toISOString().slice(0, 10)}`,
        });
      } else if (u.onLeaveUntil && u.onLeaveUntil > now) {
        // The denormalised column, honoured as a manual override where a
        // workspace sets it. See the header: nothing writes it today.
        blockers.push({
          code: 'ON_APPROVED_LEAVE',
          detail: `marked on leave until ${u.onLeaveUntil.toISOString().slice(0, 10)}`,
        });
      }
      if (!u.isAvailable) blockers.push({ code: 'MARKED_UNAVAILABLE', detail: 'marked unavailable' });
    }

    // Quotas are computed even for a blocked user, because "at quota *and* on
    // leave" is more useful to a manager than whichever the code checked first.
    const limits: number[] = [];
    const quota = (configured: number | null, spent: number, label: string) => {
      if (configured === null) return;
      const left = Math.max(0, configured - spent);
      limits.push(left);
      if (left === 0) blockers.push({ code: 'QUOTA_REACHED', detail: `${label} quota ${spent}/${configured}` });
    };
    if (policy.respectQuotas) {
      quota(u.dailyLeadQuota, used(dayRows, userId), 'daily');
      quota(u.weeklyLeadQuota, used(weekRows, userId), 'weekly');
      quota(u.monthlyLeadQuota, used(monthRows, userId), 'monthly');
    }
    if (policy.respectCapacity && u.activeLeadCapacity !== null) {
      const held = heldRows.find((r) => r.ownerId === userId)?._count._all ?? 0;
      const left = Math.max(0, u.activeLeadCapacity - held);
      limits.push(left);
      if (left === 0) {
        blockers.push({ code: 'AT_CAPACITY', detail: `holding ${held}/${u.activeLeadCapacity} open leads` });
      }
    }

    const hardBlocked = blockers.some((b) => b.code !== 'QUOTA_REACHED' && b.code !== 'AT_CAPACITY');
    // No quota configured means no limit, not zero — defaulting an unset quota
    // to zero would stop every allocation in a workspace that never set one.
    const available = hardBlocked ? 0 : limits.length === 0 ? null : Math.min(...limits);

    return { userId, eligible: blockers.length === 0, blockers, available };
  });
}

async function counts(client: Reader, tenantId: string, userIds: string[], since: Date | null) {
  if (!since || userIds.length === 0) return [] as { toOwnerId: string | null; _count: { _all: number } }[];
  return client.leadAssignmentHistory.groupBy({
    by: ['toOwnerId'],
    where: { tenantId, toOwnerId: { in: userIds }, createdAt: { gte: since } },
    _count: { _all: true },
  });
}

/**
 * The capacity re-check, inside the assignment transaction.
 *
 * `assessEligibility` above reads without locking, which is correct for
 * *explaining* a pool and wrong for *deciding* an assignment: two workers can
 * both read "one slot left" and both take it.
 *
 * So the assignment path locks the `User` row first, and only then counts. The
 * lock is what serialises two assignments to the same agent; the count is then
 * guaranteed to include anything the other transaction committed and to exclude
 * anything it has not.
 *
 * **Lock ordering for this subsystem: `User`, then `Lead`.** Several users are
 * locked in ascending id order. Nothing here may take a `Lead` lock before a
 * `User` lock — see `docs/product/NEXT-ACTION-AND-REMINDER-CONTRACTS.md` §2.6,
 * where the obligation subsystem's opposite ordering is reconciled with this one.
 */
export async function lockAndVerify(
  tx: TransactionClient,
  tenantId: string,
  userId: string,
  policy: EligibilityPolicy,
  now: Date = new Date(),
): Promise<Eligibility> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const [verdict] = await assessEligibility(tenantId, [userId], policy, now, tx as unknown as Reader);
  return (
    verdict ?? {
      userId,
      eligible: false,
      blockers: [{ code: 'NOT_FOUND', detail: 'not in this workspace' }],
      available: 0,
    }
  );
}
