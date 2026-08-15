import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata = { title: 'Choose a new password' };

/**
 * The destination of the emailed reset link — which previously 404'd, so the
 * link in the email went nowhere even when the email was sent.
 *
 * The token stays in the query string and is never rendered into the page.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <AuthShell>
      <h1 className="lf-auth-title">Choose a new password</h1>
      {token ? (
        <>
          <p className="lf-auth-lede">This signs you out of every device at the same time.</p>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <div className="lf-auth-alert" role="alert" style={{ marginTop: 'var(--lf-space-4)' }}>
          This link is missing its token. Request a new one.
          <div style={{ marginTop: 12 }}>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" href="/forgot-password">
              Request a reset link
            </Link>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
