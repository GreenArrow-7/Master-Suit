import NotInPlan from '@/components/workspace/NotInPlan';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { workspaceOwns } from '@/lib/workspace-page';

/** A lead source's deliveries and field map belong to whichever lead product the workspace has. */
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
