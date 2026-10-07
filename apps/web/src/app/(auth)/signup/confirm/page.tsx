import AuthShell from '@/components/auth/AuthShell';
import ConfirmSignup from './ConfirmSignup';

export const metadata = { title: 'Confirm your workspace' };

/** Where the emailed link lands. The script, not the page load, uses the link up. */
export default async function ConfirmSignupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <h1 className="lf-auth-title">Your workspace</h1>
      <ConfirmSignup token={token ?? ''} />
    </AuthShell>
  );
}
