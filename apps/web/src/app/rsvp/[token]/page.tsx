import { notFound } from 'next/navigation';
import { loadInvitation, publicView, recordView } from '@/lib/events/rsvp';
import { AppError } from '@/lib/errors';
import RsvpForm from './RsvpForm';

export const metadata = { title: 'Your invitation' };

/**
 * The page an invitee lands on from their WhatsApp message.
 *
 * Outside every route group on purpose: no workspace layout, no sidebar, no
 * session. The only thing that identifies the visitor is the signed token in
 * the URL, and the only thing they can do with it is answer for themselves.
 *
 * Server-rendered from the same loader the API uses, so what the page shows and
 * what the API returns cannot drift into disagreeing about what is safe to
 * disclose.
 */
export default async function RsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation;
  try {
    invitation = await loadInvitation(decodeURIComponent(token));
  } catch (err) {
    // A bad or expired link is a 404 page, not an error page: there is nothing
    // wrong on our side and nothing for the visitor to retry.
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  await recordView(invitation);
  const view = publicView(invitation);

  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: view.event.timezone,
  }).format(view.event.startAt);

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--lf-space-5)',
        background: 'var(--lf-surface-2)',
      }}
    >
      <div className="lf-card" style={{ maxWidth: 560, width: '100%', padding: 28 }}>
        <p className="lf-eyebrow">You are invited</p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
          {view.event.title}
        </h1>

        {view.event.description && <p style={{ color: 'var(--lf-ink-2)', marginTop: 12 }}>{view.event.description}</p>}

        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '6px 16px',
            margin: '20px 0 0',
            fontSize: 'var(--lf-text-sm)',
          }}
        >
          <dt style={{ color: 'var(--lf-ink-3)' }}>When</dt>
          <dd style={{ margin: 0 }}>
            {when} <span style={{ color: 'var(--lf-ink-3)' }}>({view.event.timezone})</span>
          </dd>
          {view.event.location && (
            <>
              <dt style={{ color: 'var(--lf-ink-3)' }}>Where</dt>
              <dd style={{ margin: 0 }}>{view.event.location}</dd>
            </>
          )}
        </dl>

        <RsvpForm
          token={token}
          name={view.name}
          initialStatus={view.rsvpStatus}
          answerable={view.answerable}
          eventStatus={view.event.status}
          meetingUrl={view.event.meetingUrl}
        />
      </div>
    </main>
  );
}
