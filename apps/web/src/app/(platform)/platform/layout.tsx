import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import PlatformSidebar from '@/components/platform/PlatformSidebar';
import TopBar from '@/components/nav/TopBar';
import '@/styles/lists-mobile.css';

export const dynamic = 'force-dynamic';

/**
 * Three outcomes, not one.
 *
 * Every failure used to end at `redirect('/login')`. For a company
 * administrator — `platformRole` `USER`, correctly refused the control plane —
 * that meant clicking through to `/platform` threw them onto a sign-in screen
 * while they were signed in, which reads as the session breaking rather than as
 * "this area is not yours". It is the shape of the "I cannot create a workspace,
 * and other things do not work either" report. Refusing them is right; refusing
 * them in a way indistinguishable from a logout is not.
 *
 * The bare `catch` also swallowed genuine failures: a database outage while
 * resolving the session showed the same login page, so an outage and a
 * permission boundary looked identical from the outside.
 *
 * A redirect rather than a message rendered here, and the difference is not
 * cosmetic. A layout cannot stop the page beneath it from rendering:
 * `/platform/page.tsx` queries every workspace on the platform, and returning
 * markup from this layout still shipped that page's output — workspace names,
 * the owner's address, platform-wide counts — inside the flight payload, to the
 * very account being refused. Invisible on screen, and sent all the same.
 * `forbidden()` behaves the same way here. `redirect()` answers 307 with no body,
 * so nothing renders and nothing is serialised — which is the property the old
 * `redirect('/login')` had and the only thing that was right about it.
 *
 * Nothing about who may enter changes. `requirePlatformOwner` is still the only
 * gate, and it still runs first.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  let owner;
  try {
    owner = await requirePlatformOwner(new Request('http://internal/platform', { headers: await headers() }), ulid());
  } catch (error) {
    // 401: no session, or an expired one. Signing in is the answer.
    if (error instanceof AppError && error.status === 401) redirect('/login');
    // 403: signed in, and this is simply not their area. Say which, not "sign in".
    if (error instanceof AppError && error.status === 403) redirect('/no-platform-access');
    throw error;
  }

  return (
    <div className="lf-app-frame">
      <PlatformSidebar email={owner!.email} />
      <div className="lf-content-column">
        <TopBar module="platform" workspaceName="Platform control" />
        <main className="lf-page-main">{children}</main>
      </div>
    </div>
  );
}
