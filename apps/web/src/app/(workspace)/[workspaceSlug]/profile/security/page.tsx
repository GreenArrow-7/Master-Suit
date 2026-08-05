import { resolveWorkspacePage } from '@/lib/workspace-page';
import SecurityPanel from '@/components/workspace/SecurityPanel';
import { mustChangePassword } from '@/services/identity/accounts';
import { twoFactorStatus } from '@/services/identity/twoFactor';

export const metadata = { title: 'My security' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug);
  const [status, forced] = await Promise.all([twoFactorStatus(ctx), mustChangePassword(ctx)]);

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    <section>
      <div className="lf-eyebrow">My account</div>
      <h1 style={{ margin: '8px 0 0' }}>Security</h1>
      <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>Your password and your authenticator. Nothing on this page can reach anyone else&apos;s account.</p>
    </section>

    {forced && <section className="lf-alert" role="alert">
      <strong>Set your own password.</strong>
      <div style={{ marginTop: 6, fontSize: 'var(--lf-text-sm)' }}>
        You are signed in with a temporary password an administrator issued. Change it below — until you do, anyone who overheard it can sign in as you.
      </div>
    </section>}

    <SecurityPanel endpoint={`/api/v1/workspaces/${workspaceSlug}/identity/self`} status={status} />
  </div>;
}
