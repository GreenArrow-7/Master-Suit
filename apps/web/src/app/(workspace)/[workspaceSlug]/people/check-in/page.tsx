import { permanentRedirect } from 'next/navigation';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';

export const metadata = { title: 'Check in' };

/**
 * The old address. The console moved to `/{workspace}/check-in`.
 *
 * It had to: everything under `people/` inherits that folder's HRMS entitlement
 * gate, and checking yourself in is not an HR privilege — the API behind it is
 * `selfService` with no module gate at all. A Sales-only or Real-Estate-only
 * workspace was bounced to the dashboard, which is also where the dashboard's
 * own "Open check-in" link ended up sending them.
 *
 * Kept as a redirect rather than deleted because this URL has been in the
 * navigation, in the mobile tab bar and on the dashboard, so it is in people's
 * history and on their home screens. Permanent, so those are corrected rather
 * than followed for ever. The navigation keeps it as an alias of the new tab.
 *
 * The session is resolved before redirecting even though nothing is disclosed
 * here. A page that skips the check is a page the next person copies, and
 * tests/permission/page-access.spec.ts is right to refuse one.
 */
export default async function MovedCheckInPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  permanentRedirect(`/${workspaceSlug}/check-in`);
}
