import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import AppearanceScreen from './AppearanceScreen';

export const metadata = { title: 'Appearance' };

/**
 * Settings → Appearance.
 *
 * Self-service, like the rest of `profile/`: a theme is the reader's own choice
 * and reaches nobody else's account, so it needs no permission beyond being
 * signed in. `resolveWorkspacePage` is still called — it is what establishes the
 * workspace context and rejects a slug the signed-in user has no membership in.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Your account</div>
        <h1 style={{ margin: '8px 0 0' }}>Appearance</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>How the workspace looks on this device.</p>
      </section>

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <AppearanceScreen />
      </section>
    </div>
  );
}
