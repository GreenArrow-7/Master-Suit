import { withPlatformTx } from '@/lib/db';
import {
  AI_IN_METRIC_PREFIX,
  AI_METRIC_PREFIX,
  AI_MODEL_METRIC_PREFIX,
  AI_OUT_METRIC_PREFIX,
  AI_TOKEN_LIMIT_KEY,
  estimateCostUsd,
  usageMetric,
} from '@/lib/ai/usage';
import { aggregate, aggregateModels } from './aggregate';

/**
 * Reads the console's numbers. **Not a route, and not a renderer.**
 *
 * This used to be half of an exported `renderAiUsage()` on `page.tsx`, which
 * meant the route module exposed a function that produced the whole protected
 * page without ever consulting `requirePlatformPage()`. Nothing called it that
 * way, but "nothing calls it yet" is not an authorization boundary, and
 * `BUG-008` is precisely what happens when protected content can be produced
 * down a path the guard does not sit on.
 *
 * The split is deliberate: `page.tsx` authorizes, then calls this, then hands
 * the result to a pure component. Data acquisition here, presentation in
 * `AiUsageView`, authorization only on the route.
 */
export async function loadAiUsage() {
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
    const direction = await tx.workspaceUsage.findMany({
      where: {
        tenantId: { not: '' },
        OR: [
          { metric: { startsWith: AI_IN_METRIC_PREFIX, endsWith: month } },
          { metric: { startsWith: AI_OUT_METRIC_PREFIX, endsWith: month } },
        ],
      },
      select: { metric: true, used: true },
    });
    return { rows: { usage, modelUsage, tenants, direction }, plans: subs };
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

  // Sent vs received on the shared key, and the estimate the stated prices give.
  const sum = (prefix: string) =>
    rows.direction.filter((r) => r.metric.startsWith(`${prefix}deployment:`)).reduce((n, r) => n + r.used, 0);
  const split = { input: sum(AI_IN_METRIC_PREFIX), output: sum(AI_OUT_METRIC_PREFIX) };
  const estimatedCostUsd = estimateCostUsd(split.input, split.output);
  return { table, totals, nearLimit, models, month, nameOf, split, estimatedCostUsd };
}

export type AiUsageData = Awaited<ReturnType<typeof loadAiUsage>>;
