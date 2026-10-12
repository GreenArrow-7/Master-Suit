import NotInPlan from '@/components/workspace/NotInPlan';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Lead Eagle entitlement gate, and nothing else — the same gate as
 * `realty/layout.tsx`, for the lead-management product (owner, 5 Oct).
 *
 * The workspace layout above has established the session and the chrome; this
 * refuses the module, so a workspace not entitled to LEAD_EAGLE cannot reach
 * these screens by typing the URL: `NotInPlan` sends it to the same screen under
 * Sales or Real Estate when the plan has one there, and otherwise says so.
 * Every page beneath still asserts its own module and permission.
 */
export default async function LeadEagleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  if (await workspaceOwns(workspaceSlug, 'LEAD_EAGLE')) return children;
  return <NotInPlan slug={workspaceSlug} module="LEAD_EAGLE" />;
}
