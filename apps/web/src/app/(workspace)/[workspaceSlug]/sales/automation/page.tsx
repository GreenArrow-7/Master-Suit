import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import { AutomationComposer, AutomationRowActions } from './AutomationAdmin';

export const metadata = { title: 'Automation' };

const STATE_TONE: Record<string, Tone> = {
  PUBLISHED: 'viridian',
  DRAFT: 'slate',
  PAUSED: 'brass',
  ARCHIVED: 'slate',
};

export default async function AutomationPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['automation', 'VIEW'] });
  if (!can(ctx, 'automation', 'VIEW')) redirect('/home');

  const canManage = can(ctx, 'automation', 'MANAGE_AUTOMATION');
  const [rows, taskTypes] = await Promise.all([
    prisma.automation.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        objectType: true,
        state: true,
        createdAt: true,
        _count: { select: { enrollments: true } },
      },
      take: 100,
    }),
    canManage
      ? prisma.taskType.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { name: 'asc' },
          select: { key: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <ListHeader
        title="Automation"
        description={
          <>
            {rows.length} rule{rows.length === 1 ? '' : 's'} · runs when records are created or updated
          </>
        }
        actions={canManage && <AutomationComposer taskTypeKeys={taskTypes.map((t) => t.key)} />}
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
                <th>Enrolled</th>
                <th>State</th>
                <th>Created</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td style={{ color: 'var(--lf-ink-2)' }}>{r.objectType}</td>
                  <td style={{ textAlign: 'center' }}>{r._count.enrollments}</td>
                  <td>
                    <Badge tone={STATE_TONE[r.state] ?? 'slate'}>{r.state.toLowerCase()}</Badge>
                  </td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      <AutomationRowActions id={r.id} state={r.state} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
