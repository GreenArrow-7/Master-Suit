import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import StageRail from '@/components/ui/StageRail';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import EntityDelete from '@/components/sales/EntityDelete';
import OutcomeActions from './OutcomeActions';

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['opportunities', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
  const opportunity = await prisma.opportunity.findFirst({
    where: { ...scope, id },
    include: {
      stage: true,
      pipeline: {
        include: { stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, category: true } } },
      },
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
      <SalesLink href="/opportunities" style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← Opportunities
      </SalesLink>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--lf-space-4)',
          margin: 'var(--lf-space-3) 0 var(--lf-space-4)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            {opportunity.name}
          </h1>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginTop: 4, flexWrap: 'wrap' }}
          >
            <span className="lf-num" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              {opportunity.reference}
            </span>
            <Badge value={opportunity.status} />
            {opportunity.account && (
              <SalesLink href={`/accounts/${opportunity.account.id}`}>{opportunity.account.name}</SalesLink>
            )}
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              Owner:{' '}
              {opportunity.owner?.fullName ?? (
                <em style={{ color: 'var(--lf-wine-700)', fontStyle: 'normal' }}>Unassigned</em>
              )}
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--lf-space-2)' }}>
          {can(ctx, 'opportunities', 'EDIT') && opportunity.status === 'OPEN' && (
            <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={`/opportunities/${opportunity.id}/edit`}>
              Edit
            </SalesLink>
          )}
          {can(ctx, 'opportunities', 'EDIT') && opportunity.status === 'OPEN' && (
            <OutcomeActions opportunityId={opportunity.id} lossReasons={lossReasons} />
          )}
          {can(ctx, 'opportunities', 'DELETE') && (
            <EntityDelete
              endpoint={`/api/v1/opportunities/${opportunity.id}`}
              backHref="/opportunities"
              label="opportunity"
            />
          )}
        </div>
      </header>

      <StageRail stages={opportunity.pipeline.stages as any} currentKey={opportunity.stage.key} compact />

      {/* The deal in one sentence — value, odds, dates — then the quieter
          facts. Same fact-strip family as the lead and call pages. */}
      <section
        className="lf-card"
        style={{ padding: 'var(--lf-space-4) var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}
      >
        <div className="lf-stat-strip lf-stat-strip--light">
          <div>
            <span className="lf-figure lf-num" style={{ fontSize: '1.4rem' }}>
              {opportunity.currency} {Number(opportunity.amount).toLocaleString('en-AE')}
            </span>
            <span className="lf-eyebrow">Amount</span>
          </div>
          <div>
            <span className="lf-figure" style={{ fontSize: '1.4rem' }}>
              {opportunity.probability}%
            </span>
            <span className="lf-eyebrow">Probability</span>
          </div>
          <div>
            <span className="lf-figure" style={{ fontSize: '1.4rem' }}>
              {opportunity.expectedCloseDate?.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }) ?? '—'}
            </span>
            <span className="lf-eyebrow">Expected close</span>
          </div>
          <div>
            <span className="lf-figure" style={{ fontSize: '1.4rem' }}>
              {opportunity.actualCloseDate?.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }) ??
                opportunity.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span className="lf-eyebrow">{opportunity.actualCloseDate ? 'Actual close' : 'Created'}</span>
          </div>
        </div>

        {(opportunity.competitor || opportunity.status === 'LOST') && (
          <dl className="lf-facts" style={{ margin: 'var(--lf-space-4) 0 0' }}>
            {opportunity.competitor && (
              <div>
                <dt className="lf-label">Competitor</dt>
                <dd style={{ margin: '3px 0 0', fontSize: 'var(--lf-text-sm)' }}>{opportunity.competitor}</dd>
              </div>
            )}
            {opportunity.status === 'LOST' && (
              <div>
                <dt className="lf-label">Loss notes</dt>
                <dd style={{ margin: '3px 0 0', fontSize: 'var(--lf-text-sm)', overflowWrap: 'anywhere' }}>
                  {safe.lossNotes ?? '—'}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>
    </>
  );
}
