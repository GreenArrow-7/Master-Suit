import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import { LEAD_EAGLE } from '@/components/auth/BrandHero';
import { signupOffer } from '@/services/platform/signup';
import { inIosApp } from '@/lib/mobile/iosApp';
import LoginForm from './LoginForm';

type Search = Promise<{ next?: string | string[]; product?: string | string[] }>;

export async function generateMetadata({ searchParams }: { searchParams: Search }) {
  return { title: (await searchParams).product === 'lead-eagle' ? 'Sign in to Lead Eagle' : 'Sign in' };
}

/**
 * The front door. The product story, brand and layout live in AuthShell —
 * shared with enrolment and recovery so the whole outside-a-session flow reads
 * as one place. Headings live inside the form, which retitles itself for the
 * second-factor step.
 *
 * `next` is the screen a signed-out visitor was sent away from. It is only a
 * request: the form checks it against the server's answer (see `signInLanding`).
 *
 * `?product=lead-eagle` (`LEAD_EAGLE_LOGIN`) is Lead Eagle's door (PROD-13): the
 * same form, endpoint, accounts and session under Lead Eagle's name. A
 * Lead-Eagle-only workspace lands on its board either way (`workspaceLanding`).
 */
export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const { next, product } = await searchParams;
  const leadEagle = product === 'lead-eagle';
  // Offered only while the platform owner keeps self-serve sign-up open.
  // Never inside the iOS app (App Store 3.1.1, see lib/mobile/iosApp.ts).
  const trialDays = (await inIosApp()) ? 0 : ((await signupOffer())?.days ?? 0);
  return (
    <AuthShell product={leadEagle ? 'lead-eagle' : undefined}>
      <LoginForm next={typeof next === 'string' ? next : null} product={leadEagle ? LEAD_EAGLE.label : undefined} />
      {trialDays > 0 && (
        <p style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center', marginTop: 'var(--lf-space-4)' }}>
          New here?{' '}
          <Link href="/signup">
            {leadEagle ? 'Start your Lead Eagle trial' : `Start a ${trialDays}-day free trial`}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
