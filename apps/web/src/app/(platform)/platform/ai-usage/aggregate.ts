import { AI_METRIC_PREFIX, type PaidBy } from '@/lib/ai/usage';

/**
 * Turning `WorkspaceUsage` rows into the three numbers an operator asked for.
 *
 * Separate from `page.tsx` because it is the part with decisions in it — which
 * bucket a row falls into, what counts as close to a limit, what order the
 * table is in — and those are worth pinning in a spec rather than inferring
 * from a rendered tree.
 */

/** One `WorkspaceUsage` row, narrowed to the columns this page selects. */
export type UsageRow = { tenantId: string; metric: string; used: number; measuredAt: Date };

export type TenantSpend = {
  tenantId: string;
  /** Tokens on the shared deployment key — our bill, and the capped one. */
  deployment: number;
  /** Tokens on the workspace's own key — their bill, never capped. */
  workspace: number;
  /** Recorded before the payer was split out of the metric key. */
  unattributed: number;
  allowance: number | null;
  measuredAt: Date | null;
};

/**
 * `ai_tokens:deployment:2026-08` → `deployment`; `ai_tokens:2026-08` → null.
 *
 * Read structurally rather than compared against `usageMetric(payer)`, so this
 * answers for any month and not only the one the clock happens to be in.
 */
export function payerOf(metric: string): PaidBy | null {
  if (!metric.startsWith(AI_METRIC_PREFIX)) return null;
  const parts = metric.split(':');
  if (parts.length !== 3) return null;
  return parts[1] === 'deployment' || parts[1] === 'workspace' ? parts[1] : null;
}

/**
 * Over this share of the allowance is where somebody wants telling, while there
 * is still time to raise the plan limit rather than after the refusal.
 */
export const NEAR_LIMIT_FRACTION = 0.8;

export function aggregate(
  usage: UsageRow[],
  allowanceOf: ReadonlyMap<string, number | null>,
): {
  table: TenantSpend[];
  totals: { deployment: number; workspace: number; unattributed: number };
  nearLimit: TenantSpend[];
} {
  const byTenant = new Map<string, TenantSpend>();

  for (const entry of usage) {
    const row = byTenant.get(entry.tenantId) ?? {
      tenantId: entry.tenantId,
      deployment: 0,
      workspace: 0,
      unattributed: 0,
      allowance: allowanceOf.get(entry.tenantId) ?? null,
      measuredAt: null,
    };
    const payer = payerOf(entry.metric);
    // Unattributed rows are real spend that cannot be assigned retroactively.
    // They get their own column rather than being folded into either side,
    // which would misstate a bill, or dropped, which would hide one.
    if (payer) row[payer] += entry.used;
    else row.unattributed += entry.used;
    if (!row.measuredAt || entry.measuredAt > row.measuredAt) row.measuredAt = entry.measuredAt;
    byTenant.set(entry.tenantId, row);
  }

  // Heaviest deployment spend first: it is the bill, and it is the column the
  // ceiling governs. Own-key spend breaks ties so the order is stable.
  const table = [...byTenant.values()].sort((a, b) => b.deployment - a.deployment || b.workspace - a.workspace);

  const totals = table.reduce(
    (acc, row) => ({
      deployment: acc.deployment + row.deployment,
      workspace: acc.workspace + row.workspace,
      unattributed: acc.unattributed + row.unattributed,
    }),
    { deployment: 0, workspace: 0, unattributed: 0 },
  );

  // Against the deployment column alone, because that is the only one
  // `assertAiBudget` measures. Warning a workspace about an allowance its own
  // key never touches is a false alarm that teaches people to ignore the table.
  const nearLimit = table.filter(
    (row) => row.allowance !== null && row.deployment >= row.allowance * NEAR_LIMIT_FRACTION,
  );

  return { table, totals, nearLimit };
}
