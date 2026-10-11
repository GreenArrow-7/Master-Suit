import { redirect } from 'next/navigation';
import NotInPlan from '@/components/workspace/NotInPlan';
import { resolveWorkspacePage, SELF_SERVICE, workspaceOwns } from '@/lib/workspace-page';

/**
 * HRMS entitlement gate, mirroring sales/layout.tsx.
 *
 * Every People page today passes `module: 'HRMS'` itself, so this changes
 * nothing for them. It exists for the next one: a page added here without that
 * argument would otherwise be reachable by URL from a Sales-only workspace, and
 * nothing would say so. The gate belongs somewhere a new file inherits it
 * rather than somewhere a new file has to remember it.
 *
 * A workspace without HRMS gets `NotInPlan`; any other refusal (a monitoring
 * session, which self-service screens refuse) still goes to the dashboard.
 */
export default async function PeopleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let owns = false;
  try {
    owns = await workspaceOwns(workspaceSlug, 'HRMS');
    // Entitlement only — each page still asserts its own permission.
    if (owns) await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: SELF_SERVICE });
  } catch {
    redirect(`/${workspaceSlug}/dashboard`);
  }
  return owns ? children : <NotInPlan slug={workspaceSlug} module="HRMS" />;
}
