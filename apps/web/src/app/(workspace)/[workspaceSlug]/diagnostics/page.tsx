import { buildId } from '@/lib/build';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import DiagnosticsReport from './DiagnosticsReport';

export const metadata = { title: 'Diagnostics' };

/**
 * What this device recorded when something went wrong.
 *
 * It exists because a blank screen was reported on an iPhone that has never
 * reproduced on a desk, and reading a phone's console needs a Mac and a cable.
 * The recorder in the workspace shell writes the few facts that identify a
 * fault — the first error, a screen that rendered nothing — into this browser's
 * own storage; this reads them back.
 *
 * No permission beyond being in the workspace: it shows what *this browser*
 * saw, which is already this person's own session, and nothing from anybody
 * else's. The build is shown because "which version were you on" is the first
 * question anybody asks and the hardest for a phone user to answer.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  // SELF_SERVICE: it shows what *this browser* saw, which is already this
  // person's own session. That sentinel also refuses a monitoring session
  // outright, which is right — a read-only observer has no business reading
  // somebody else's device log.
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">Support</div>
        <h1 style={{ margin: '8px 0 0' }}>Diagnostics</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          Errors and blank screens this device ran into, kept on the device. Nothing is sent anywhere — copy the report
          and send it to support if you are asked for it. It holds screen names and error messages, never customer
          details.
        </p>
      </div>
      <DiagnosticsReport build={buildId()} owner={`${ctx.tenantId}:${ctx.actor.id}`} />
    </div>
  );
}
