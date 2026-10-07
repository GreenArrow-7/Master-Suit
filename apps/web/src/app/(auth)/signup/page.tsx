import { notFound } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { signupOffer } from '@/services/platform/signup';
import SignupForm from './SignupForm';

export const metadata = { title: 'Start a free trial' };

/** Self-serve sign-up: a 404 until the platform owner opens it in the console. */
export default async function SignupPage() {
  const offer = await signupOffer();
  if (!offer) notFound();
  const { days } = offer;
  return (
    <AuthShell>
      <h1 className="lf-auth-title">Start your Lead Eagle trial</h1>
      <p className="lf-auth-lede">
        {days} days free. We&rsquo;ll email you a link; your workspace is made when you use it.
      </p>
      <SignupForm />
    </AuthShell>
  );
}
