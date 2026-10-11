import NotInPlan from '@/components/workspace/NotInPlan';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Real Estate entitlement gate, and nothing else.
 *
 * The workspace layout above has already established the session and the chrome;
 * this refuses the module itself, so a workspace not entitled to REAL_ESTATE
 * cannot reach these screens by typing the URL — it gets `NotInPlan` instead,
 * which sends it to the same screen under Sales or Lead Eagle when the plan has
 * one there. Hiding the navigation is not authorisation, and neither is this
 * alone: Next still renders the page beneath `NotInPlan`, unseen, so each page
 * asserts its module too (tests/permission/page-access.spec.ts).
 *
 * Entitlement only — deliberately not a permission, for the reason the Sales
 * layout records: asking `SELF_SERVICE` here would refuse a monitoring session
 * every screen in the module, because that is a different question about
 * credential management rather than a weaker permission. Every page beneath
 * still asserts its own (`leads:VIEW` on the dashboard, and so on), so a session
 * that lacks one is still refused there.
 */
export default async function RealtyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  if (await workspaceOwns(workspaceSlug, 'REAL_ESTATE')) return children;
  return <NotInPlan slug={workspaceSlug} module="REAL_ESTATE" />;
}
