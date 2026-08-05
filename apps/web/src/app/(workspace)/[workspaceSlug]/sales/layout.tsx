import { redirect } from 'next/navigation';
import { resolveWorkspacePage } from '@/lib/workspace-page';

/**
 * Sales entitlement gate. The workspace layout above already established the
 * session and chrome; this only refuses the module itself, so a workspace on an
 * HR-only plan cannot reach Sales screens by typing the URL.
 */
export default async function SalesLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  try {
    await resolveWorkspacePage(workspaceSlug, 'SALES');
  } catch {
    redirect(`/${workspaceSlug}/dashboard`);
  }
  return children;
}
