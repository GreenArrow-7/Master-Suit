import NotInPlan from '@/components/workspace/NotInPlan';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Lead stages belong to whichever lead product the workspace has. The page
 * asserts it too; without this gate a workspace with none of them got the
 * error page ("Something went wrong on our side") rather than `NotInPlan`.
 */
export default async function LeadStagesLayout({
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
