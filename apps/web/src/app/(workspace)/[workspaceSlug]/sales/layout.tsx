import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { requestCtx, requestWorkspace } from '@/lib/workspace-page';

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
    const ctx = await requestCtx();
    await requestWorkspace(ctx, workspaceSlug, 'SALES');
  } catch (error) {
    // Only an entitlement refusal becomes a redirect. Anything else — a broken
    // session, a database fault, or one of Next's own control-flow interrupts —
    // is rethrown, because the old bare `catch` turned every one of them into
    // "this workspace has no Sales module", which is the wrong answer and hides
    // the real one.
    if (error instanceof AppError && error.status === 403) redirect(`/${workspaceSlug}/dashboard`);
    throw error;
  }
  return children;
}
