import AuthShell from '@/components/auth/AuthShell';
import EnrolForm from './EnrolForm';

export const metadata = { title: 'Set up your authenticator' };

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
    <AuthShell>
      <h1 className="lf-auth-title">Set up your authenticator</h1>
      <p className="lf-auth-lede">Takes about a minute. You won&rsquo;t be asked to do this again.</p>
      <EnrolForm />
    </AuthShell>
  );
}
