import EnrolForm from './EnrolForm';
import { PRODUCT_NAME } from '@/lib/branding';

export const metadata = { title: 'Set up two-factor authentication' };

/**
 * First-run enrolment.
 *
 * Reached with an MFA_ENROLMENT grant — a session that can do nothing else —
 * when a workspace mandates two-factor authentication and this account has not
 * enrolled. There is no way past it, which is the point; before this screen
 * existed, switching that policy on locked those users out for good.
 */
export default function EnrolTwoFactorPage() {
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
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div className="lf-eyebrow">{PRODUCT_NAME}</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
          Set up two-factor authentication
        </h1>
        <p style={{ margin: '4px 0 var(--lf-space-6)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          Your workspace requires it. This takes about a minute and you will not be asked again on this account.
        </p>
        <EnrolForm />
      </div>
    </main>
  );
}
