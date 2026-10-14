import { headers } from 'next/headers';
import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { can, scopeFor } from '@/lib/security/rbac';
import { eventListScope, leadsInScope, workListScope } from '@/lib/security/record-scope';
import { hasAnyModuleEntitlement, LEAD_MODULES, SALES_OR_REALTY } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import { applyFieldSecurity, loadFieldRules } from '@/lib/security/fieldSecurity';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
import CalendarView from './CalendarView';

export const metadata = { title: 'Calendar' };

/** Entries of one kind a month draws; past it the page says so. */
const CAP = 300;

/** `?month=YYYY-MM`, clamped to a sane window around `today` (the workspace's YYYY-MM-DD). */
function parseMonth(raw: string | undefined, today: string): { year: number; month: number } {
  const thisYear = Number(today.slice(0, 4));
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (year >= thisYear - 5 && year <= thisYear + 5 && month >= 0 && month <= 11) {
      return { year, month };
    }
  }
  return { year: thisYear, month: Number(today.slice(5, 7)) - 1 };
}

const monthParam = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

/**
 * Every lead module's calendar (M4-22): `realty/calendar` and
 * `lead-eagle/calendar` re-export this page. The month, and the day each entry
 * falls on, are the workspace's (its time zone), not the server's.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['tasks', 'VIEW'] });

  const timeZone = await workspaceTimezone(ctx);
  const today = todayKey(timeZone);
  const { year, month } = parseMonth((await searchParams).month, today);
  const key = monthParam(year, month);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const inMonth = { gte: dayBounds(`${key}-01`, timeZone).from, lte: dayBounds(`${key}-${lastDay}`, timeZone).to };

  /**
   * The calendar draws several kinds of entry, each on its own grant.
   *
   * The page is gated on `tasks:VIEW`, and then asked `visibilityWhere` for
   * activities and calls regardless — which throws Forbidden on a NONE scope.
   * A role holding tasks without calls (four exist in this database) was
   * refused the whole calendar rather than shown a calendar without call
   * entries. A missing permission should subtract a layer, not the page.
   * Follow-ups are read as the Follow-ups list reads them (`workListScope`),
   * and without `leads:VIEW` only the caller's own; events only where the plan
   * has them (Sales or Real Estate), and not under /lead-eagle/, which has no
   * Events screen for their links to open.
   */
  const canSeeActivities = can(ctx, 'activities', 'VIEW');
  const canSeeCalls = can(ctx, 'calls', 'VIEW');
  const canSeeVisits = can(ctx, 'visits', 'VIEW');
  const underLeadEagle = (await headers()).get('x-pathname')?.split('/')[2] === 'lead-eagle';
  const canSeeEvents =
    can(ctx, 'events', 'VIEW') && !underLeadEagle && (await hasAnyModuleEntitlement(ctx.tenantId, SALES_OR_REALTY));
  const [taskScope, activityScope, callScope, followUpScope, visitScope] = await Promise.all([
    visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
    canSeeActivities ? visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' }) : null,
    canSeeCalls ? visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' }) : null,
    can(ctx, 'leads', 'VIEW') ? workListScope(ctx, 'leads', false) : { tenantId: ctx.tenantId, ownerId: ctx.actor.id },
    canSeeVisits ? visibilityWhere(ctx, 'visits', 'VIEW') : null,
  ]);

  const [tasks, activities, followUps, calls, events, visits] = await Promise.all([
    prisma.task.findMany({
      // A cancelled one is not on anyone's day, as a cancelled visit is not (below).
      where: { ...taskScope, deletedAt: null, status: { not: 'CANCELLED' }, dueAt: inMonth },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: CAP,
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    activityScope
      ? prisma.activity.findMany({
          where: { ...activityScope, deletedAt: null, occurredAt: inMonth },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          take: CAP,
          select: { id: true, occurredAt: true, leadId: true, type: { select: { name: true } } },
        })
      : [],
    prisma.followUpTask.findMany({
      where: mergeWhere(followUpScope, { deletedAt: null, status: { not: 'CANCELLED' }, dueAt: inMonth }),
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: CAP,
      select: { id: true, title: true, dueAt: true, status: true, ownerId: true },
    }),
    callScope
      ? prisma.call.findMany({
          // A completed call sits at its start time; one not yet dialled at its creation.
          // mergeWhere, not spread: callScope's ownership `OR` would otherwise be
          // replaced by this date `OR`, showing a rep every colleague's calls.
          where: mergeWhere(callScope, {
            deletedAt: null,
            OR: [{ startedAt: inMonth }, { startedAt: null, createdAt: inMonth }],
          }),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: CAP,
          select: { id: true, startedAt: true, createdAt: true, direction: true, status: true },
        })
      : [],
    // The events the Events list shows, on their own grant.
    canSeeEvents
      ? prisma.event.findMany({
          where: {
            tenantId: ctx.tenantId,
            deletedAt: null,
            startAt: inMonth,
            ...(await eventListScope(ctx)),
          },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          take: CAP,
          select: { id: true, title: true, startAt: true },
        })
      : [],
    visitScope
      ? prisma.siteVisit.findMany({
          // A refused or called-off visit is not on anyone's day.
          where: mergeWhere(visitScope, {
            deletedAt: null,
            scheduledAt: inMonth,
            status: { notIn: ['REJECTED', 'CANCELLED'] },
          }),
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: CAP,
          select: {
            id: true,
            kind: true,
            scheduledAt: true,
            status: true,
            leadId: true,
            contactId: true,
            project: { select: { name: true } },
          },
        })
      : [],
  ]);

  // Who each visit is with, so two visits to one project read apart: the lead's
  // or contact's name as their own list shows it to this role. Named only when
  // in the role's scope there (leadsInScope; the Contacts list's scope), and
  // masked or left out by a field rule.
  const contactIds = visits.flatMap((v) => (!v.leadId && v.contactId ? [v.contactId] : []));
  const seesContacts = contactIds.length > 0 && scopeFor(ctx, 'contacts', 'VIEW') !== 'NONE';
  const [visitLeads, leadRules, visitContacts, contactRules] = await Promise.all([
    leadsInScope(
      ctx,
      visits.map((v) => v.leadId),
    ),
    loadFieldRules(ctx, 'LEAD'),
    seesContacts
      ? prisma.contact.findMany({
          where: {
            ...(await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true })),
            id: { in: [...new Set(contactIds)] },
          },
          select: { id: true, fullName: true },
        })
      : [],
    seesContacts ? loadFieldRules(ctx, 'CONTACT') : null,
  ]);
  const leadName = new Map(
    [...visitLeads.values()].map((l) => [
      l.id,
      applyFieldSecurity(ctx, 'LEAD', leadRules, l, LEAD_SENSITIVE_FIELDS).fullName,
    ]),
  );
  const contactName = new Map(
    visitContacts.map((c) => [c.id, applyFieldSecurity(ctx, 'CONTACT', contactRules!, c).fullName]),
  );

  const at = (date: Date) => ({ date: date.toISOString(), day: todayKey(timeZone, date) });
  const items = [
    ...tasks.map((t) => ({
      id: `task-${t.id}`,
      ...at(t.dueAt),
      label: t.title,
      kind: 'task' as const,
      completed: t.status === 'COMPLETED',
      href: '/tasks',
    })),
    ...activities.map((a) => ({
      id: `act-${a.id}`,
      ...at(a.occurredAt),
      label: a.type.name,
      kind: 'activity' as const,
      // The Activity Log is a Sales screen; under another module only the lead opens.
      href: a.leadId ? `/leads/${a.leadId}` : undefined,
    })),
    ...followUps.map((f) => ({
      id: `fup-${f.id}`,
      ...at(f.dueAt),
      label: f.title,
      kind: 'follow-up' as const,
      completed: f.status === 'COMPLETED',
      href: f.ownerId === ctx.actor.id ? '/follow-ups?view=mine' : '/follow-ups',
    })),
    ...calls.map((c) => ({
      id: `call-${c.id}`,
      ...at(c.startedAt ?? c.createdAt),
      label: `${c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call`,
      kind: 'call' as const,
      href: `/calls/${c.id}`,
    })),
    ...events.map((e) => ({
      id: `event-${e.id}`,
      ...at(e.startAt),
      label: e.title,
      kind: 'event' as const,
      href: `/events/${e.id}`,
    })),
    ...visits.map((v) => ({
      id: `visit-${v.id}`,
      ...at(v.scheduledAt),
      label: [
        v.kind === 'CLIENT_MEETING' ? 'Meeting' : 'Site visit',
        v.kind === 'CLIENT_MEETING' ? null : v.project?.name,
        v.leadId ? leadName.get(v.leadId) : v.contactId && contactName.get(v.contactId),
      ]
        .filter(Boolean)
        .join(' · '),
      kind: 'visit' as const,
      completed: v.status === 'COMPLETED',
      href: `/site-visits/${v.id}`,
    })),
  ];

  const isCurrentMonth = key === today.slice(0, 7);
  // ponytail: a cap per kind, not paging; a month this full needs a day view.
  const capped = [tasks, activities, followUps, calls, events, visits].some((list) => list.length === CAP);

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          Calendar
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Tasks, follow-ups, site visits, calls{canSeeEvents ? ', events' : ''} and activities
        </p>
        {capped && (
          <p role="note" style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {`A busy month: each kind shows its first ${CAP}, by date.`}
          </p>
        )}
      </header>
      <CalendarView
        items={items}
        year={year}
        month={month}
        today={today}
        timeZone={timeZone}
        prevHref={`/calendar?month=${monthParam(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)}`}
        nextHref={`/calendar?month=${monthParam(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)}`}
        todayHref={isCurrentMonth ? null : '/calendar'}
      />
    </>
  );
}
