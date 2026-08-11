import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';

/**
 * Onboarding is its own module in the HR navigation, as the reference requires.
 * The joining and leaving workflows share one screen and one dataset, so this
 * opens that screen already in the onboarding mode rather than duplicating it.
 */
export const metadata = { title: 'Onboarding' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  // Checked here too: every routed page asserts its own access.
  await requirePageAccess({ module: 'HRMS', permission: ['employee', 'VIEW'] });
  redirect(`/${workspaceSlug}/people/lifecycle?mode=onboarding`);
}
