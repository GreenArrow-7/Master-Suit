import { forbidden } from 'next/navigation';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { mustChangePassword } from '@/services/identity/accounts';
import { twoFactorStatus } from '@/services/identity/twoFactor';
import { executionEnabled, myDeletionRequest } from '@/services/identity/accountDeletion';
import { activeConsent } from '@/services/hr/attendance';
import { myEmployee } from '@/services/hr/leave';
import SecurityScreen from './SecurityScreen';

export const metadata = { title: 'Security' };

/**
 * The Security screen, per the reference: two-factor authentication, face
 * check-in consent and password, in that order. Nothing here can reach anyone
 * else's account — consent in particular is the employee's own to give, which
 * is why HR has no control that records it for them.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });

  /**
   * Platform staff hold no credential here, so there is nothing on this screen
   * for them to manage — and every loader below asks for one.
   *
   * They resolve the viewer's own account through `WorkspaceMembership` keyed on
   * `ctx.actor.id`, which for a platform identity is a synthetic `platform:` id
   * with no membership row; `twoFactorStatus` and `myDeletionRequest` answer
   * that with NotFound. Thrown from inside a server component that has already
   * passed the gate, it reaches the root error boundary, which replaces the
   * whole workspace frame with a vertically centred "Something went wrong on our
   * side" card — the top of the window is empty, so it reads as the application
   * dying at the right URL. That is how it was reported.
   *
   * A monitoring session never got this far: `assertPageAccess` refuses it every
   * self-service screen. A break-glass owner is admitted to those screens
   * deliberately — the dashboard and the inbox are among them — so the refusal
   * that belongs only to the credential screens belongs here, not in the gate.
   * `people/security` renders this same page, so this one guard covers both.
   *
   * The interrupt rather than a thrown 403, for the reason `assertPageAccess`
   * gives: a refusal is not a fault and must not read as one.
   */
  if (ctx.actor.platformMode) forbidden();

  const employee = await myEmployee(ctx);
  const [status, forced, consent, deletionRequest] = await Promise.all([
    twoFactorStatus(ctx),
    mustChangePassword(ctx),
    employee ? activeConsent(ctx, employee.id) : Promise.resolve(null),
    myDeletionRequest(ctx),
  ]);

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Your account</div>
        <h1 style={{ margin: '8px 0 0' }}>Security</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>Two-factor authentication and your password.</p>
      </section>

      {forced && (
        <section className="lf-alert" role="alert">
          <strong>Set your own password.</strong>
          <div style={{ marginTop: 6, fontSize: 'var(--lf-text-sm)' }}>
            You are signed in with a temporary password an administrator issued. Change it below — until you do, anyone
            who overheard it can sign in as you.
          </div>
        </section>
      )}

      <SecurityScreen
        selfBase={`/api/v1/workspaces/${workspaceSlug}/identity/self`}
        hrBase={`/api/v1/workspaces/${workspaceSlug}/hr/self`}
        mfaEnabled={!!status.enabled}
        consentGiven={!!consent}
        deletionRequest={deletionRequest}
        deletionExecutionEnabled={executionEnabled()}
      />
    </div>
  );
}
