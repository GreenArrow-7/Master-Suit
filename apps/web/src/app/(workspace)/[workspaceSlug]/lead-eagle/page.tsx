import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';

export const metadata = { title: 'Lead Eagle' };

/**
 * Lead Eagle is a separate application. Youhan One sells it and switches it on
 * per workspace; this route checks that entitlement and sends the person there.
 *
 * ponytail: a plain redirect, so Lead Eagle asks them to sign in again. Single
 * sign-on between the two needs a token exchange both sides trust; add it when
 * customers use both daily.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await resolveWorkspacePage(workspaceSlug, { module: 'LEAD_EAGLE', permission: SELF_SERVICE });
  if (env.LEAD_EAGLE_URL) redirect(env.LEAD_EAGLE_URL);

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <h1 style={{ margin: 0 }}>Lead Eagle</h1>
      <p style={{ margin: '8px 0 0', color: 'var(--lf-ink-2)' }}>
        This workspace has Lead Eagle, but its address has not been configured yet. Ask your platform administrator to
        set LEAD_EAGLE_URL.
      </p>
    </section>
  );
}
