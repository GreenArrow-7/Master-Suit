import { notFound } from 'next/navigation';
import { requestForToken } from '@/services/clients/testimonials';
import TestimonialForm from './TestimonialForm';

export const metadata = { title: 'Share your experience' };

/**
 * The page a client lands on from their agent's message.
 *
 * Outside every route group on purpose: no workspace layout, no sidebar, no
 * session. The only thing that identifies the visitor is the signed token in
 * the URL, and the only thing they can do with it is write their own words.
 *
 * Server-rendered from the same loader the API uses, so what the page shows and
 * what the API returns cannot drift into disagreeing about what is safe to
 * disclose — which here means their own record is never on this page.
 */
export default async function TestimonialPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await requestForToken(decodeURIComponent(token));

  // A bad or closed link is a 404 page, not an error page: there is nothing
  // wrong on our side and nothing for the visitor to retry.
  if (!request) notFound();

  const done = request.status !== 'REQUESTED';

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
      <div className="lf-card" style={{ maxWidth: 560, width: '100%' }}>
        <h1 style={{ marginTop: 0 }}>
          {done ? 'Thank you' : `How did we do${request.workspaceName ? `, from ${request.workspaceName}` : ''}?`}
        </h1>

        {done ? (
          <p>
            {request.status === 'DECLINED'
              ? 'This request has been closed. Thank you for your time.'
              : 'Your words have been received. We appreciate you taking the time.'}
          </p>
        ) : (
          <>
            {request.requestMessage && (
              <p style={{ whiteSpace: 'pre-wrap', color: 'var(--lf-text-2)' }}>{request.requestMessage}</p>
            )}
            <TestimonialForm token={decodeURIComponent(token)} />
          </>
        )}
      </div>
    </main>
  );
}
