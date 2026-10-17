import type { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { can, type Ctx } from '@/lib/security/rbac';
import { callScope } from '@/lib/security/record-scope';
import { visibilityWhere } from '@/lib/security/visibility';
import { applyFieldSecurity, loadFieldRules } from '@/lib/security/fieldSecurity';
import { workspaceTimezone } from '@/services/hr/attendance';
import { names } from '@/services/leadership/rollups';
import { LEAD_SENSITIVE_FIELDS } from './createLead';
import { leadFields } from './customFields';
import { leadSourceLabel } from './leadSources';

/**
 * A lead's timeline (Lead Eagle audit rows M4-12, M4-46): what was logged, its
 * stage moves, its field edits from the audit log, its assignments, its calls
 * and its messages, in one feed, newest first, paged by a cursor. Each entry
 * is typed and dated on the workspace's clock, and carries only what the
 * viewer may see: a masked field reads masked, and a call or a message outside
 * the viewer's `calls` or inbox (`communications`) reach is left out (a role
 * with no inbox reads the messages it sent). A user
 * id is shown as the person's name, never as the id.
 */
export type TimelineKind = 'activity' | 'assignment' | 'call' | 'field' | 'message' | 'stage';

export interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  /** ISO instant, what the order and the cursor go by. */
  at: string;
  /** `at` on the workspace's clock: "02 Oct 2026, 00:30". */
  when: string;
  title: string;
  detail: string | null;
  notes: string | null;
  /** Who did it, by name; null for the system. */
  by: string | null;
  /** Where it opens, under the module's base: a call's own page, which plays its recording (M9-03). */
  link?: { href: string; label: string };
}

export interface TimelinePage {
  entries: TimelineEntry[];
  /** Where the next, older page starts; null at the end. */
  next: string | null;
}

/** The lead fields an edit shows, by the audit row's `fieldKey`: the rest are bookkeeping or have their own entry. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  phoneIsWhatsapp: 'On WhatsApp',
  company: 'Company',
  jobTitle: 'Job title',
  city: 'City',
  country: 'Country',
  nationality: 'Nationality',
  sourceId: 'Source',
  campaignName: 'Campaign',
  priority: 'Priority',
  tags: 'Tags',
  notes: 'Notes',
  secondaryOwnerId: 'Second owner',
  status: 'Status',
  customData: 'Custom fields',
};

/** `<at ISO>~<kind>~<id>`: the last entry a page showed. */
export const TIMELINE_CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~(activity|assignment|call|field|message|stage)~([a-z0-9]{1,40})$/;

interface Cursor {
  at: Date;
  kind: TimelineKind;
  id: string;
}

/**
 * The rows of one source that come after the cursor, as a `where`. The feed is
 * ordered by time, then kind, then id, all descending; one source has one kind,
 * so at the cursor's instant a source sorting before the cursor's kind is all
 * still to come, one after it is all shown, and the cursor's own goes by id.
 */
function after<Where>(cursor: Cursor | null, kind: TimelineKind, field: string): Where {
  if (!cursor) return {} as Where;
  if (kind < cursor.kind) return { [field]: { lte: cursor.at } } as Where;
  if (kind > cursor.kind) return { [field]: { lt: cursor.at } } as Where;
  return { OR: [{ [field]: { lt: cursor.at } }, { [field]: cursor.at, id: { lt: cursor.id } }] } as Where;
}

const shown = (value: unknown): string => {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  const text = String(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
};

/** An instant on the workspace's clock: "02 Oct 2026, 00:30". */
export const onClock = (at: Date, timeZone: string) =>
  at.toLocaleString('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
const CHANNEL: Readonly<Record<string, string>> = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', SMS: 'SMS', VOICE: 'Voice' };
/** An assignment's reason: a code ("REASSIGNED") as words, a sentence (the recycle sweep's) as written. */
const reason = (value: string | null) => (value && /^[A-Z_]+$/.test(value) ? sentence(value) : value);

/**
 * The messages this viewer reads, as a `where` on Communication: the ones the
 * inbox shows them. A threaded message goes by its conversation's owner, as
 * the inbox lists and opens threads (api/v1/conversations); one outside any
 * thread by its own. A role with no inbox, which still sends from the lead
 * (the Telecaller), reads the messages it sent itself, and nothing else.
 */
async function inboxReach(ctx: Ctx): Promise<Prisma.CommunicationWhereInput> {
  if (!can(ctx, 'communications', 'VIEW')) return { createdById: ctx.actor.id };
  const visible = await visibilityWhere(ctx, 'communications', 'VIEW', { includeUnassigned: true });
  return {
    OR: [
      { conversation: { is: visible as Prisma.ConversationWhereInput } },
      { conversationId: null, ...(visible as Prisma.CommunicationWhereInput) },
    ],
  };
}

export async function leadTimeline(
  ctx: Ctx,
  leadId: string,
  { cursor: raw, limit = 30 }: { cursor?: string | null; limit?: number } = {},
): Promise<TimelinePage> {
  const { tenantId } = ctx;
  const parsed = raw ? TIMELINE_CURSOR.exec(raw) : null;
  const cursor: Cursor | null = parsed
    ? { at: new Date(parsed[1]!), kind: parsed[2] as TimelineKind, id: parsed[3]! }
    : null;
  const take = limit + 1;

  const [callWhere, inbox, timeZone, rules] = await Promise.all([
    callScope(ctx, 'VIEW'),
    inboxReach(ctx),
    workspaceTimezone(ctx),
    loadFieldRules(ctx, 'LEAD'),
  ]);
  // The six feeds through one tenant transaction, so one connection. As six
  // pinned queries (lib/db.ts runPinned) they asked the pool for six at once,
  // on top of the lead page's own reads, and the page outran the pool: P2028.
  // Only `tx` inside: the global client there runs without the tenant.
  const [activities, stages, edits, assignments, calls, messages] = await withTx(tenantId, (tx) =>
    Promise.all([
      tx.activity.findMany({
        where: {
          tenantId,
          leadId,
          deletedAt: null,
          AND: [after<Prisma.ActivityWhereInput>(cursor, 'activity', 'occurredAt')],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          occurredAt: true,
          outcome: true,
          notes: true,
          durationSecs: true,
          ownerId: true,
          type: { select: { name: true } },
        },
      }),
      tx.leadStageHistory.findMany({
        where: { tenantId, leadId, AND: [after<Prisma.LeadStageHistoryWhereInput>(cursor, 'stage', 'createdAt')] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      tx.auditLog.findMany({
        where: {
          tenantId,
          objectType: 'lead',
          recordId: leadId,
          fieldKey: { in: Object.keys(FIELD_LABELS) },
          AND: [after<Prisma.AuditLogWhereInput>(cursor, 'field', 'occurredAt')],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      tx.leadAssignmentHistory.findMany({
        where: {
          tenantId,
          leadId,
          AND: [after<Prisma.LeadAssignmentHistoryWhereInput>(cursor, 'assignment', 'createdAt')],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      tx.call.findMany({
        where: {
          tenantId,
          leadId,
          deletedAt: null,
          AND: [callWhere as Prisma.CallWhereInput, after<Prisma.CallWhereInput>(cursor, 'call', 'createdAt')],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // Never the numbers: the lead's own number reads masked to some roles.
        select: {
          id: true,
          createdAt: true,
          direction: true,
          status: true,
          outcome: true,
          durationSecs: true,
          notes: true,
          callerId: true,
          recording: { select: { storageBucket: true } },
          consent: { select: { consentGiven: true, withdrawnAt: true } },
        },
      }),
      tx.communication.findMany({
        where: {
          tenantId,
          // A thread's earlier messages carry no lead: it was linked after them.
          OR: [{ leadId }, { conversation: { is: { leadId } } }],
          AND: [inbox, after<Prisma.CommunicationWhereInput>(cursor, 'message', 'createdAt')],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // Never the addresses, as for calls.
        select: {
          id: true,
          createdAt: true,
          channel: true,
          direction: true,
          status: true,
          subject: true,
          body: true,
          createdById: true,
        },
      }),
    ]),
  );

  const userIds = [
    ...activities.map((a) => a.ownerId),
    ...stages.map((s) => s.changedById),
    ...edits.flatMap((e) => [
      e.actorUserId,
      ...(e.fieldKey === 'secondaryOwnerId'
        ? [e.previousValue, e.newValue].map((v) => (typeof v === 'string' ? v : null))
        : []),
    ]),
    ...assignments.flatMap((a) => [a.fromOwnerId, a.toOwnerId, a.assignedById]),
    ...calls.map((c) => c.callerId),
    ...messages.map((m) => m.createdById),
  ];
  const sourceIds = edits
    .filter((e) => e.fieldKey === 'sourceId')
    .flatMap((e) => [e.previousValue, e.newValue])
    .filter((v): v is string => typeof v === 'string');
  const stageIds = stages.flatMap((s) => [s.fromStageId, s.toStageId]).filter((id): id is string => !!id);
  const [people, sources, stageNames, fields] = await Promise.all([
    names(tenantId, userIds),
    sourceIds.length
      ? prisma.leadSource.findMany({
          where: { tenantId, id: { in: sourceIds } },
          select: { id: true, name: true, parent: { select: { name: true } } },
        })
      : [],
    stageIds.length
      ? prisma.leadStage.findMany({ where: { tenantId, id: { in: stageIds } }, select: { id: true, name: true } })
      : [],
    // The active fields only, as the lead page shows them: an archived one's values stay out.
    edits.some((e) => e.fieldKey === 'customData') ? leadFields(prisma, tenantId, { activeOnly: true }) : [],
  ]);
  const person = (id: string | null | undefined) => (id ? (people.get(id) ?? 'Removed user') : null);
  const stageName = (id: string) => stageNames.find((s) => s.id === id)?.name ?? 'a removed stage';
  const when = (at: Date) => onClock(at, timeZone);

  /** A field's value as this viewer reads it: masked where masked; undefined where hidden. */
  const asSeen = (field: string, raw: unknown): unknown => {
    const safe = applyFieldSecurity(ctx, 'LEAD', rules, { [field]: raw }, LEAD_SENSITIVE_FIELDS);
    if (!(field in safe)) return undefined;
    if (field === 'secondaryOwnerId') return person(typeof raw === 'string' ? raw : null);
    if (field === 'sourceId') return leadSourceLabel(sources.find((s) => s.id === raw));
    if ((field === 'status' || field === 'priority') && typeof raw === 'string') return sentence(raw);
    return safe[field];
  };

  /** "Visa status: Resident → Golden" for each defined field a custom-data edit changed. */
  const customChange = (before: unknown, after: unknown) => {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = (after ?? {}) as Record<string, unknown>;
    const changed = fields.filter((f) => JSON.stringify(b[f.key] ?? null) !== JSON.stringify(a[f.key] ?? null));
    return changed.length ? changed.map((f) => `${f.label}: ${shown(b[f.key])} → ${shown(a[f.key])}`).join('; ') : null;
  };

  interface Row {
    entry: TimelineEntry;
    date: Date;
    id: string;
  }
  const entry = (
    kind: TimelineKind,
    id: string,
    date: Date,
    rest: Omit<TimelineEntry, 'key' | 'kind' | 'at' | 'when'>,
  ): Row => ({ entry: { key: `${kind}:${id}`, kind, at: date.toISOString(), when: when(date), ...rest }, date, id });

  const rows: Row[] = [
    ...activities.map((a) =>
      entry('activity', a.id, a.occurredAt, {
        title: a.type.name,
        detail:
          [a.outcome, a.durationSecs != null && `${Math.round(a.durationSecs / 60)} min`].filter(Boolean).join(' · ') ||
          null,
        notes: a.notes,
        by: person(a.ownerId),
      }),
    ),
    ...stages.map((s) =>
      entry('stage', s.id, s.createdAt, {
        title: s.fromStageId
          ? `Stage: ${stageName(s.fromStageId)} → ${stageName(s.toStageId)}`
          : `Stage: ${stageName(s.toStageId)}`,
        detail: s.reason,
        notes: null,
        by: person(s.changedById) ?? s.changedBySystem,
      }),
    ),
    ...edits.flatMap((e) => {
      const field = e.fieldKey!;
      let detail: string | null;
      if (field === 'customData') {
        detail = customChange(e.previousValue, e.newValue);
        // Only the system's own entries changed: not an edit anyone made.
        if (!detail) return [];
      } else {
        const before = asSeen(field, e.previousValue);
        const after = asSeen(field, e.newValue);
        // A field the viewer may not see at all: that it changed, not what to.
        detail = before === undefined || after === undefined ? null : `${shown(before)} → ${shown(after)}`;
      }
      return [
        entry('field', e.id, e.occurredAt, {
          title: `${FIELD_LABELS[field]} changed`,
          detail,
          notes: null,
          by: e.actorType === 'USER' ? person(e.actorUserId) : null,
        }),
      ];
    }),
    ...assignments.map((a) =>
      entry('assignment', a.id, a.createdAt, {
        title: a.toOwnerId ? `Assigned to ${person(a.toOwnerId)}` : 'Unassigned',
        detail:
          [a.fromOwnerId && `from ${person(a.fromOwnerId)}`, a.note ?? reason(a.reason)].filter(Boolean).join(' · ') ||
          null,
        notes: null,
        by: person(a.assignedById),
      }),
    ),
    ...calls.map((c) =>
      entry('call', c.id, c.createdAt, {
        title: c.direction === 'INBOUND' ? 'Incoming call' : 'Outgoing call',
        detail:
          [sentence(c.outcome ?? c.status), c.durationSecs != null && `${Math.round(c.durationSecs / 60)} min`]
            .filter(Boolean)
            .join(' · ') || null,
        notes: c.notes,
        by: person(c.callerId),
        // Playable once ingested (until then its media is only at the vendor, storageBucket
        // 'provider') and while consent stands, as the media route plays it.
        link: {
          href: `/calls/${c.id}`,
          label:
            c.recording && c.recording.storageBucket !== 'provider' && c.consent?.consentGiven && !c.consent.withdrawnAt
              ? 'Play recording'
              : 'Open call',
        },
      }),
    ),
    ...messages.map((m) =>
      entry('message', m.id, m.createdAt, {
        title: `${CHANNEL[m.channel] ?? sentence(m.channel)} ${m.direction === 'INBOUND' ? 'received' : 'sent'}`,
        detail: sentence(m.status),
        notes: [m.subject, m.body && shown(m.body)].filter(Boolean).join(' — ') || null,
        by: person(m.createdById),
      }),
    ),
  ];

  // Newest first; at one instant, by kind, then each source's own order (a stable sort keeps it).
  const kindOf = (row: Row) => row.entry.kind;
  rows.sort(
    (x, y) => y.date.getTime() - x.date.getTime() || (kindOf(x) < kindOf(y) ? 1 : kindOf(x) > kindOf(y) ? -1 : 0),
  );
  const shownRows = rows.slice(0, limit);
  const last = shownRows.at(-1);
  return {
    entries: shownRows.map((row) => row.entry),
    next: rows.length > limit && last ? `${last.entry.at}~${last.entry.kind}~${last.id}` : null,
  };
}
