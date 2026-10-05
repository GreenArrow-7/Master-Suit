import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { requestCtx, requestWorkspace } from '@/lib/workspace-page';

/**
 * Lead Eagle entitlement gate, and nothing else — the same gate as
 * `realty/layout.tsx`, for the lead-management product (owner, 5 Oct).
 *
 * The workspace layout above has established the session and the chrome; this
 * refuses the module, so a workspace not entitled to LEAD_EAGLE cannot reach
 * these screens by typing the URL. Every page beneath still asserts its own
 * permission.
 */
export default async function LeadEagleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  try {
    const ctx = await requestCtx();
    await requestWorkspace(ctx, workspaceSlug, 'LEAD_EAGLE');
  } catch (error) {
    // Only an entitlement refusal becomes a redirect; anything else is rethrown
    // (see realty/layout.tsx for why a bare catch is wrong here).
    if (error instanceof AppError && error.status === 403) redirect(`/${workspaceSlug}/dashboard`);
    throw error;
  }
  return children;
}
