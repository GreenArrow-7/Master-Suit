/**
 * "My priorities": the viewer's own work, ordered, each with the fact that put
 * it there.
 *
 * The landing page already told people the size of their backlog — "12 overdue
 * follow-ups", linking to a filtered list. That is a number, not a decision,
 * and a morning spent deciding which of the twelve matters is the morning this
 * is meant to give back.
 *
 * **The order is arithmetic on recorded facts. No model decides it.** This is
 * the same rule the call pipeline already follows for talk ratio and playbook
 * matching (`src/lib/ai/callMetrics.ts`): a model returns a plausible ordering
 * and nobody can tell a guess from a measurement afterwards. A model may later
 * *rephrase* a reason; it may never choose one item over another, and the
 * reason strings below are written in code so the screen still works with no
 * AI configured at all.
 *
 * Scope: every candidate is the viewer's **own** owned work (`ownerId`, or
 * `secondaryOwnerId`, which reaches a lead as the owner does). OWN is the floor
 * of every scope, so a person's own records are inside any grant they hold, and
 * nothing here can surface a record a wider query might have reached. The
 * page's own module and permission checks still run first.
 */
import type { TxClient } from '@/lib/db';
import { OPEN_FOLLOW_UP, followUpDueWhere, overdueFollowUpsWhere } from '@/lib/leads/followUpDue';
import { mergeWhere } from '@/lib/api/where';
import { OPEN_LEADS_WHERE } from '@/services/leads/closeOut';

/** What a priority row needs to render. No phone number: see `brief.ts`. */
export interface TodayItem {
  kind: 'sla' | 'overdue' | 'callback' | 'untouched' | 'idle';
  /** The lead this is about, for the link. */
  leadId: string;
  /** Who it is about — the lead's name, as the viewer may already read it. */
  title: string;
  /** Why it is here, naming a fact and when. Written in code, never generated. */
  reason: string;
  /** The one thing to do about it. */
  action: string;
  /** The timestamp the reason cites, so the row can say how stale it is. */
  at: Date | null;
  /** Higher sorts first. Pure function of the facts — see `weigh`. */
  weight: number;
}

/**
 * How many rows a person can actually act on before lunch.
 *
 * Not a page size. A ranked list of forty is the backlog again with extra
 * steps; the full lists are one tap away and that is where forty belongs.
 */
export const MAX_ITEMS = 7;

/** A lead is "quiet" after this long with nothing logged. */
export const IDLE_DAYS = 5;

/** Below this, a quiet lead is not worth displacing a promise to a customer. */
export const WARM_SCORE = 60;

const DAY_MS = 86_400_000;
const hoursSince = (at: Date, now: Date) => Math.max(0, (now.getTime() - at.getTime()) / 3_600_000);
const daysSince = (at: Date, now: Date) => Math.max(0, (now.getTime() - at.getTime()) / DAY_MS);

/**
 * The weight, and the whole of the ranking argument.
 *
 * The bands do not overlap, deliberately: a broken rule outranks every
 * judgement call, and a promise made to a customer outranks an opportunity
 * nobody was promised. Within a band the tie-break is how long it has been
 * waiting, so the ordering is stable and explicable to the person reading it —
 * "why is this first" always has an answer in the row's own reason text.
 *
 *   4000  SLA escalation      a rule the workspace set has already been broken
 *   3000  overdue follow-up   a commitment with a date that has passed
 *   2000  due today           a commitment with a date that has not
 *   1000  untouched lead      nobody has spoken to it yet
 *      0  quiet warm lead     a judgement call
 */
export function weigh(kind: TodayItem['kind'], at: Date | null, now: Date, score = 0): number {
  const waited = at ? Math.min(hoursSince(at, now), 999) : 0;
  switch (kind) {
    case 'sla':
      return 4000 + waited;
    case 'overdue':
      return 3000 + waited;
    case 'callback':
      // Flat: within the band, `rank` puts the earlier promise first, which is
      // the same thing and one fewer number to explain.
      return 2000;
    case 'untouched':
      return 1000 + waited;
    case 'idle':
      return Math.min(score, 100) + (at ? daysSince(at, now) : 0);
  }
}

/**
 * The order the screen renders: heaviest band first, then whatever has waited
 * longest (or comes soonest), then by name so the list never reshuffles
 * between two renders of the same data.
 *
 * One row per lead. The same lead can be escalated, overdue and quiet at once,
 * and three rows about one person is the backlog again with extra steps; the
 * heaviest reason wins, which is also the one worth saying. Deduplication
 * happens **before** the cap, or a lead with three reasons would eat three of
 * the seven places.
 *
 * Pure, so it is tested without a database.
 */
export function rank(items: TodayItem[]): TodayItem[] {
  const ordered = [...items].sort(
    (a, b) => b.weight - a.weight || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.title.localeCompare(b.title),
  );
  const seen = new Set<string>();
  const unique: TodayItem[] = [];
  for (const item of ordered) {
    if (seen.has(item.leadId)) continue;
    seen.add(item.leadId);
    unique.push(item);
  }
  return unique.slice(0, MAX_ITEMS);
}

/** "3 days ago", "4 hours ago", "earlier today" — the reason's time, in words. */
export function ago(at: Date, now: Date): string {
  const hours = hoursSince(at, now);
  if (hours < 1) return 'in the last hour';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(daysSince(at, now));
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "47 days", "6 hours" — a duration, for a sentence that supplies its own "for". */
export function lasted(at: Date, now: Date): string {
  const hours = hoursSince(at, now);
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hours`;
  const days = Math.round(daysSince(at, now));
  return days === 1 ? 'a day' : `${days} days`;
}

/** "14:30", on the workspace's clock. */
const atTime = (date: Date, timeZone: string) =>
  date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });

interface Loaded {
  items: TodayItem[];
}

/**
 * Read the viewer's own work and rank it.
 *
 * Takes the transaction client so it joins the landing page's single
 * transaction. Every query outside `withTx` is its own transaction on its own
 * pooled connection and the pool holds ten, so a dashboard that fans out is
 * the P2028 this codebase has already had once
 * (`tests/sales/screen-connections.spec.ts` measures a screen's peak).
 */
export async function agentToday(
  db: TxClient,
  tenantId: string,
  userId: string,
  timeZone: string,
  now = new Date(),
): Promise<Loaded> {
  // A lead this person works: theirs, or theirs as second owner, which reaches
  // a lead exactly as ownership does (`leadScope`).
  const mine = { OR: [{ ownerId: userId }, { secondaryOwnerId: userId }] };
  /**
   * Open work, as this workspace itself defines it.
   *
   * Two independent things close a lead and both must be honoured:
   *
   *   * `Lead.status` — INVALID, DUPLICATE or ARCHIVED, the close-out the lead
   *     list already filters with `OPEN_LEADS_WHERE`.
   *   * `LeadStage.category` — the workspace's **configured** pipeline
   *     behaviour. OPEN is work; CONVERSION is won; TERMINAL_NEGATIVE and
   *     TERMINAL_JUNK are finished. `namedFilters.untouched`, bulk allocation,
   *     recycling and scoring all gate on `category: 'OPEN'`, and this is the
   *     same gate.
   *
   * The pilot's first run put a lead in the **Invalid** stage at number one,
   * above a real overdue call. Its `status` was null, so close-out did not
   * catch it; its stage category was `TERMINAL_JUNK`, which is exactly the
   * signal that it is not work. Stage *names* mean nothing here — a workspace
   * may call a stage whatever it likes — but the category it assigns is the
   * answer, and it was already recorded.
   *
   * `mine` and `OPEN_LEADS_WHERE` are both `OR`s, so they go in an `AND`
   * rather than being spread into one object, where the second would replace
   * the first.
   */
  const OPEN_STAGE = { stage: { is: { category: 'OPEN' as const } } };
  const openLead = { tenantId, deletedAt: null, ...OPEN_STAGE, AND: [mine, OPEN_LEADS_WHERE] };
  /** A follow-up on a finished lead is not today's work either. */
  const onOpenLead = { lead: { is: { ...OPEN_STAGE, AND: [OPEN_LEADS_WHERE] } } };

  const [overdueFollowUps, dueTodayFollowUps, escalated, untouched, quiet] = await Promise.all([
    db.followUpTask.findMany({
      where: mergeWhere(
        { tenantId, ownerId: userId, deletedAt: null },
        onOpenLead,
        overdueFollowUpsWhere(timeZone, now),
      ),
      orderBy: { dueAt: 'asc' },
      take: MAX_ITEMS,
      select: { id: true, leadId: true, title: true, dueAt: true, kind: true, lead: { select: { fullName: true } } },
    }),
    db.followUpTask.findMany({
      where: mergeWhere(
        { tenantId, ownerId: userId, deletedAt: null },
        onOpenLead,
        OPEN_FOLLOW_UP,
        followUpDueWhere({ due: 'today' }, timeZone, now),
      ),
      orderBy: { dueAt: 'asc' },
      take: MAX_ITEMS,
      select: { id: true, leadId: true, title: true, dueAt: true, kind: true, lead: { select: { fullName: true } } },
    }),
    db.lead.findMany({
      where: { ...openLead, slaEscalatedAt: { not: null } },
      orderBy: { slaEscalatedAt: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, fullName: true, slaEscalatedAt: true },
    }),
    db.lead.findMany({
      where: { ...openLead, firstContactedAt: null },
      orderBy: { createdAt: 'asc' },
      take: MAX_ITEMS,
      select: { id: true, fullName: true, createdAt: true },
    }),
    db.lead.findMany({
      where: {
        ...openLead,
        firstContactedAt: { not: null },
        score: { gte: WARM_SCORE },
        lastActivityAt: { lt: new Date(now.getTime() - IDLE_DAYS * DAY_MS) },
      },
      orderBy: { score: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, fullName: true, score: true, lastActivityAt: true },
    }),
  ]);

  const items: TodayItem[] = [];

  for (const lead of escalated) {
    items.push({
      kind: 'sla',
      leadId: lead.id,
      title: lead.fullName,
      reason: `Not contacted inside this stage's window — escalated to your manager ${ago(lead.slaEscalatedAt!, now)}`,
      action: 'Call',
      at: lead.slaEscalatedAt,
      weight: weigh('sla', lead.slaEscalatedAt, now),
    });
  }

  for (const followUp of overdueFollowUps) {
    if (!followUp.leadId) continue;
    items.push({
      kind: 'overdue',
      leadId: followUp.leadId,
      title: followUp.lead?.fullName ?? followUp.title,
      // "Overdue" is the Follow-ups list's own word for this filter, and this
      // row is in it for exactly the same reason: due before today began.
      reason: `Overdue — ${followUp.kind === 'CALL' ? 'call' : 'follow-up'} was due ${ago(followUp.dueAt, now)}`,
      action: 'Open',
      at: followUp.dueAt,
      weight: weigh('overdue', followUp.dueAt, now),
    });
  }

  for (const followUp of dueTodayFollowUps) {
    if (!followUp.leadId) continue;
    items.push({
      kind: 'callback',
      leadId: followUp.leadId,
      title: followUp.lead?.fullName ?? followUp.title,
      /**
       * Due today, and the two cases are not the same thing to a person.
       *
       * The workspace-day definition keeps a follow-up "due today" all day, so
       * one promised for 09:00 is still on this list at 16:00 — correct for
       * the queue, and misleading as a row if it reads like a plan. Time
       * passed says so without calling it overdue, which has a precise meaning
       * here and is not this.
       */
      reason:
        followUp.dueAt < now
          ? `Due today — ${followUp.kind === 'CALL' ? 'callback' : 'follow-up'} time ${atTime(followUp.dueAt, timeZone)} has passed`
          : `Due today — ${followUp.kind === 'CALL' ? 'callback' : 'follow-up'} at ${atTime(followUp.dueAt, timeZone)}`,
      action: 'Open',
      at: followUp.dueAt,
      weight: weigh('callback', followUp.dueAt, now),
    });
  }

  for (const lead of untouched) {
    items.push({
      kind: 'untouched',
      leadId: lead.id,
      title: lead.fullName,
      reason: `Arrived ${ago(lead.createdAt, now)} and has never been contacted`,
      action: 'Call',
      at: lead.createdAt,
      weight: weigh('untouched', lead.createdAt, now),
    });
  }

  for (const lead of quiet) {
    items.push({
      kind: 'idle',
      leadId: lead.id,
      title: lead.fullName,
      // The score is stated, not interpreted: "score 82" is a fact, "hot lead"
      // is an assertion about a person's intent that nothing here may make.
      reason: lead.lastActivityAt
        ? `Score ${lead.score}, nothing logged for ${lasted(lead.lastActivityAt, now)}`
        : `Score ${lead.score}, nothing logged since it arrived`,
      action: 'Log call',
      at: lead.lastActivityAt,
      weight: weigh('idle', lead.lastActivityAt, now, lead.score),
    });
  }

  return { items: rank(items) };
}
