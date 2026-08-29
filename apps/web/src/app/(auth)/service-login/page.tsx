import AuthShell from '@/components/auth/AuthShell';
import ServiceLoginForm from './ServiceLoginForm';

export const metadata = { title: 'Service sign-in' };

/**
 * The door for platform service identities.
 *
 * It exists because the API route for them was built without one, and the
 * procedure that shipped alongside it said "sign in at /login" — which is a
 * different page posting to a different endpoint. A service account that
 * followed it got through the password and the authenticator and was then
 * refused on its first real request, because /login issues FULL sessions and
 * resolvePlatformCtx will not accept one for an AI_SERVICE identity.
 *
 * Not linked from /login on purpose: this is an operator surface, and putting
 * "service sign-in" on the customer-facing front door invites people to try it.
 */
export default function ServiceLoginPage() {
  return (
    <AuthShell>
      <ServiceLoginForm />
    </AuthShell>
  );
}
