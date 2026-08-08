import AcceptInviteForm from './AcceptInviteForm';
import { PRODUCT_NAME } from '@/lib/branding';

export const metadata = { title: 'Accept your invitation' };

/**
 * Where an invitation link lands.
 *
 * The person choosing the password is the person who will use it — which is the
 * whole point of the flow replacing "an administrator types one and reads it
 * out". Nothing here is rendered from the token except by way of the preview
 * endpoint, which returns no identifiers.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--lf-space-8)',
        background: 'var(--lf-canvas)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="lf-eyebrow">{PRODUCT_NAME}</div>
        {token ? (
          <AcceptInviteForm token={token} />
        ) : (
          <>
            <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
              Invitation link
            </h1>
            <div className="lf-alert" role="alert" style={{ marginTop: 'var(--lf-space-4)' }}>
              This link is missing its token. Ask whoever invited you to send it again.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
