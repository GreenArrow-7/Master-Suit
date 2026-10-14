import NotInPlan from '@/components/workspace/NotInPlan';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Email templates are sent from a lead (M4-28), so they belong to whichever
 * lead product the workspace has, as lead stages and sources do; outside one,
 * `NotInPlan` rather than the error page.
 */
export default async function EmailTemplatesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  if (await workspaceOwns(workspaceSlug, LEAD_MODULES)) return children;
  return <NotInPlan slug={workspaceSlug} module={LEAD_MODULES} />;
}
