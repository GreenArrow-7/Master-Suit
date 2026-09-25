import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { requestCtx, requestWorkspace } from '@/lib/workspace-page';

/**
 * Real Estate entitlement gate, and nothing else.
 *
 * The workspace layout above has already established the session and the chrome;
 * this refuses the module itself, so a workspace not entitled to REAL_ESTATE
 * cannot reach these screens by typing the URL. Hiding the navigation is not
 * authorisation, and this is the half that is.
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
  try {
    const ctx = await requestCtx();
    await requestWorkspace(ctx, workspaceSlug, 'REAL_ESTATE');
  } catch (error) {
    // Only an entitlement refusal becomes a redirect. Anything else — a broken
    // session, a database fault, or one of Next's own control-flow interrupts —
    // is rethrown, because a bare catch turns every one of them into "this
    // workspace has no Real Estate module", which hides the real answer.
    if (error instanceof AppError && error.status === 403) redirect(`/${workspaceSlug}/dashboard`);
    throw error;
  }
  return children;
}
