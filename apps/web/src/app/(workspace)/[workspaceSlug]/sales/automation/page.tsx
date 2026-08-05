import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Automation' };

const STATE_TONE: Record<string, Tone> = {
  PUBLISHED: 'viridian', DRAFT: 'slate', PAUSED: 'brass', ARCHIVED: 'slate',
};

export default async function AutomationPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (!can(ctx, 'automation', 'VIEW')) redirect('/home');

  const rows = await prisma.automation.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, objectType: true, state: true, createdAt: true },
    take: 100,
  });

  return (
    <>
            <ListHeader
        title="Automation"
        description={<>{rows.length} rule{rows.length === 1 ? '' : 's'}</>}
      />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No automation rules yet"
            description="Create your first automation to trigger actions when records change."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Object Type</th>
                <th>State</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td style={{ color: 'var(--lf-ink-2)' }}>{r.objectType}</td>
                  <td><Badge tone={STATE_TONE[r.state] ?? 'slate'}>{r.state.toLowerCase()}</Badge></td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
