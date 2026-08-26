import { ulid } from 'ulid';
import { headers } from 'next/headers';
import AuthShell from '@/components/auth/AuthShell';
import { resolvePlatformCtx } from '@/lib/auth/session';
import EnrolForm from './EnrolForm';

export const metadata = { title: 'Set up your authenticator' };

/**
 * First-run enrolment — and voluntary enrolment, which is not the same thing.
 *
 * Reached with an MFA_ENROLMENT grant — a session that can do nothing else —
 * when a workspace mandates two-factor authentication and this account has not
 * enrolled. There is no way past it, which is the point; before this screen
 * existed, switching that policy on locked those users out for good.
 *
 * The same screen also serves someone with a full session choosing to enrol,
 * and that case re-authenticates: enrolment hands out recovery codes, so a
 * session borrowed for a minute must not be enough to complete it. Which of the
 * two is happening is decided here, from the session itself, rather than left
 * for the form to infer from a refusal.
 */
export default async function EnrolTwoFactorPage() {
  let requiresPassword = true;
  try {
    const ctx = await resolvePlatformCtx(new Request('http://internal/', { headers: await headers() }), ulid(), [
      'FULL',
      'MFA_ENROLMENT',
    ]);
    requiresPassword = ctx.purpose === 'FULL';
  } catch {
    /**
     * No readable session. The form's own call will refuse it just the same;
     * asking for the password is the safe thing to render in the meantime,
     * because the alternative — silently starting enrolment — is the behaviour
     * being removed.
     */
  }

  return (
    <AuthShell>
      <h1 className="lf-auth-title">Set up your authenticator</h1>
      <p className="lf-auth-lede">Takes about a minute. You won&rsquo;t be asked to do this again.</p>
      <EnrolForm requiresPassword={requiresPassword} />
    </AuthShell>
  );
}
