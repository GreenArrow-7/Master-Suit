import { redirect } from 'next/navigation';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';

/**
 * Sales entitlement gate. The workspace layout above already established the
 * session and chrome; this only refuses the module itself, so a workspace on an
 * HR-only plan cannot reach Sales screens by typing the URL.
 */
export default async function SalesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  try {
    // Entitlement only. Each page below asserts its own permission; this layout
    // exists so a workspace on an HR-only plan cannot reach any Sales screen by
    // typing the URL, whatever permissions its roles happen to carry.
    await resolveWorkspacePage(workspaceSlug, { module: 'SALES', permission: SELF_SERVICE });
  } catch {
    redirect(`/${workspaceSlug}/dashboard`);
  }
  return children;
}
