/**
 * The platform console's AI usage page — the read, and the arithmetic.
 *
 * `recordAiUsage` had been writing per-workspace token counts to
 * `WorkspaceUsage` since the metering went in and nothing under `src/app` ever
 * rendered them. A number collected and never shown is the same as a number not
 * collected, except that it looks finished.
 *
 * Two halves are worth pinning, for different reasons:
 *
 *  - **The read** has two ways to come back empty that are indistinguishable
 *    from a quiet month — the tenant guard refusing it, and RLS matching an
 *    unset setting. Neither raises anything a reader of the page would notice.
 *  - **The arithmetic** decides what the operator is told they owe, so the
 *    bucket split, the ordering and the near-limit threshold are all answers
 *    somebody acts on.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { AI_METRIC_PREFIX, AI_TOKEN_LIMIT_KEY, usageMetric } from '@/lib/ai/usage';
import { aggregate, payerOf, NEAR_LIMIT_FRACTION, type UsageRow } from '@/app/(platform)/platform/ai-usage/aggregate';

const suffix = randomBytes(4).toString('hex');

/**
 * A month far enough out that no real row shares it, so the cross-tenant reads
 * below can assert exact counts against a shared database.
 */
const MONTH = '9999-01';
const metric = (paidBy: 'deployment' | 'workspace') => `${AI_METRIC_PREFIX}${paidBy}:${MONTH}`;

/** The page's own filter, so a change to it breaks these tests rather than the page. */
const thisMonth = { metric: { startsWith: AI_METRIC_PREFIX, endsWith: MONTH } };

let heavy = '';
let light = '';

beforeAll(async () => {
  for (const label of ['heavy', 'light'] as const) {
    const tenant = await prisma.tenant.create({
      data: { slug: `aiconsole-${label}-${suffix}`, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
    });
    if (label === 'heavy') heavy = tenant.id;
    else light = tenant.id;
  }
  // One at a time, and not `createMany`. A batch spanning two tenants cannot be
  // pinned to a single `app.tenant_id`, so the guard leaves the setting unset
  // and every row fails `WorkspaceUsage`'s RLS WITH CHECK. Naming one tenant
  // per statement is what pins it.
  for (const row of [
    { tenantId: heavy, metric: metric('deployment'), used: 900, measuredAt: new Date('2026-01-02T00:00:00Z') },
    { tenantId: heavy, metric: metric('workspace'), used: 10, measuredAt: new Date('2026-01-03T00:00:00Z') },
    { tenantId: light, metric: metric('deployment'), used: 5, measuredAt: new Date('2026-01-01T00:00:00Z') },
  ]) {
    await prisma.workspaceUsage.create({ data: row });
  }
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [heavy, light] } } });
});

/**
 * Every assertion here is about a query returning *nothing* for a reason that
 * looks like an idle month. That is the failure this page cannot survive: an
 * operator reading "no AI usage recorded" and believing it.
 */
describe('the cross-tenant read', () => {
  it('sees every workspace inside a platform transaction', async () => {
    const rows = await withPlatformTx((tx) =>
      tx.workspaceUsage.findMany({ where: { tenantId: { not: '' }, ...thisMonth } }),
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([heavy, light]));
  });

  it('sees nothing at all outside one — silently, which is the danger', async () => {
    // Same query, same filter, no `app.platform_admin`. `WorkspaceUsage` is
    // FORCE ROW LEVEL SECURITY, so its policy is matched against an unset
    // setting and every row fails it. No error is raised: the page would render
    // its empty state and an operator would read it as a quiet month.
    const rows = await prisma.workspaceUsage.findMany({ where: { tenantId: { not: '' }, ...thisMonth } });
    expect(rows).toHaveLength(0);
  });

  it('is refused outright without the cross-tenant marker in the filter', async () => {
    // `tenantId: { not: '' }` is not decoration. Drop it and the tenant guard
    // rejects the query before Postgres sees it — which is the guard working,
    // and the reason the page says out loud that it means to span tenants.
    await expect(withPlatformTx((tx) => tx.workspaceUsage.findMany({ where: thisMonth }))).rejects.toThrow(
      /without a tenantId filter/,
    );
  });

  /**
   * The contrast that makes the rule legible rather than cargo-culted.
   *
   * The workspace detail page reads the same FORCE-RLS table through a plain
   * `prisma` client and is correct, because the guard special-cases `Tenant`
   * keyed by id and pins `app.tenant_id` from it before running the include.
   * The AI usage page has no id to pin from, which is the whole difference.
   */
  it('resolves a nested include through the tenant id, no platform transaction needed', async () => {
    const workspace = await prisma.tenant.findFirst({
      where: { id: heavy, deletedAt: null },
      include: { workspaceUsage: true },
    });
    expect(workspace?.workspaceUsage.length).toBeGreaterThanOrEqual(2);
  });
});

describe('payerOf', () => {
  it('reads the payer out of the metric key', () => {
    expect(payerOf('ai_tokens:deployment:2026-08')).toBe('deployment');
    expect(payerOf('ai_tokens:workspace:2026-08')).toBe('workspace');
  });

  it('answers for any month, not only the one the clock is in', () => {
    // Compared structurally rather than against `usageMetric(payer)`, which
    // would silently stop matching every row on the first of the month.
    expect(payerOf('ai_tokens:deployment:1999-12')).toBe('deployment');
    expect(payerOf(usageMetric('workspace', new Date('2031-06-04T00:00:00Z')))).toBe('workspace');
  });

  it('leaves the pre-split key unattributed rather than guessing', () => {
    // Real spend, from before the payer was in the key. Assigning it to either
    // side would misstate a bill; dropping it would hide one.
    expect(payerOf('ai_tokens:2026-08')).toBeNull();
  });

  it('does not claim rows it has no business reading', () => {
    expect(payerOf('storage_mb')).toBeNull();
    expect(payerOf('users')).toBeNull();
    expect(payerOf('ai_tokens:something-else:2026-08')).toBeNull();
  });
});

describe('aggregate', () => {
  const at = (iso: string) => new Date(iso);
  const rows: UsageRow[] = [
    { tenantId: 'a', metric: 'ai_tokens:deployment:2026-08', used: 100, measuredAt: at('2026-08-01T00:00:00Z') },
    { tenantId: 'a', metric: 'ai_tokens:workspace:2026-08', used: 7_000, measuredAt: at('2026-08-09T00:00:00Z') },
    { tenantId: 'b', metric: 'ai_tokens:deployment:2026-08', used: 400, measuredAt: at('2026-08-05T00:00:00Z') },
    { tenantId: 'b', metric: 'ai_tokens:2026-08', used: 25, measuredAt: at('2026-08-02T00:00:00Z') },
  ];
  const allowances = new Map<string, number | null>([
    ['a', 1_000],
    ['b', null],
  ]);

  it('keeps the two payers in separate columns', () => {
    const { table } = aggregate(rows, allowances);
    const a = table.find((r) => r.tenantId === 'a')!;
    // Summing these would answer neither "what do we owe" nor "who is heavy":
    // 7,000 of a's tokens are billed to a's own vendor account, not to us.
    expect(a.deployment).toBe(100);
    expect(a.workspace).toBe(7_000);
  });

  it('gives pre-split rows their own column', () => {
    const { table, totals } = aggregate(rows, allowances);
    expect(table.find((r) => r.tenantId === 'b')!.unattributed).toBe(25);
    expect(totals.unattributed).toBe(25);
    // And they stay out of both real columns.
    expect(totals.deployment).toBe(500);
    expect(totals.workspace).toBe(7_000);
  });

  it('orders by deployment spend, because that is the bill', () => {
    // b spends 400 of ours against a's 100, even though a burns seventy times
    // more tokens overall on its own key.
    expect(aggregate(rows, allowances).table.map((r) => r.tenantId)).toEqual(['b', 'a']);
  });

  it('reports the most recent measurement per workspace', () => {
    const a = aggregate(rows, allowances).table.find((r) => r.tenantId === 'a')!;
    expect(a.measuredAt).toEqual(at('2026-08-09T00:00:00Z'));
  });

  it('carries the allowance through, and distinguishes “none set” from zero', () => {
    const { table } = aggregate(rows, allowances);
    expect(table.find((r) => r.tenantId === 'a')!.allowance).toBe(1_000);
    // Null, not 0 and not Infinity: nobody has decided a number for b. The page
    // renders that as "not set" rather than as "unlimited".
    expect(table.find((r) => r.tenantId === 'b')!.allowance).toBeNull();
  });

  it('warns on deployment spend only, never on a workspace’s own key', () => {
    // a is at 7,000 tokens against an allowance of 1,000 — and must not appear,
    // because `assertAiBudget` will never refuse it: all but 100 of those
    // tokens were paid for by a's own credential.
    expect(aggregate(rows, allowances).nearLimit).toHaveLength(0);
  });

  it('warns once deployment spend crosses the threshold', () => {
    const hot: UsageRow[] = [
      {
        tenantId: 'a',
        metric: 'ai_tokens:deployment:2026-08',
        used: 1_000 * NEAR_LIMIT_FRACTION,
        measuredAt: at('2026-08-01T00:00:00Z'),
      },
    ];
    expect(aggregate(hot, allowances).nearLimit.map((r) => r.tenantId)).toEqual(['a']);
    // Just under stays quiet, so the warning still means something.
    const cool = [{ ...hot[0], used: 1_000 * NEAR_LIMIT_FRACTION - 1 }];
    expect(aggregate(cool, allowances).nearLimit).toHaveLength(0);
  });

  it('never warns a workspace with no allowance configured', () => {
    // There is no threshold to be near. Warning here would ask an operator to
    // act on a limit that does not exist.
    const huge: UsageRow[] = [
      {
        tenantId: 'b',
        metric: 'ai_tokens:deployment:2026-08',
        used: 10_000_000,
        measuredAt: at('2026-08-01T00:00:00Z'),
      },
    ];
    expect(aggregate(huge, allowances).nearLimit).toHaveLength(0);
  });

  it('handles a month with nothing recorded', () => {
    const { table, totals, nearLimit } = aggregate([], allowances);
    expect(table).toEqual([]);
    expect(totals).toEqual({ deployment: 0, workspace: 0, unattributed: 0 });
    expect(nearLimit).toEqual([]);
  });
});

/**
 * The page itself, rendered.
 *
 * The describes above prove the query shape and the arithmetic separately; this
 * one proves the page uses them. Without it, dropping `withPlatformTx` from the
 * page's own read passes every other test here and ships a console that reports
 * no AI usage, ever.
 */
describe('the rendered page', () => {
  let live = '';

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `aiconsole-live-${suffix}`,
        legalName: 'Live LLC',
        displayName: `Live ${suffix}`,
        status: 'ACTIVE',
      },
    });
    live = tenant.id;
    // The current month, because that is the only one the page renders.
    await prisma.workspaceUsage.create({
      data: { tenantId: live, metric: usageMetric('deployment'), used: 1_234, measuredAt: new Date() },
    });
    await prisma.workspaceUsage.create({
      data: { tenantId: live, metric: usageMetric('workspace'), used: 77, measuredAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: live } });
  });

  /** Every string in the element tree, including the arrays tables take as props. */
  function strings(node: unknown, out: string[] = []): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return out;
    }
    if (Array.isArray(node)) {
      for (const child of node) strings(child, out);
      return out;
    }
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) for (const value of [props.children, props.rows, props.headers]) strings(value, out);
    return out;
  }

  it('puts the workspace’s spend on the page, both columns', async () => {
    const { default: AiUsagePage } = await import('@/app/(platform)/platform/ai-usage/page');
    const text = strings(await AiUsagePage());

    // The name is what an operator scans for; the numbers are what they act on.
    expect(text).toContain(`Live ${suffix}`);
    expect(text).toContain('1,234');
    expect(text).toContain('77');
    // No plan limit was configured, and that reads as undecided rather than as
    // permission to spend without bound.
    expect(text).toContain('not set');
  });
});

/**
 * End to end over the real rows: what the page would put on screen for the two
 * workspaces created above, read the way the page reads them.
 */
describe('the page’s numbers', () => {
  it('adds up from the database through the aggregation', async () => {
    const { usage, allowanceOf } = await withPlatformTx(async (tx) => {
      const usage = await tx.workspaceUsage.findMany({
        where: { tenantId: { not: '' }, ...thisMonth },
        select: { tenantId: true, metric: true, used: true, measuredAt: true },
      });
      const subs = await tx.tenantSubscription.findMany({
        where: { tenantId: { in: [...new Set(usage.map((u) => u.tenantId))] } },
        select: {
          tenantId: true,
          plan: { select: { planLimits: { where: { key: AI_TOKEN_LIMIT_KEY }, select: { value: true } } } },
        },
      });
      return {
        usage,
        allowanceOf: new Map(
          subs.map((s) => [
            s.tenantId,
            typeof s.plan?.planLimits[0]?.value === 'number' ? s.plan.planLimits[0].value : null,
          ]),
        ),
      };
    });

    const { table, totals } = aggregate(usage, allowanceOf);
    expect(totals).toEqual({ deployment: 905, workspace: 10, unattributed: 0 });
    expect(table.map((r) => r.tenantId)).toEqual([heavy, light]);
    expect(table[0]).toMatchObject({ deployment: 900, workspace: 10, allowance: null });
  });
});
