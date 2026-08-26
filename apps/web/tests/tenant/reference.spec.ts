import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx, withPlatformTx } from '@/lib/db';
import { nextReference } from '@/services/shared/reference';

/**
 * Reference allocation, after the per-tenant sequences were replaced.
 *
 * `nextReference` used to do `CREATE SEQUENCE "ref_lead_<tenantid>"` lazily, one
 * sequence per tenant per object type. Ten types, so ten thousand tenants meant
 * up to a hundred thousand relations in pg_class — and it needed
 * `GRANT CREATE ON SCHEMA public` on the runtime role for the privilege of it.
 *
 * The cases here are the ones that distinguish a correct replacement from a
 * plausible one:
 *
 *   * Two concurrent *first* allocations. The old code checked for the sequence
 *     and then created it, so both saw it absent, both issued CREATE SEQUENCE,
 *     and the loser's whole transaction failed with "relation already exists".
 *     One instant per tenant per object type — which is a new customer's first
 *     record.
 *   * Seeding when rows already exist. Starting at 1 hands out a reference that
 *     is taken, the unique index rejects it, the transaction rolls back — and
 *     with the old code that rolled back the CREATE SEQUENCE too, so the next
 *     attempt started at 1 and failed identically, permanently.
 *   * Isolation. Allocation is raw SQL, which the Prisma tenant guard does not
 *     see. Row-level security is the only thing standing between a mistake in
 *     that query and one tenant advancing another's counter.
 */

const suffix = randomBytes(4).toString('hex');
const tenants = [
  { slug: `ref-a-${suffix}`, id: '' },
  { slug: `ref-b-${suffix}`, id: '' },
];

beforeAll(async () => {
  for (const workspace of tenants) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;
  }
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    for (const workspace of tenants) {
      if (workspace.id) await tx.tenant.delete({ where: { id: workspace.id } });
    }
  });
});

const alloc = (tenantId: string, type: string) => withTx(tenantId, (tx) => nextReference(tx, tenantId, type));

describe('allocation', () => {
  it('starts at 1 and increments, formatted', async () => {
    const [a, b, c] = [
      await alloc(tenants[0]!.id, 'TICKET'),
      await alloc(tenants[0]!.id, 'TICKET'),
      await alloc(tenants[0]!.id, 'TICKET'),
    ];
    expect([a, b, c]).toEqual(['TK-000001', 'TK-000002', 'TK-000003']);
  });

  it('counts each object type separately', async () => {
    expect(await alloc(tenants[0]!.id, 'PRODUCT')).toBe('PR-000001');
    expect(await alloc(tenants[0]!.id, 'CAMPAIGN')).toBe('CP-000001');
    // TICKET is three in from the case above and must not have moved.
    expect(await alloc(tenants[0]!.id, 'TICKET')).toBe('TK-000004');
  });

  it('counts each tenant separately', async () => {
    expect(await alloc(tenants[1]!.id, 'TICKET')).toBe('TK-000001');
    expect(await alloc(tenants[0]!.id, 'TICKET')).toBe('TK-000005');
  });

  it('falls back to RC for an object type with no declared prefix', async () => {
    expect(await alloc(tenants[0]!.id, 'SOMETHING_NEW')).toBe('RC-000001');
  });

  it('creates exactly one row per tenant and object type, and no sequences', async () => {
    const rows = await withPlatformTx((tx) =>
      tx.tenantReferenceCounter.findMany({ where: { tenantId: tenants[0]!.id }, orderBy: { objectType: 'asc' } }),
    );
    expect(rows.map((r) => r.objectType)).toEqual(['CAMPAIGN', 'PRODUCT', 'SOMETHING_NEW', 'TICKET']);

    // The catalog itself, which is the thing this change is about.
    const sequences = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM pg_class WHERE relkind = 'S' AND relname LIKE 'ref\\_%'`,
    );
    expect(Number(sequences[0]!.count)).toBe(0);
  });
});

describe('seeding against rows that already exist', () => {
  it('continues past the highest existing reference rather than colliding', async () => {
    // An imported or restored workspace: rows carrying references, no counter.
    // Starting at 1 here trips the (tenantId, reference) unique index, and with
    // the old sequence that failure rolled back the CREATE too — so every
    // subsequent create failed the same way, forever.
    const tenantId = tenants[1]!.id;
    await prisma.account.create({
      data: { tenantId, name: 'Imported', reference: 'AC-000117' },
    });

    expect(await alloc(tenantId, 'ACCOUNT')).toBe('AC-000118');
    expect(await alloc(tenantId, 'ACCOUNT')).toBe('AC-000119');
  });

  it('ignores another tenant’s rows when seeding', async () => {
    // The MAX scan is filtered by tenantId. If it were not, a large neighbour
    // would push every new workspace's first reference into the thousands — and
    // reveal roughly how much data that neighbour holds.
    expect(await alloc(tenants[0]!.id, 'ACCOUNT')).toBe('AC-000001');
  });
});

describe('concurrency', () => {
  it('gives distinct numbers to two simultaneous first allocations', async () => {
    // The case the old CREATE SEQUENCE lost: both transactions find no counter,
    // both insert, and ON CONFLICT DO UPDATE makes the second increment what the
    // first wrote instead of failing.
    const tenantId = tenants[1]!.id;
    const results = await Promise.all([alloc(tenantId, 'LISTING'), alloc(tenantId, 'LISTING')]);
    expect(new Set(results).size).toBe(2);
    expect([...results].sort()).toEqual(['LS-000001', 'LS-000002']);
  });

  it('gives distinct numbers to many simultaneous allocations', async () => {
    const tenantId = tenants[0]!.id;
    const results = await Promise.all(Array.from({ length: 12 }, () => alloc(tenantId, 'BOOKING')));
    expect(new Set(results).size).toBe(12);
    expect([...results].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `BK-${String(i + 1).padStart(6, '0')}`));
  });
});

describe('isolation', () => {
  it('refuses to allocate with no tenant context rather than returning a bad reference', async () => {
    // Raw SQL, so the Prisma tenant guard never sees this query at all. Postgres
    // does: with no app.tenant_id the policy matches nothing, so the UPDATE
    // touches no row and the seed INSERT is refused by WITH CHECK.
    //
    // Asserted as "rejects, naming the policy" rather than against the explicit
    // throw in seed(), because Postgres raises 42501 first and the throw is
    // never reached on this path. That throw stays as the backstop for a
    // configuration where the policy permits the read but the write returns
    // nothing — the alternative there is `RC-NaN` persisted as a customer's
    // permanent reference.
    await expect(
      withPlatformTx(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'off', true)`);
        return nextReference(tx, tenants[0]!.id, 'PAYOUT');
      }),
    ).rejects.toThrow(/row-level security/i);

    // And nothing was written under that tenant on the way to failing.
    const rows = await withPlatformTx((tx) =>
      tx.tenantReferenceCounter.findMany({ where: { tenantId: tenants[0]!.id, objectType: 'PAYOUT' } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot advance another tenant’s counter', async () => {
    // Same shape as the tenant-guard tests: allocate for B while the transaction
    // is bound to A. RLS matches no row for B, so the UPDATE misses, the seed
    // INSERT is refused by WITH CHECK, and nothing is written under either id.
    const before = await withPlatformTx((tx) =>
      tx.tenantReferenceCounter.findMany({ where: { tenantId: tenants[1]!.id, objectType: 'TICKET' } }),
    );

    await expect(withTx(tenants[0]!.id, (tx) => nextReference(tx, tenants[1]!.id, 'TICKET'))).rejects.toThrow();

    const after = await withPlatformTx((tx) =>
      tx.tenantReferenceCounter.findMany({ where: { tenantId: tenants[1]!.id, objectType: 'TICKET' } }),
    );
    expect(after[0]?.counter).toBe(before[0]?.counter);
  });
});
