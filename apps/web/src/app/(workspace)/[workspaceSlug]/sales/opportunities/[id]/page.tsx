import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import StageRail from '@/components/ui/StageRail';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import OutcomeActions from './OutcomeActions';

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
  const opportunity = await prisma.opportunity.findFirst({
    where: { ...scope, id },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, category: true } } } },
      account: { select: { id: true, name: true } },
      owner: { select: { fullName: true, email: true } },
    },
  });
  if (!opportunity) notFound();

  const lossReasons = await prisma.lossReason.findMany({
    where: { tenantId: ctx.tenantId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
  const safe = applyFieldSecurity(ctx, 'OPPORTUNITY', rules, opportunity) as typeof opportunity;

  return (
    <>
      <SalesLink href="/opportunities" style={{ fontSize: 'var(--lf-text-sm)' }}>← Opportunities</SalesLink>

      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--lf-space-4)', margin: 'var(--lf-space-3) 0 var(--lf-space-4)' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>{opportunity.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginTop: 4, flexWrap: 'wrap' }}>
            <span className="lf-num" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{opportunity.reference}</span>
            <Badge value={opportunity.status} />
            {opportunity.account && <SalesLink href={`/accounts/${opportunity.account.id}`}>{opportunity.account.name}</SalesLink>}
            <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-sm)' }}>
              {opportunity.currency} {Number(opportunity.amount).toLocaleString()}
            </span>
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              {opportunity.owner?.fullName ?? <em style={{ color: 'var(--lf-wine-700)' }}>Unassigned</em>}
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--lf-space-2)' }}>
          {can(ctx, 'opportunities', 'EDIT') && opportunity.status === 'OPEN' && (
            <OutcomeActions opportunityId={opportunity.id} lossReasons={lossReasons} />
          )}
        </div>
      </header>

      <StageRail
        stages={opportunity.pipeline.stages as any}
        currentKey={opportunity.stage.key}
        compact
      />

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', maxWidth: 420, marginTop: 'var(--lf-space-4)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>Details</div>
        <dl style={{ display: 'grid', gap: 'var(--lf-space-3)', margin: 0 }}>
          {([
            ['Probability', `${opportunity.probability}%`],
            ['Expected close', opportunity.expectedCloseDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—'],
            ['Actual close', opportunity.actualCloseDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—'],
            ['Competitor', opportunity.competitor ?? '—'],
            ...(opportunity.status === 'LOST' ? [['Loss notes', safe.lossNotes ?? '—']] as const : []),
            ['Created', opportunity.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="lf-label">{label}</dt>
              <dd style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', wordBreak: 'break-word' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
