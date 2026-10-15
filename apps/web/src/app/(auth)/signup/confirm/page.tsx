import { notFound } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { inIosApp } from '@/lib/mobile/iosApp';
import ConfirmSignup from './ConfirmSignup';

export const metadata = { title: 'Confirm your workspace' };

/** Where the emailed link lands. The script, not the page load, uses the link up. */
export default async function ConfirmSignupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (await inIosApp()) notFound();
  const { token } = await searchParams;
  return (
    <AuthShell>
      <h1 className="lf-auth-title">Your workspace</h1>
      <ConfirmSignup token={token ?? ''} />
    </AuthShell>
  );
}
