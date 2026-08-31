import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import TemporaryPasswordButton from '@/components/workspace/TemporaryPasswordButton';
import { accountDetail } from '@/services/identity/accounts';

export const metadata = { title: 'Account' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
  const { workspaceSlug, userId } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: ['users', 'VIEW'] });
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/identity`;

  const account = await accountDetail(ctx, userId);
  const mayManage = can(ctx, 'users', 'MANAGE_USERS');

  // The same rank rule the service enforces, mirrored here so the screen does
  // not offer buttons that will be refused: you may only administer accounts
  // strictly below your own level, and never your own from this screen.
  const isSelf = account.userId === ctx.actor.id;
  const outranked = account.role.rank > ctx.actor.roleRank;
  const mayAct = mayManage && !isSelf && outranked;

  const [roles, employees] = await Promise.all([
    prisma.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { rank: 'asc' } }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }),
  ]);

  const locked = account.lockedUntil !== null && account.lockedUntil > new Date();

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">
          <Link href={`/${workspaceSlug}/admin/users`}>Users</Link> · Account
        </div>
        <h1 style={{ margin: '8px 0 0' }}>{account.fullName}</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>
          {account.email} · {account.role.name}
        </p>
      </section>

      {isSelf && (
        <div className="lf-alert">
          This is your own account. Change your own password and authenticator from{' '}
          <Link href={`/${workspaceSlug}/profile/security`}>My security</Link> — administrative actions here are for
          other people&apos;s accounts.
        </div>
      )}
      {!isSelf && !outranked && mayManage && (
        <div className="lf-alert">
          This account is at or above your own level, so you cannot administer it. Someone more senior must act.
        </div>
      )}

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        {(
          [
            ['Status', account.status],
            ['Access', account.membershipStatus],
            ['Sign-in', locked ? 'Locked' : 'Normal'],
            ['Two-factor', account.mfaEnabled ? `on · ${account.recoveryCodesRemaining} codes` : 'off'],
            ['Password', account.passwordChangedAt === null ? 'Temporary — must change' : 'Set by user'],
            [
              'Last sign-in',
              account.lastLoginAt ? account.lastLoginAt.toLocaleString('en-AE', { timeZone: 'UTC' }) : 'Never',
            ],
          ] as const
        ).map(([label, value]) => (
          <article className="lf-card" key={label} style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow">{label}</div>
            <div style={{ marginTop: 6, fontWeight: 600 }}>{value}</div>
          </article>
        ))}
      </section>

      {mayAct && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 14 }}>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Actions</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'start' }}>
            <TemporaryPasswordButton endpoint={endpoint} userId={account.userId} userName={account.fullName} />

            {locked && (
              <WorkspaceActionButton
                endpoint={`${endpoint}/account-unlock`}
                body={{ userId: account.userId }}
                label="Unlock sign-in"
              />
            )}

            {account.status === 'ACTIVE' ? (
              <WorkspaceActionButton
                endpoint={`${endpoint}/account-active`}
                body={{ userId: account.userId, active: false }}
                label="Suspend account"
                variant="danger"
                promptFor={{ name: 'reason', label: 'Reason', required: false }}
              />
            ) : (
              <WorkspaceActionButton
                endpoint={`${endpoint}/account-active`}
                body={{ userId: account.userId, active: true }}
                label="Restore account"
              />
            )}

            <WorkspaceActionButton
              endpoint={`${endpoint}/sessions-revoke`}
              body={{ userId: account.userId }}
              label={`Sign out everywhere (${account.activeSessions.length})`}
              variant="ghost"
              confirm="Sign this account out of every device it is currently signed in on?"
            />

            {account.mfaEnabled && (
              <WorkspaceActionButton
                endpoint={`${endpoint}/two-factor-remove`}
                body={{ userId: account.userId }}
                label="Remove two-factor"
                variant="danger"
                confirm="Remove the authenticator from this account? Use this when the phone holding it has been lost. Every session is signed out, and the user must enrol again."
              />
            )}
          </div>
          <p style={{ margin: 0, color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-xs)' }}>
            A password reset signs the account out everywhere and forces the user to set their own before anything else
            opens. Suspension revokes live sessions immediately rather than waiting for them to expire.
          </p>
        </section>
      )}

      {mayAct && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Role</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
            Changing a role signs the account out, because a live session carries the permissions it was built with.
            Only roles below your own level are offered.
          </p>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/account-role`}
            submitLabel="Change role"
            fields={[
              {
                name: 'userId',
                label: 'User',
                type: 'select',
                required: true,
                options: [{ value: account.userId, label: account.fullName }],
              },
              {
                name: 'roleId',
                label: 'New role',
                type: 'select',
                required: true,
                options: roles
                  .filter((role) => role.rank > ctx.actor.roleRank)
                  .map((role) => ({ value: role.id, label: `${role.name} (rank ${role.rank})` })),
              },
            ]}
          />
        </section>
      )}

      {account.employee && mayManage && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Line manager</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
            Who approves this person&apos;s leave and endorses their attendance exceptions. Leave blank to route
            straight to HR.
          </p>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/account-manager`}
            submitLabel="Set manager"
            fields={[
              {
                name: 'employeeId',
                label: 'Employee',
                type: 'select',
                required: true,
                options: [
                  { value: account.employee.id, label: `${account.employee.employeeNumber} · ${account.fullName}` },
                ],
              },
              {
                name: 'managerEmployeeId',
                label: 'Manager (blank for none)',
                type: 'select',
                options: employees
                  .filter((employee) => employee.id !== account.employee!.id)
                  .map((employee) => ({
                    value: employee.id,
                    label: `${employee.employeeNumber} · ${employee.membership.platformUser.fullName}`,
                  })),
              },
            ]}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Active sessions</h2>
        <WorkspaceTable
          headers={['Signed in from', 'Device', 'Last seen', 'Expires']}
          empty="No live sessions."
          rows={account.activeSessions.map((session) => [
            session.ipAddress ?? '—',
            <span key="ua" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-2)' }}>
              {(session.userAgent ?? '—').slice(0, 70)}
            </span>,
            session.lastSeenAt.toLocaleString('en-AE', { timeZone: 'UTC' }),
            session.expiresAt.toLocaleString('en-AE', { timeZone: 'UTC' }),
          ])}
        />
      </section>
    </div>
  );
}
