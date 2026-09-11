/**
 * What a lead is next owed, and who is allowed to know it.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * `Lead.nextFollowUpAt` is declared, indexed, and read by every "overdue"
 * surface in Sales. Nothing in `src/` ever wrote it. Only the seed did, so the
 * column has always been the seed's opinion, frozen — and the surfaces that
 * read it have been reporting that opinion as fact.
 *
 * ── Two values, not one ─────────────────────────────────────────────────────
 *
 * A lead with a rep's callback due Thursday and a manager's review due Tuesday
 * is "waiting on us since Tuesday" on an exception queue and "your callback is
 * Thursday" in the rep's own list. One number cannot be both. Showing the
 * lead-wide number in an agent's list tells them they are late for somebody
 * else's commitment.
 *
 *   - The **stored column** is the unrestricted aggregate: the earliest open
 *     obligation on the lead, whoever owns it. It is a cache, maintained under
 *     the lead's row lock, and it is what reconciliation and the drift canary
 *     compare against.
 *   - The **scoped value** is derived per request from the obligations the
 *     viewer is actually allowed to see, and is what every screen renders.
 *
 * ── Why lead visibility is not enough ───────────────────────────────────────
 *
 * It is tempting to say the stored column discloses nothing new, because it is
 * "a fact about the lead" and every reader already applies lead visibility.
 * That is false against this application's own seeded roles:
 *
 *   - **Marketing Manager** holds `leads:VIEW = ORGANIZATION` and *no* `tasks`
 *     grant at all, so `tasks:VIEW` resolves to NONE. Every lead, no tasks.
 *   - **Marketing Executive** holds `leads:VIEW = TEAM` and `tasks:VIEW = OWN`.
 *     The team's leads, only their own tasks.
 *
 * For either of them the stored column answers a question about a task they may
 * not open. So an obligation reaches an aggregate only if the viewer could have
 * seen that obligation directly, and lead visibility is applied on top, never
 * instead.
 *
 * The two stores are governed by different modules, which is the application's
 * existing arrangement rather than a new one: a `Task` is read under `tasks`
 * (see `lib/ai/assistant/tools.ts`), a `FollowUpTask` under `leads` (see
 * `api/v1/follow-ups`). A store whose scope is NONE contributes nothing.
 *
 * ── The due-time boundary, stated once ──────────────────────────────────────
 *
 * `overdue` is `dueAt < now`, strictly. An obligation due at exactly `now` is
 * **scheduled, not overdue** — the boundary belongs to the future side. Every
 * count, filter, sort, rendered date and drilldown in this package uses these
 * three predicates and no others, which is what makes them agree.
 */
import type { Prisma, TaskStatus } from '@prisma/client';
import { prisma, type TxClient } from '@/lib/db';
import { scopeFor, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';

/** Named for `scripts/check-raw-sql-scope.mjs`. See distribution/eligibility.ts. */
type TransactionClient = TxClient;

/**
 * Open is `OPEN`, `IN_PROGRESS` **and** `RESCHEDULED`.
 *
 * `api/v1/follow-ups/[id]` stamps `RESCHEDULED` on any open follow-up whose date
 * moves, so treating open as `status = 'OPEN'` would exclude exactly the
 * obligations most likely to be late. Four existing readers already use the
 * triple; this is the same set, named once.
 */
export const OPEN_STATUSES: readonly TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'];

/** The three states a lead can be in. Mutually exclusive and exhaustive. */
export type FollowUpState = 'overdue' | 'scheduled' | 'unscheduled';

/** The boundary, in one place. Exactly-now is scheduled. */
export function stateOf(dueAt: Date | null | undefined, now: Date): FollowUpState {
  if (!dueAt) return 'unscheduled';
  return dueAt.getTime() < now.getTime() ? 'overdue' : 'scheduled';
}

/**
 * What to render when the viewer has no visible obligation on a lead.
 *
 * **It must not say whether work exists.** An earlier revision distinguished
 * "nobody has scheduled anything" from "somebody else is handling this" by
 * reading the unrestricted stored column as a boolean. That is a disclosure:
 * it answers, for every lead on screen, whether a colleague has work on it —
 * derived from a cache the viewer is not entitled to read. It is gone.
 *
 * What is left is an accurate statement about the viewer's own position, which
 * is true whether or not anyone else is working the lead. The wording follows
 * the reach, so it never claims more absence than the viewer can actually see:
 * only a viewer who can see every obligation is told that nothing is scheduled.
 */
export function emptyFollowUpLabel(access: ObligationAccess, view: 'personal' | 'scope', viewerId?: string): string {
  if (access.unrestricted) return 'No action scheduled';
  if (view === 'personal') return 'No action assigned to you';
  // A rep's "team" is themselves — `scope` and `personal` resolve to the same
  // owner set — so telling them nothing is assigned to their team is both
  // confusing and slightly wrong. The wording follows the resolved reach, not
  // the name of the view.
  const onlySelf = (set: OwnerSet) =>
    set.kind === 'none' || (set.kind === 'ids' && set.ids.length === 1 && set.ids[0] === viewerId);
  if (viewerId && onlySelf(access.task) && onlySelf(access.followUp)) return 'No action assigned to you';
  return 'No action assigned to your team';
}

// ───────────────────────────────────────────────────────────────────────────
// Write path
// ───────────────────────────────────────────────────────────────────────────

/**
 * Take the lead row locks, in ascending id order.
 *
 * **Lock order for this subsystem: `Lead` first, then obligation rows; several
 * leads in ascending id order.** Assignment writes take `User` then `Lead` (see
 * `services/distribution/eligibility.ts`), so an obligation write must never
 * take a `User` lock while holding a `Lead` lock. Nothing here does.
 *
 * Ascending order is what makes two concurrent moves between the same pair of
 * leads block rather than deadlock.
 */
export async function lockLeads(
  tx: TransactionClient,
  tenantId: string,
  leadIds: readonly (string | null | undefined)[],
): Promise<string[]> {
  const ids = [...new Set(leadIds.filter((id): id is string => !!id))].sort();
  if (ids.length === 0) return [];
  await tx.$queryRaw`
    SELECT "id" FROM "Lead"
     WHERE "tenantId" = ${tenantId} AND "id" = ANY(${ids}::text[])
     ORDER BY "id"
     FOR UPDATE
  `;
  return ids;
}

/**
 * Recompute the stored column for one lead, in the caller's transaction.
 *
 * Must be called with the lead already locked by `lockLeads`. Under
 * `READ COMMITTED` the `MIN` subquery takes a snapshot at statement start and
 * locks nothing, so the statement is not itself isolation — the lead lock is.
 * Every writer takes it before touching that lead's obligations, which
 * serialises them per lead; contention is per-lead and low.
 */
export async function recomputeNextFollowUp(
  tx: TransactionClient,
  tenantId: string,
  leadId: string,
): Promise<Date | null> {
  const rows = await tx.$queryRaw<{ nextFollowUpAt: Date | null }[]>`
    UPDATE "Lead" l
       SET "nextFollowUpAt" = (
             SELECT MIN(d."dueAt") FROM (
               SELECT t."dueAt" FROM "Task" t
                WHERE t."tenantId" = ${tenantId} AND t."leadId" = ${leadId}
                  AND t."deletedAt" IS NULL
                  AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
               UNION ALL
               SELECT f."dueAt" FROM "FollowUpTask" f
                WHERE f."tenantId" = ${tenantId} AND f."leadId" = ${leadId}
                  AND f."deletedAt" IS NULL
                  AND f."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
             ) d
           )
     WHERE l."tenantId" = ${tenantId} AND l."id" = ${leadId}
    RETURNING l."nextFollowUpAt"
  `;
  return rows[0]?.nextFollowUpAt ?? null;
}

/**
 * Lock the affected leads, run the mutation, recompute — all in one transaction.
 *
 * Pass both ids for a move. `leadIds` may contain nulls: an obligation that is
 * not attached to a lead affects no stored column, and `lockLeads` drops them.
 */
export async function withRecompute<T>(
  tx: TransactionClient,
  tenantId: string,
  leadIds: readonly (string | null | undefined)[],
  mutate: () => Promise<T>,
): Promise<T> {
  const locked = await lockLeads(tx, tenantId, leadIds);
  const result = await mutate();
  for (const id of locked) await recomputeNextFollowUp(tx, tenantId, id);
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Read path
// ───────────────────────────────────────────────────────────────────────────

/**
 * Which owners' obligations the viewer may see, per store.
 *
 * `all` is ORGANIZATION scope; `none` is a module the viewer holds no grant on.
 */
export type OwnerSet = { kind: 'all' } | { kind: 'none' } | { kind: 'ids'; ids: string[] };

export interface ObligationAccess {
  task: OwnerSet;
  followUp: OwnerSet;
  /**
   * True when both stores resolve to `all`, and only then may a surface read the
   * stored column directly — for that viewer the unrestricted aggregate and the
   * permitted aggregate are the same number.
   */
  unrestricted: boolean;
}

/**
 * Personal describes the signed-in user's own authorized obligations; scope
 * describes those within their authorized team or organizational reach.
 *
 * Personal is not simply "ownerId = me": a viewer with no grant on a store has
 * no authorized obligations in it, so it stays `none` rather than narrowing to
 * themselves. Otherwise a revoked grant would still leak through the personal
 * view, which is the sort of thing that is only ever noticed later.
 */
export async function obligationAccess(
  ctx: Ctx,
  view: 'personal' | 'scope',
  db: TxClient | typeof prisma = prisma,
): Promise<ObligationAccess> {
  const resolve = async (permissionModule: string): Promise<OwnerSet> => {
    const scope = scopeFor(ctx, permissionModule, 'VIEW');
    if (scope === 'NONE') return { kind: 'none' };
    if (view === 'personal') return { kind: 'ids', ids: [ctx.actor.id] };
    if (scope === 'ORGANIZATION') return { kind: 'all' };
    return { kind: 'ids', ids: await resolveOwnerIds(ctx, scope, db) };
  };
  // `Task` is read under `tasks`, `FollowUpTask` under `leads` — see the header.
  const [task, followUp] = await Promise.all([resolve('tasks'), resolve('leads')]);
  return { task, followUp, unrestricted: task.kind === 'all' && followUp.kind === 'all' };
}

/**
 * The owner predicate for one store.
 *
 * An obligation with no owner is nobody's commitment, so it reaches a scoped
 * view only at ORGANIZATION reach, where the viewer sees everything anyway.
 * (`Task.ownerId` is nullable; `FollowUpTask.ownerId` is not.)
 */
/**
 * The subset of columns both stores share, spelled once.
 *
 * `Task` and `FollowUpTask` are separate Prisma models, so their generated
 * `WhereInput` types are nominally different even where the columns are
 * identical. These five fields exist on both with the same types, which is what
 * lets one predicate drive both branches of the union — and keeps the two from
 * drifting into two slightly different definitions of "open".
 */
interface ObligationWhere {
  ownerId?: { in: string[] };
  leadId?: { in: string[] };
  deletedAt?: null;
  status?: { in: TaskStatus[] };
  dueAt?: { lt: Date };
}

function ownerWhere(set: OwnerSet): ObligationWhere | null {
  if (set.kind === 'none') return null;
  if (set.kind === 'all') return {};
  return { ownerId: { in: set.ids } };
}

function openWhere(set: OwnerSet, extra: ObligationWhere = {}): ObligationWhere | null {
  const owner = ownerWhere(set);
  if (!owner) return null;
  return { ...owner, ...extra, deletedAt: null, status: { in: [...OPEN_STATUSES] } };
}

/** A predicate that matches no lead, without needing a special case at the call site. */
const IMPOSSIBLE: Prisma.LeadWhereInput = { id: { in: [] } };

/**
 * A `Lead` where-fragment selecting one of the three states, for the viewer.
 *
 * Expressed with relation filters so the count, the filter and the page query
 * are the same predicate rather than three that agree by hand. `Lead.tasks`
 * already existed; `Lead.followUpTasks` was added with the foreign key that
 * `FollowUpTask.leadId` had always lacked.
 *
 * A viewer who may see neither store has no obligations at all, so `overdue`
 * and `scheduled` match nothing and everything is `unscheduled` — which is the
 * truthful answer to "what am I allowed to know is owed here".
 */
export function obligationWhere(access: ObligationAccess, state: FollowUpState, now: Date): Prisma.LeadWhereInput {
  const overdue = { dueAt: { lt: now } };
  const anyOpen: Prisma.LeadWhereInput[] = [];
  const anyOverdue: Prisma.LeadWhereInput[] = [];
  const noneOpen: Prisma.LeadWhereInput[] = [];
  const noneOverdue: Prisma.LeadWhereInput[] = [];

  const t = openWhere(access.task);
  if (t) {
    const some = t as Prisma.TaskWhereInput;
    const late = { ...t, ...overdue } as Prisma.TaskWhereInput;
    anyOpen.push({ tasks: { some } });
    anyOverdue.push({ tasks: { some: late } });
    noneOpen.push({ tasks: { none: some } });
    noneOverdue.push({ tasks: { none: late } });
  }
  const f = openWhere(access.followUp);
  if (f) {
    const some = f as Prisma.FollowUpTaskWhereInput;
    const late = { ...f, ...overdue } as Prisma.FollowUpTaskWhereInput;
    anyOpen.push({ followUpTasks: { some } });
    anyOverdue.push({ followUpTasks: { some: late } });
    noneOpen.push({ followUpTasks: { none: some } });
    noneOverdue.push({ followUpTasks: { none: late } });
  }

  switch (state) {
    case 'overdue':
      // Earliest visible obligation is late ⟺ any visible obligation is late.
      return anyOverdue.length ? { OR: anyOverdue } : IMPOSSIBLE;
    case 'scheduled':
      // Something is owed, and none of it is late yet.
      return anyOpen.length ? { AND: [{ OR: anyOpen }, ...noneOverdue] } : IMPOSSIBLE;
    case 'unscheduled':
      // Nothing the viewer may see is open on this lead.
      return noneOpen.length ? { AND: noneOpen } : {};
  }
}

/**
 * The scoped next-follow-up for a bounded set of leads.
 *
 * Two grouped queries for the whole page rather than one per row — `groupBy`
 * with `leadId IN (…)` over the `(tenantId, leadId, status, dueAt)` indexes
 * added alongside this. Leads with nothing visible and open are absent from the
 * map, which is `unscheduled`; a caller wanting a total should use
 * `obligationWhere` so the count and the rendered dates come from one
 * definition.
 */
export async function scopedNextFollowUp(
  tenantId: string,
  leadIds: readonly string[],
  access: ObligationAccess,
  db: TxClient | typeof prisma = prisma,
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  const ids = [...new Set(leadIds)];
  if (ids.length === 0) return out;

  const take = (leadId: string | null, dueAt: Date | null) => {
    if (!leadId || !dueAt) return;
    const seen = out.get(leadId);
    if (!seen || dueAt < seen) out.set(leadId, dueAt);
  };

  const scoped: ObligationWhere = { leadId: { in: ids } };
  const t = openWhere(access.task, scoped);
  const f = openWhere(access.followUp, scoped);

  type Grouped = { leadId: string | null; _min: { dueAt: Date | null } };
  const none: Promise<Grouped[]> = Promise.resolve([]);

  const [tasks, followUps] = await Promise.all([
    t
      ? (db.task.groupBy({
          by: ['leadId'],
          where: { tenantId, ...(t as Prisma.TaskWhereInput) },
          _min: { dueAt: true },
        }) as unknown as Promise<Grouped[]>)
      : none,
    f
      ? (db.followUpTask.groupBy({
          by: ['leadId'],
          where: { tenantId, ...(f as Prisma.FollowUpTaskWhereInput) },
          _min: { dueAt: true },
        }) as unknown as Promise<Grouped[]>)
      : none,
  ]);

  for (const r of tasks) take(r.leadId, r._min.dueAt);
  for (const r of followUps) take(r.leadId, r._min.dueAt);
  return out;
}

/**
 * Deterministic ordering for a page of leads by their scoped follow-up.
 *
 * Unscheduled leads sort last in both directions — "nothing owed" is not an
 * early date, and floating it to the top of an ascending sort is how a lead
 * nobody scheduled anything for gets mistaken for the most urgent one. Ties
 * break on lead id so the order is stable across requests.
 */
export function byScopedFollowUp<T extends { id: string }>(
  rows: readonly T[],
  due: ReadonlyMap<string, Date>,
  dir: 'asc' | 'desc',
): T[] {
  return [...rows].sort((a, b) => {
    const av = due.get(a.id);
    const bv = due.get(b.id);
    if (!av && !bv) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (!av) return 1;
    if (!bv) return -1;
    const cmp = av.getTime() - bv.getTime();
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
