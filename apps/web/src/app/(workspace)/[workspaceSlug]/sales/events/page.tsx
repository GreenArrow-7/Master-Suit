import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Events' };

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'slate',
  PUBLISHED: 'viridian',
  CANCELLED: 'vermillion',
  COMPLETED: 'brass',
};

const TABS = [
  ['All', ''],
  ['Upcoming', 'upcoming'],
  ['Draft', 'DRAFT'],
  ['Completed', 'COMPLETED'],
] as const;

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['events', 'VIEW'] });

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
  if (params.tab === 'upcoming') where.startAt = { gte: new Date() };
  else if (params.tab === 'DRAFT' || params.tab === 'COMPLETED') where.status = params.tab;

  const events = await prisma.event.findMany({
    where,
    orderBy: { startAt: 'desc' },
    take: 50,
    include: { _count: { select: { invitees: true } } },
  });

  return (
    <>
      <ListHeader
        title="Events"
        count={events.length}
        capped={events.length === 50}
        actions={
          <SalesLink href="/events/new" className="lf-btn lf-btn--sm">
            + New Event
          </SalesLink>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Event filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/events?tab=${key}` : '/events'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {events.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No events"
            description="Create an event to get started."
            actionLabel="New Event"
            actionHref="/events/new"
          />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 'var(--lf-space-4)',
          }}
        >
          {events.map((e) => (
            <SalesLink
              key={e.id}
              href={`/events/${e.id}`}
              className="lf-card"
              style={{ padding: 'var(--lf-space-5)', textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 'var(--lf-space-3)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{e.title}</div>
                  <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 2 }}>
                    {e.eventType.toLowerCase()} · {e._count.invitees} invitee{e._count.invitees === 1 ? '' : 's'}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[e.status]}>{e.status.toLowerCase()}</Badge>
              </div>
              <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                {e.startAt.toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              {e.location && (
                <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 4 }}>
                  {e.location}
                </div>
              )}
              {e.meetingUrl && (
                <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-viridian)', marginTop: 4 }}>
                  Online meeting link available
                </div>
              )}
            </SalesLink>
          ))}
        </div>
      )}
    </>
  );
}
