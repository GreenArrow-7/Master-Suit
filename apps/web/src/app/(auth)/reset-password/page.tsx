import ResetPasswordForm from './ResetPasswordForm';
import { PRODUCT_NAME } from '@/lib/branding';

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
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--lf-space-8)',
        background: 'var(--lf-canvas)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="lf-eyebrow">{PRODUCT_NAME}</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
          Choose a new password
        </h1>
        {token ? (
          <>
            <p style={{ margin: '4px 0 var(--lf-space-6)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
              Signing you out of every device at the same time.
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <div className="lf-alert" role="alert" style={{ marginTop: 'var(--lf-space-4)' }}>
            This link is missing its token. Request a new one.
            <div style={{ marginTop: 12 }}>
              <a className="lf-btn lf-btn--secondary lf-btn--sm" href="/forgot-password">
                Request a reset link
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
