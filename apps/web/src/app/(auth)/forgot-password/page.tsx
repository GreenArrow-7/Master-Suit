import AuthShell from '@/components/auth/AuthShell';
import ForgotPasswordForm from './ForgotPasswordForm';

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
    <AuthShell>
      <h1 className="lf-auth-title">Reset your password</h1>
      <p className="lf-auth-lede">We&rsquo;ll email you a link. It expires in 30 minutes and works once.</p>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
