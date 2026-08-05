import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import { can } from '@/lib/security/rbac';
import EventActions from './EventActions';
import RsvpControl from './RsvpControl';

export const metadata = { title: 'Event Detail' };

const RSVP_TONE: Record<string, Tone> = {
  CONFIRMED: 'viridian', ATTENDED: 'viridian',
  DECLINED: 'vermillion', NO_SHOW: 'vermillion',
  TENTATIVE: 'brass', PENDING: 'slate', NO_RESPONSE: 'slate',
};

export default async function EventDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const event = await prisma.event.findFirst({
    where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    include: {
      invitees: { orderBy: { createdAt: 'desc' }, take: 200 },
      _count: { select: { invitees: true } },
    },
  });
  if (!event) notFound();

  // A meeting held for this event is an ordinary Call carrying eventId, so its
  // consent, recording, transcript and Gemini summary come from the call pipeline.
  const meetings = await prisma.call.findMany({
    where: { tenantId: ctx.tenantId, eventId: event.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      analysis: { select: { status: true, summary: true, nextSteps: true, topicsMissed: true } },
      recording: { select: { id: true, durationSecs: true } },
      caller: { select: { fullName: true } },
    },
  });
  const summarised = meetings.filter((m) => m.analysis?.status === 'COMPLETED' && m.analysis.summary);

  const confirmed = event.invitees.filter((i) => i.rsvpStatus === 'CONFIRMED' || i.rsvpStatus === 'ATTENDED').length;
  const declined = event.invitees.filter((i) => i.rsvpStatus === 'DECLINED').length;
  const pending = event.invitees.filter((i) => i.rsvpStatus === 'PENDING' || i.rsvpStatus === 'NO_RESPONSE').length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--lf-space-5)' }}>
        <div>
          <h1 className="lf-h1">{event.title}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {event.eventType.toLowerCase()} · {event.startAt.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Badge tone={event.status === 'PUBLISHED' ? 'viridian' : 'slate'}>{event.status.toLowerCase()}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-5)' }}>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>{event._count.invitees}</div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Invited</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700, color: 'var(--lf-viridian)' }}>{confirmed}</div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Confirmed</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700, color: 'var(--lf-vermillion)' }}>{declined}</div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Declined</div>
        </div>
        <div className="lf-card" style={{ padding: 'var(--lf-space-4)', textAlign: 'center' }}>
          <div className="lf-num" style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 700 }}>{pending}</div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>Pending</div>
        </div>
      </div>

      {can(ctx, 'events', 'EDIT') && <EventActions eventId={event.id} />}

      {meetings.length > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Meetings and calls ({meetings.length}) · {summarised.length} summarised
          </div>
          {meetings.map((meeting) => (
            <div key={meeting.id} style={{ borderTop: '1px solid var(--lf-rule)', paddingTop: 'var(--lf-space-3)', marginTop: 'var(--lf-space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--lf-space-3)', flexWrap: 'wrap' }}>
                <SalesLink href={`/calls/${meeting.id}`} style={{ fontWeight: 500 }}>
                  {meeting.recipientNumber ?? 'Meeting'} · {meeting.caller.fullName}
                </SalesLink>
                <Badge tone={meeting.status === 'COMPLETED' ? 'viridian' : 'slate'}>{meeting.status.toLowerCase()}</Badge>
              </div>
              {meeting.analysis?.status === 'COMPLETED' && meeting.analysis.summary ? (
                <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', marginTop: 'var(--lf-space-2)' }}>
                  {meeting.analysis.summary}
                </p>
              ) : (
                <p style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 'var(--lf-space-2)' }}>
                  {meeting.recording
                    ? 'Recorded. Upload the transcript on the call to generate a summary.'
                    : 'No recording — consent must be captured on the call before one is stored.'}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {event.description && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>Details</div>
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>{event.description}</p>
          {event.location && <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)', marginTop: 'var(--lf-space-2)' }}>Location: {event.location}</p>}
          {event.meetingUrl && <p style={{ fontSize: 'var(--lf-text-sm)', marginTop: 'var(--lf-space-2)' }}><SalesLink href={event.meetingUrl} target="_blank" rel="noopener noreferrer">Join meeting</SalesLink></p>}
        </section>
      )}

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>Invitees ({event._count.invitees})</div>
        {event.invitees.length === 0 ? (
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>No invitees yet. Use the API to add invitees.</p>
        ) : (
          <div className="lf-grid-wrap">
            <table className="lf-grid">
              <thead><tr><th>Name / Email</th><th>Channel</th><th>Invited</th><th>RSVP</th><th>Record RSVP</th></tr></thead>
              <tbody>
                {event.invitees.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.name ?? inv.email ?? inv.phone ?? inv.leadId?.slice(0, 8) ?? '—'}</td>
                    <td style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>{inv.inviteChannel.toLowerCase()}</td>
                    <td style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                      {inv.inviteSentAt ? inv.inviteSentAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'not sent'}
                    </td>
                    <td><Badge tone={RSVP_TONE[inv.rsvpStatus]}>{inv.rsvpStatus.toLowerCase().replace(/_/g, ' ')}</Badge></td>
                    <td>
                      {can(ctx, 'events', 'EDIT')
                        ? <RsvpControl eventId={event.id} inviteeId={inv.id} current={inv.rsvpStatus} meetingUrl={event.meetingUrl} />
                        : <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
                      </table>
          </div>
        )}
      </section>
    </>
  );
}
