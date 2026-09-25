import { permanentRedirect } from 'next/navigation';

export const metadata = { title: 'Check in' };

/**
 * The old address. The console moved to `/{workspace}/check-in`.
 *
 * It had to: everything under `people/` inherits that folder's HRMS entitlement
 * gate, and checking yourself in is not an HR privilege — the API behind it is
 * `selfService` with no module gate at all. A Sales-only workspace was bounced
 * to the dashboard, which is also where the dashboard's own "Open check-in"
 * link ended up sending them.
 *
 * Kept as a redirect rather than deleted because this URL has been in the
 * navigation, in the mobile tab bar and on the dashboard, so it is in people's
 * history and on their home screens. Permanent, so those are corrected rather
 * than followed for ever.
 *
 * Reachable only by a workspace with HRMS — the layout above still decides that,
 * and for anyone else the new address is what every link now points at.
 */
export default async function MovedCheckInPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  permanentRedirect(`/${workspaceSlug}/check-in`);
}
