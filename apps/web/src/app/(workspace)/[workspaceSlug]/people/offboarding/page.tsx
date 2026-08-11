import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';

/** Offboarding, opening the joining-and-leaving screen in its exit mode. */
export const metadata = { title: 'Offboarding' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  // Checked here too: every routed page asserts its own access.
  await requirePageAccess({ module: 'HRMS', permission: ['employee', 'VIEW'] });
  redirect(`/${workspaceSlug}/people/lifecycle?mode=offboarding`);
}
