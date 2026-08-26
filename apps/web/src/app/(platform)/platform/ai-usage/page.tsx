import { withPlatformTx } from '@/lib/db';
import { AI_METRIC_PREFIX, AI_MODEL_METRIC_PREFIX, AI_TOKEN_LIMIT_KEY, usageMetric } from '@/lib/ai/usage';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { aggregate, aggregateModels } from './aggregate';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI usage' };

/**
 * What the AI is costing, and whose key paid for it.
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 *
 * `recordAiUsage` has been writing per-workspace token counts to
 * `WorkspaceUsage` since the metering went in, and nothing under `src/app` ever
 * rendered them. The number was collected and never shown — which is the same
 * as not collecting it, except that it looked done.
 *
 * ── The two columns are not one number ─────────────────────────────────────
 *
 * A workspace on its own key spends its own quota against its own vendor bill;
 * a workspace on the deployment's key spends ours. Summing them answers
 * neither "what do we owe" nor "who is heavy". Only the deployment column is
 * governed by the plan ceiling, and only it is a cost to the operator reading
 * this page.
 */
const nf = new Intl.NumberFormat('en-GB');

export default async function AiUsagePage() {
  const month = usageMetric('deployment').split(':').pop()!;

  /**
   * `withPlatformTx` is load-bearing here, not tidiness. `WorkspaceUsage` is
   * FORCE ROW LEVEL SECURITY, so a read outside a transaction that sets
   * `app.platform_admin` matches its policy against an unset setting and comes
   * back with nothing — an empty page that reads as a quiet month rather than
   * as a broken query.
   *
   * Note the contrast with the workspace detail page, which reads the same
   * table through a plain `prisma.tenant.findFirst({ where: { id } })` and is
   * correct: the guard special-cases `Tenant` keyed by id and pins
   * `app.tenant_id` from it, so the nested include resolves. There is no id to
   * pin from here. Measured both ways: 1 row through the nested include, 0
   * through this query without the platform transaction.
   */
  const { rows, plans } = await withPlatformTx(async (tx) => {
    const usage = await tx.workspaceUsage.findMany({
      // `tenantId: { not: '' }` is how the console tells the tenant guard this
      // read is deliberately cross-tenant — the same shape the overview page
      // next door uses. It satisfies the guard's "filtered on tenantId" check
      // without naming one tenant, which is the honest description of the
      // query; RLS is still doing the real work through `app.platform_admin`.
      //
      // The month comes from the metric key rather than a date column, so
      // earlier months are separate rows and simply do not match.
      where: { tenantId: { not: '' }, metric: { startsWith: AI_METRIC_PREFIX, endsWith: month } },
      // Not `limit`: the row stamps whatever the allowance was when it was
      // first written this month, and a plan change since then should move the
      // ceiling. The live number comes from the plan below.
      select: { tenantId: true, metric: true, used: true, measuredAt: true },
    });
    // The per-model series, written beside the totals above. Same transaction,
    // because `WorkspaceUsage` is FORCE ROW LEVEL SECURITY and a read outside
    // one comes back empty rather than refused.
    const modelUsage = await tx.workspaceUsage.findMany({
      where: { tenantId: { not: '' }, metric: { startsWith: AI_MODEL_METRIC_PREFIX, endsWith: month } },
      select: { tenantId: true, metric: true, used: true, measuredAt: true },
    });
    const tenantIds = [...new Set([...usage, ...modelUsage].map((u) => u.tenantId))];
    const tenants = await tx.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, displayName: true, slug: true },
    });
    const subs = await tx.tenantSubscription.findMany({
      where: { tenantId: { in: tenantIds } },
      select: {
        tenantId: true,
        plan: { select: { name: true, planLimits: { where: { key: AI_TOKEN_LIMIT_KEY }, select: { value: true } } } },
      },
    });
    return { rows: { usage, modelUsage, tenants }, plans: subs };
  });
  // Deliberately not wrapped in a catch. A read that fails here and falls back
  // to an empty result renders as "nobody used the AI this month", which is the
  // one wrong answer this page can give — indistinguishable from the truth and
  // acted on the same way. Let it surface.

  const nameOf = new Map(rows.tenants.map((t) => [t.id, t.displayName || t.slug]));
  const allowanceOf = new Map(
    plans.map((s) => [
      s.tenantId,
      typeof s.plan?.planLimits[0]?.value === 'number' ? s.plan.planLimits[0].value : null,
    ]),
  );

  const { table, totals, nearLimit } = aggregate(rows.usage, allowanceOf);
  const models = aggregateModels(rows.modelUsage);

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
