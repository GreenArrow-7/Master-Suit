import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Call Audits' };

export default async function CallAuditsPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const scope = scopeFor(ctx, 'calls', 'VIEW');
  const callWhere: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
  if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) {
    callWhere.callerId = ctx.actor.id;
  }

  const audits = await prisma.callAudit.findMany({
    where: {
      tenantId: ctx.tenantId,
      call: callWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      call: {
        select: {
          id: true,
          recipientNumber: true,
          caller: { select: { fullName: true } },
          startedAt: true,
          createdAt: true,
        },
      },
    },
  });

  return (
    <>
      <ListHeader title="Call audits" count={audits.length} capped={audits.length === 50} />

      {audits.length === 0 ? (
        <div className="lf-card" style={{ marginTop: 'var(--lf-space-4)' }}>
          <EmptyState
            title="No audits yet"
            description="Run an AI audit from a call detail page after completing analysis."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ marginTop: 'var(--lf-space-4)' }}>
        <table className="lf-grid">
          <thead>
            <tr>
              <th>Call</th><th>Caller</th><th>Date</th><th>Score</th><th>Status</th><th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => {
              const pct = a.maxScore ? Math.round(((a.overallScore ?? 0) / a.maxScore) * 100) : null;
              const scoreTone: Tone = pct != null ? (pct >= 70 ? 'viridian' : pct >= 40 ? 'brass' : 'vermillion') : 'slate';
              return (
                <tr key={a.id}>
                  <td>
                    <SalesLink href={`/calls/${a.call.id}`} style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500 }}>
                      {a.call.recipientNumber ?? a.call.id.slice(0, 8)}
                    </SalesLink>
                  </td>
                  <td style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                    {a.call.caller?.fullName ?? '—'}
                  </td>
                  <td style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                    {(a.call.startedAt ?? a.call.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>
                    {pct != null ? (
                      <span className="lf-num" style={{ fontWeight: 700, color: scoreTone === 'viridian' ? 'var(--lf-viridian)' : scoreTone === 'brass' ? 'var(--lf-brass)' : 'var(--lf-vermillion)' }}>
                        {pct}%
                      </span>
                    ) : '—'}
                  </td>
                  <td><Badge tone={a.status === 'COMPLETED' ? 'viridian' : a.status === 'FAILED' ? 'vermillion' : 'brass'}>{a.status.toLowerCase()}</Badge></td>
                  <td>{a.humanReviewed ? <Badge tone="viridian">reviewed</Badge> : <Badge tone="slate">pending</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
