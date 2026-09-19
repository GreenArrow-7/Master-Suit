import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import type { AiUsageData } from './data';

/**
 * The console's presentation, and nothing else.
 *
 * Pure: props in, elements out. It reads no database, resolves no session and
 * makes no authorization decision, so importing it can never produce protected
 * data — there is none to produce until somebody hands it some. That is what
 * makes it safe to export where the old `renderAiUsage()` was not.
 */
const nf = new Intl.NumberFormat('en-GB');

export default function AiUsageView({
  table,
  totals,
  nearLimit,
  models,
  month,
  nameOf,
  split,
  estimatedCostUsd,
}: AiUsageData) {
  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Commercial"
        title={`AI usage · ${month}`}
        description="Tokens recorded this calendar month, UTC. Simulated answers cost nothing and are not counted."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'AI usage' }]}
      />

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          This month
        </h2>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
          <Stat label="On the deployment key" value={nf.format(totals.deployment)} hint="billed to us" />
          <Stat label="On workspaces’ own keys" value={nf.format(totals.workspace)} hint="billed to them" />
          <Stat label="Sent (input)" value={nf.format(split.input)} hint="shared key, this month" />
          <Stat label="Received (output)" value={nf.format(split.output)} hint="shared key, this month" />
          <Stat
            label="Estimated cost"
            value={estimatedCostUsd === null ? '—' : `$${estimatedCostUsd.toFixed(2)}`}
            hint={
              estimatedCostUsd === null
                ? 'set AI_COST_USD_PER_MILLION_INPUT / _OUTPUT to price it'
                : 'from the stated per-million prices'
            }
          />
          {totals.unattributed > 0 && (
            <Stat
              label="Unattributed"
              value={nf.format(totals.unattributed)}
              hint="recorded before the payer was split out"
            />
          )}
          <Stat label="Workspaces using AI" value={String(table.length)} hint="with any spend this month" />
        </div>
      </section>

      {nearLimit.length > 0 && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ marginBottom: 12 }}>
            Close to their allowance
          </h2>
          <WorkspaceTable
            headers={['Workspace', 'Deployment tokens', 'Allowance', 'Used']}
            rows={nearLimit.map((r) => [
              nameOf.get(r.tenantId) ?? r.tenantId,
              nf.format(r.deployment),
              nf.format(r.allowance!),
              `${Math.round((r.deployment / r.allowance!) * 100)}%`,
            ])}
          />
        </section>
      )}

      <section>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          By workspace and model
        </h2>
        <p style={{ margin: '0 0 12px', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          Which model each workspace is actually running, and whose key paid for it. Recorded as its own series, so
          these may lag the totals above by a call rather than reconciling to the token.
        </p>
        <WorkspaceTable
          headers={['Workspace', 'Model', 'Deployment', 'Own key', 'Total', 'Last recorded']}
          empty="No model-level usage recorded this month. Rows appear as calls are made."
          searchPlaceholder="Search workspaces or models"
          rows={models.map((m) => [
            nameOf.get(m.tenantId) ?? m.tenantId,
            m.model,
            nf.format(m.deployment),
            nf.format(m.workspace),
            nf.format(m.total),
            m.measuredAt ? m.measuredAt.toLocaleString('en-AE') : '—',
          ])}
        />
      </section>

      <section>
        <h2 className="lf-h2" style={{ marginBottom: 12 }}>
          By workspace
        </h2>
        <WorkspaceTable
          headers={['Workspace', 'Deployment', 'Own key', 'Allowance', 'Last recorded']}
          empty="No AI usage recorded this month."
          searchPlaceholder="Search workspaces"
          rows={table.map((r) => [
            nameOf.get(r.tenantId) ?? r.tenantId,
            nf.format(r.deployment),
            nf.format(r.workspace),
            // No allowance is "not decided", not "unlimited" — the ceiling is a
            // number nobody has set rather than one set to infinity.
            r.allowance === null ? 'not set' : nf.format(r.allowance),
            r.measuredAt?.toLocaleString('en-AE') ?? '—',
          ])}
        />
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="lf-hint" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--lf-text-2xl)', fontWeight: 600 }}>{value}</div>
      <div className="lf-hint">{hint}</div>
    </div>
  );
}
