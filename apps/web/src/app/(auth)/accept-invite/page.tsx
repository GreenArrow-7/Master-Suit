import AuthShell from '@/components/auth/AuthShell';
import AcceptInviteForm from './AcceptInviteForm';

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
    <AuthShell>
      {token ? (
        <AcceptInviteForm token={token} />
      ) : (
        <>
          <h1 className="lf-auth-title">Invitation link</h1>
          <div className="lf-auth-alert" role="alert" style={{ marginTop: 'var(--lf-space-4)' }}>
            This link is missing its token. Ask whoever invited you to send it again.
          </div>
        </>
      )}
    </AuthShell>
  );
}
