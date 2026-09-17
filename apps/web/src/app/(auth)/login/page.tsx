import AuthShell from '@/components/auth/AuthShell';
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
  return (
    <AuthShell>
      <LoginForm next={typeof next === 'string' ? next : null} />
    </AuthShell>
  );
}
