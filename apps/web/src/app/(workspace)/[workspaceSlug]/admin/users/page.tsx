import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Administration' };

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'viridian', INVITED: 'brass', SUSPENDED: 'vermillion', DEACTIVATED: 'slate',
};
const TABS = [['All', ''], ['Active', 'ACTIVE'], ['Invited', 'INVITED'], ['Suspended', 'SUSPENDED']] as const;

function relativeTime(date: Date | null | undefined): string {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (!can(ctx, 'users', 'VIEW')) redirect('/home');

  const statusFilter = params.status && ['ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED'].includes(params.status)
    ? { status: params.status as any }
    : {};

  const rows = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, ...statusFilter },
    orderBy: { fullName: 'asc' },
    select: {
      id: true, fullName: true, email: true, status: true, lastLoginAt: true,
      role: { select: { name: true } },
      branch: { select: { name: true } },
    },
    take: 100,
  });

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-4)' }}>
        <div>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>Administration</h1>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {rows.length} user{rows.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Status filter">
        {TABS.map(([label, key]) => (
          <SalesLink key={label} className="lf-tab" href={key ? `/admin?status=${key}` : '/admin'}
             aria-selected={(params.status ?? '') === key} role="tab">
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No users match" description="Adjust the filter to see users." />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>
                    <SalesLink href={`/admin/users/${r.id}`}>{r.fullName}</SalesLink>
                  </td>
                  <td style={{ color: 'var(--lf-ink-2)' }}>{r.email}</td>
                  <td>{r.role.name}</td>
                  <td style={{ color: 'var(--lf-ink-2)' }}>{r.branch?.name ?? '—'}</td>
                  <td><Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status.toLowerCase()}</Badge></td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{relativeTime(r.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
