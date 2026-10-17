import { mergeWhere } from '@/lib/api/where';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { CONNECTED_CALL_OUTCOMES, CONNECTED_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { isDayKey, shiftDay } from '@/lib/leads/followUpDue';
import { can, type Ctx } from '@/lib/security/rbac';
import { ownerReach } from '@/lib/security/record-scope';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

/**
 * The Lead Eagle board's filters (M3-16, M3-17): a period, a person or a team,
 * a source and a project. The board counts under them and every list it links
 * reads the same parameters through `boardWhere`, so a figure and its list
 * narrow the same way.
 *
 * - `range` is relative (today, the last 7, 30 or 90 days) so a remembered
 *   "last 7 days" moves with the calendar; `from` and `to` are a fixed period,
 *   both or neither. Days are the workspace's.
 * - `owner` or `team`: the records owned by that person, or by the team's
 *   members (a call is its caller's).
 * - `source`: the lead's catalogue entry with its sub-sources, as the lead list
 *   reads it. `project`: a lead the project interests (`LeadProject`); a visit
 *   to that project. Records hung on a lead (follow-ups, calls, logged calls,
 *   meetings, visits) follow their lead's source and project.
 */
export const BOARD_RANGES = { today: 0, '7d': 6, '30d': 29, '90d': 89 } as const;
export type BoardRange = keyof typeof BOARD_RANGES;

export interface BoardFilter {
  range?: BoardRange;
  from?: string;
  to?: string;
  owner?: string;
  team?: string;
  source?: string;
  project?: string;
}

export const BOARD_FILTER_KEYS = ['range', 'from', 'to', 'owner', 'team', 'source', 'project'] as const;
const ID = /^[\w-]{1,40}$/;

/** The values that mean something, each checked alone. */
export function cleanBoardFilter(raw: Record<string, unknown>): BoardFilter {
  const one = (key: string) => {
    const value = [raw[key]].flat()[0];
    return typeof value === 'string' ? value.trim() : '';
  };
  const out: BoardFilter = {};
  const range = one('range');
  if (Object.hasOwn(BOARD_RANGES, range)) out.range = range as BoardRange;
  else if (isDayKey(one('from')) && isDayKey(one('to'))) {
    [out.from, out.to] = [one('from'), one('to')].sort() as [string, string];
  }
  for (const key of ['owner', 'team', 'source', 'project'] as const) {
    if (ID.test(one(key))) out[key] = one(key);
  }
  return out;
}

/** The chosen period as day keys on the workspace's clock, or null for none. */
export function boardPeriod(filter: BoardFilter, timeZone: string, now = new Date()) {
  if (filter.range) {
    const day = todayKey(timeZone, now);
    return { from: shiftDay(day, -BOARD_RANGES[filter.range]), to: day };
  }
  return filter.from && filter.to ? { from: filter.from, to: filter.to } : null;
}

/** The query string for a filter, keys in one order: the board's URL and its remembered choice. */
export function boardQuery(filter: BoardFilter) {
  const query = new URLSearchParams();
  for (const key of BOARD_FILTER_KEYS) if (filter[key]) query.set(key, filter[key]!);
  return query.toString();
}

/**
 * The filter as this viewer may apply it: a person outside their `leads`
 * reach, a team with no one in it, or a source or project the workspace does
 * not hold is dropped, never widening what they see (and never a 403).
 */
export async function scopeBoardFilter(ctx: Ctx, filter: BoardFilter, db: TxClient | typeof prisma = prisma) {
  const { tenantId } = ctx;
  const out = { ...filter };
  const reach = await ownerReach(ctx, 'leads', 'VIEW');
  if (out.owner) {
    const user = await db.user.findFirst({ where: { tenantId, id: out.owner }, select: { id: true } });
    if (!user || !reach(user.id)) delete out.owner;
  }
  if (out.team) {
    const members = await db.userTeam.findMany({ where: { tenantId, teamId: out.team }, select: { userId: true } });
    if (!members.some((row) => reach(row.userId))) delete out.team;
  }
  if (out.source && !(await db.leadSource.findFirst({ where: { tenantId, id: out.source }, select: { id: true } }))) {
    delete out.source;
  }
  if (
    out.project &&
    (!can(ctx, 'projects', 'VIEW') ||
      !(await db.project.findFirst({ where: { tenantId, id: out.project, deletedAt: null }, select: { id: true } })))
  ) {
    delete out.project;
  }
  return out;
}

/** The board's registers: whose a record is, and the date a period reads. */
const REGISTERS = {
  lead: { owner: 'ownerId', date: 'createdAt' },
  followUp: { owner: 'ownerId', date: null },
  call: { owner: 'callerId', date: 'createdAt' },
  log: { owner: 'ownerId', date: 'occurredAt' },
  task: { owner: 'ownerId', date: 'createdAt' },
  visit: { owner: 'ownerId', date: 'scheduledAt' },
  booking: { owner: 'ownerId', date: 'bookingDate' },
} as const;
export type BoardRegister = keyof typeof REGISTERS;

/** A filter ready to apply: the people its person or team names, and its period's bounds. */
export interface ResolvedBoardFilter {
  filter: BoardFilter;
  people: string[] | null;
  span: { gte: Date; lte: Date } | null;
}

export async function resolveBoardFilter(
  ctx: Ctx,
  filter: BoardFilter,
  timeZone: string,
  now = new Date(),
  db: TxClient | typeof prisma = prisma,
): Promise<ResolvedBoardFilter> {
  const people = filter.owner
    ? [filter.owner]
    : filter.team
      ? (
          await db.userTeam.findMany({
            where: { tenantId: ctx.tenantId, teamId: filter.team },
            select: { userId: true },
          })
        ).map((row) => row.userId)
      : null;
  const period = boardPeriod(filter, timeZone, now);
  const span = period ? { gte: dayBounds(period.from, timeZone).from, lte: dayBounds(period.to, timeZone).to } : null;
  return { filter, people, span };
}

/**
 * The `where` a register's list adds for the filter: owner, lead (source,
 * project) and, with `dated`, the period on the register's date. It only
 * narrows: always merge it with the viewer's own scope (a team's `people` can
 * name members outside that scope).
 */
export function boardWhere(resolved: ResolvedBoardFilter, register: BoardRegister, dated = true) {
  const { filter, people, span } = resolved;
  const { owner, date } = REGISTERS[register];
  const lead = mergeWhere(
    filter.source ? { OR: [{ sourceId: filter.source }, { leadSource: { is: { parentId: filter.source } } }] } : null,
    filter.project && register !== 'visit' && register !== 'booking'
      ? { projectInterests: { some: { projectId: filter.project } } }
      : null,
  );
  const onLead = Object.keys(lead).length > 0;
  return mergeWhere(
    people && { [owner]: { in: people } },
    onLead ? (register === 'lead' ? lead : { lead: { is: lead } }) : null,
    (register === 'visit' || register === 'booking') && filter.project ? { projectId: filter.project } : null,
    dated && date && span ? { [date]: span } : null,
  );
}

/** A list page's filter from its URL: the same parameters the board writes. */
export async function boardListWhere(
  ctx: Ctx,
  raw: Record<string, unknown>,
  register: BoardRegister,
  timeZone: string,
) {
  return boardWhere(await resolveBoardFilter(ctx, cleanBoardFilter(raw), timeZone), register);
}

/** Logged calls (#178's Log call, cold calls, moved history): an Activity of these types. */
export const LOGGED_CALL = { deletedAt: null, type: { is: { key: { in: ['call_out', 'call_in'] } } } };

/**
 * The Calls list's tabs, each with the logged calls it counts beside the
 * provider's (null: none). `placed` is the board's calls made, `completed` a
 * leaderboard's calls, `connected` the board's connected.
 */
export const CALL_TABS: {
  label: string;
  key: string;
  where: Record<string, unknown>;
  logged: Record<string, unknown> | null;
}[] = [
  { label: 'All', key: '', where: {}, logged: null },
  { label: 'Placed', key: 'placed', where: { status: { notIn: ['SCHEDULED', 'CANCELLED'] } }, logged: {} },
  { label: 'Completed', key: 'completed', where: { status: 'COMPLETED' }, logged: {} },
  {
    label: 'Connected',
    key: 'connected',
    where: { status: 'COMPLETED', outcome: { in: CONNECTED_CALL_OUTCOMES } },
    logged: { outcome: { in: CONNECTED_LOG_OUTCOMES } },
  },
  { label: 'Missed', key: 'missed', where: { status: 'MISSED' }, logged: null },
  { label: 'Voicemail', key: 'voicemail', where: { outcome: 'VOICEMAIL' }, logged: null },
  { label: 'Failed', key: 'failed', where: { status: 'FAILED' }, logged: null },
  { label: 'Scheduled', key: 'scheduled', where: { status: 'SCHEDULED' }, logged: null },
  // The recordings to play (M9-07): in our own storage, not still at the vendor ('provider').
  {
    label: 'Recorded',
    key: 'recorded',
    where: { recording: { is: { OR: [{ storageBucket: null }, { storageBucket: { not: 'provider' } }] } } },
    logged: null,
  },
];

export const callTab = (key: string | undefined) => CALL_TABS.find((tab) => tab.key === (key ?? '')) ?? CALL_TABS[0]!;

/** Where a person's board filters are kept: their `User.uiPreferences`, so they follow them to any device. */
const PREFERENCE = 'leadEagleBoard';

/**
 * The filters a board view applies, remembered per user (M3-16):
 *
 * - With filters in the URL, those, saved as this person's choice.
 * - With none, their saved choice, and `redirectTo` its query so the URL shows it.
 * - `clear` forgets the choice.
 *
 * A URL that is not the filter's own (the form's empty fields, `clear`) gets
 * `redirectTo` the tidy one: `""` is the board with no query.
 *
 * A saved choice is scoped again on every read, as the URL's is by the board.
 */
export async function rememberedBoardFilter(
  ctx: Ctx,
  raw: Record<string, unknown>,
): Promise<{ filter: BoardFilter; redirectTo: string | null }> {
  const { tenantId } = ctx;
  const where = { tenantId, id: ctx.actor.id };
  const asked = cleanBoardFilter(raw);
  const user = await prisma.user.findFirst({ where, select: { uiPreferences: true } });
  const prefs = (user?.uiPreferences && typeof user.uiPreferences === 'object' ? user.uiPreferences : {}) as Record<
    string,
    unknown
  >;
  const saved = cleanBoardFilter((prefs[PREFERENCE] as Record<string, unknown> | undefined) ?? {});
  const fresh = raw.clear ? {} : Object.keys(asked).length > 0 ? asked : null;
  if (fresh === null) {
    const query = boardQuery(saved);
    return { filter: saved, redirectTo: query ? `?${query}` : null };
  }
  if (user && boardQuery(fresh) !== boardQuery(saved)) {
    // A platform actor has no workspace User row, and nothing to remember.
    await withTx(tenantId, (tx) =>
      tx.user.updateMany({ where, data: { uiPreferences: { ...prefs, [PREFERENCE]: fresh } as object } }),
    );
  }
  const query = boardQuery(fresh);
  const tidy = Object.keys(raw).every((key) => Object.hasOwn(fresh, key));
  return { filter: fresh, redirectTo: tidy ? null : query ? `?${query}` : '' };
}
