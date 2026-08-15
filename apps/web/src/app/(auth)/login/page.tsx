import AuthShell from '@/components/auth/AuthShell';
import LoginForm from './LoginForm';

export const metadata = { title: 'Sign in' };

/**
 * The front door. The product story, brand and layout live in AuthShell —
 * shared with enrolment and recovery so the whole outside-a-session flow reads
 * as one place. Headings live inside the form, which retitles itself for the
 * second-factor step.
 */
export default function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
