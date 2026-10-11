import NotInPlan from '@/components/workspace/NotInPlan';
import { workspaceOwns } from '@/lib/workspace-page';

/**
 * Sales entitlement gate. The workspace layout above already established the
 * session and chrome; this only refuses the module itself, so a workspace on an
 * HR-only plan cannot reach Sales screens by typing the URL.
 *
 * ── Entitlement only, and deliberately not a permission ─────────────────────
 *
 * This asked for `SELF_SERVICE`, which is not a weaker permission — it is a
 * different question, and `assertPageAccess` answers it by refusing a monitoring
 * session outright, because self-service screens are where credentials are
 * managed. A layout asking it turned that refusal into "no Sales screen at all
 * for a monitoring session": every `/sales/*` URL threw, was caught below, and
 * redirected to the dashboard, which refuses a monitoring actor too. A platform
 * identity authorised to watch a workspace's CRM could not open one page of it.
 *
 * So the layout now asks only what it says it asks: is this module entitled for
 * this workspace. Every page beneath still asserts its own permission — the
 * leads list needs `leads:VIEW`, and a session that lacks it is still refused
 * there.
 *
 * ── Where a workspace without Sales goes instead ────────────────────────────
 *
 * Record links — the notification bell, a push notification already on a
 * phone, the assistant — are built as `/sales/...` (lib/nav/entityRoute.ts).
 * A workspace that bought only Real Estate owns the same registers under
 * `/realty/`, and one that bought Lead Eagle owns most of them under
 * `/lead-eagle/`, so `NotInPlan` sends it to the same screen there (Real Estate
 * first, the fuller of the two, via lib/nav/realtyShared.ts) and names every
 * product that carries a screen neither has for it. The Real Estate and Lead
 * Eagle layouts do the same through it.
 */
export default async function SalesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  if (await workspaceOwns(workspaceSlug, 'SALES')) return children;
  return <NotInPlan slug={workspaceSlug} module="SALES" />;
}
