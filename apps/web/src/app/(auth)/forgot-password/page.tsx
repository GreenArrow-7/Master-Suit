import ForgotPasswordForm from './ForgotPasswordForm';
import { PRODUCT_NAME } from '@/lib/branding';

export const metadata = { title: 'Reset your password' };

/**
 * The page the sign-in screen has always linked to, and which did not exist.
 *
 * `LoginForm` rendered a "Forgot your password?" link to this path and it
 * returned 404; the API behind it then wrote the wrong table and mailed a link
 * to a second page that also did not exist. Three independent failures on the
 * one flow people reach for when they are already locked out.
 */
export default function ForgotPasswordPage() {
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
          Reset your password
        </h1>
        <p style={{ margin: '4px 0 var(--lf-space-6)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          We will email you a link. It expires in 30 minutes and works once.
        </p>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
