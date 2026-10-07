import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import { signupOffer } from '@/services/platform/signup';
import LoginForm from './LoginForm';

export const metadata = { title: 'Sign in' };

/**
 * The front door. The product story, brand and layout live in AuthShell —
 * shared with enrolment and recovery so the whole outside-a-session flow reads
 * as one place. Headings live inside the form, which retitles itself for the
 * second-factor step.
 *
 * `next` is the screen a signed-out visitor was sent away from. It is only a
 * request: the form checks it against the server's answer (see `signInLanding`).
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  // Offered only while the platform owner keeps self-serve sign-up open.
  const trialDays = (await signupOffer())?.days ?? 0;
  return (
    <AuthShell>
      <LoginForm next={typeof next === 'string' ? next : null} />
      {trialDays > 0 && (
        <p style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center', marginTop: 'var(--lf-space-4)' }}>
          New here? <Link href="/signup">Start a {trialDays}-day free trial</Link>
        </p>
      )}
    </AuthShell>
  );
}
