import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { mustChangePassword } from '@/services/identity/accounts';
import { twoFactorStatus } from '@/services/identity/twoFactor';
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
  const employee = await myEmployee(ctx);
  const [status, forced, consent] = await Promise.all([
    twoFactorStatus(ctx),
    mustChangePassword(ctx),
    employee ? activeConsent(ctx, employee.id) : Promise.resolve(null),
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
        hrBase={`/api/v1/workspaces/${workspaceSlug}/hr/actions`}
        mfaEnabled={!!status.enabled}
        consentGiven={!!consent}
      />
    </div>
  );
}
