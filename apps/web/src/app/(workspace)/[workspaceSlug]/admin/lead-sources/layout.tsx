import NotInPlan from '@/components/workspace/NotInPlan';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Lead sources (the catalogue, and each source's deliveries and field map)
 * belong to whichever lead product the workspace has, as lead stages do. The
 * pages assert it too; without this gate a workspace with none of them got the
 * error page rather than `NotInPlan`.
 */
export default async function LeadSourcesLayout({
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
