import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx, withTx } from '@/lib/db';

/**
 * The property that makes this schema safe behind a transaction pooler.
 *
 * Section 18 of the assessment recorded PgBouncer as blocked on design work:
 * "PgBouncer in transaction mode is **incompatible** with the current RLS
 * approach, because `set_config(..., true)` is transaction-local but the batched
 * `$transaction` pattern assumes it lands on the same connection. This needs
 * design work, not configuration."
 *
 * That is inverted, and this suite is why. Transaction-local *is* the safe
 * combination: a transaction pooler pins a server connection for the duration of
 * a transaction, so `BEGIN; set_config(…, true); SELECT …; COMMIT` lands whole on
 * one connection and the setting is discarded at COMMIT — before the connection
 * can be handed to anybody else.
 *
 * What is genuinely incompatible is *session*-level `set_config(…, false)`, which
 * this suite also demonstrates, so the assertion above is not merely a hopeful
 * one. Verified end to end on 2026-08-20 by running the whole 1,305-test suite
 * against PgBouncer 1.22 in `pool_mode = transaction`: all passed.
 *
 * These cases hold with or without a pooler in front, which is the point — they
 * guard the property rather than the deployment.
 */

const suffix = randomBytes(4).toString('hex');
const tenants = [
  { slug: `pool-a-${suffix}`, id: '', rows: 7 },
  { slug: `pool-b-${suffix}`, id: '', rows: 13 },
];

beforeAll(async () => {
  for (const workspace of tenants) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: workspace.slug, displayName: workspace.slug },
    });
    workspace.id = tenant.id;
    // Distinct counts, so a leak reads as the wrong number rather than as a
    // coincidence. TenantReferenceCounter is used because it is tenant-owned,
    // RLS-forced, and has no required relations to set up.
    await withTx(tenant.id, (tx) =>
      tx.tenantReferenceCounter.createMany({
        data: Array.from({ length: workspace.rows }, (_, i) => ({
          tenantId: tenant.id,
          objectType: `POOL_PROBE_${i}`,
          counter: 1,
        })),
      }),
    );
  }
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    for (const workspace of tenants) if (workspace.id) await tx.tenant.delete({ where: { id: workspace.id } });
  });
});

describe('the tenant setting is transaction-local', () => {
  it('does not survive the transaction that set it', async () => {
    // The whole safety argument in one assertion. If this ever reads back a
    // tenant id, the setting is outliving its transaction and the next borrower
    // of this pooled connection inherits it.
    await withTx(tenants[0]!.id, async (tx) => {
      const inside = await tx.$queryRawUnsafe<{ v: string | null }[]>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      );
      expect(inside[0]!.v).toBe(tenants[0]!.id);
    });

    const after = await prisma.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    );
    expect(after[0]!.v ?? '').toBe('');
  });

  it('gives each tenant its own rows under interleaved reads on one pool', async () => {
    // 40 reads alternating between two workspaces. On a pool small enough that
    // connections are reused constantly, a setting that outlived its transaction
    // shows up here as one tenant's count answering the other's query.
    const reads = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const workspace = tenants[i % 2]!;
        return withTx(workspace.id, (tx) =>
          tx.tenantReferenceCounter.count({ where: { tenantId: workspace.id } }),
        ).then((n) => n === workspace.rows);
      }),
    );
    expect(reads.every(Boolean)).toBe(true);
  });

  it('lets the platform flag expire with its transaction too', async () => {
    // app.platform_admin is the more dangerous of the two: leaked, it makes the
    // next borrower's queries cross-tenant.
    await withPlatformTx(async (tx) => {
      const inside = await tx.$queryRawUnsafe<{ v: string | null }[]>(
        `SELECT current_setting('app.platform_admin', true) AS v`,
      );
      expect(inside[0]!.v).toBe('on');
    });
    const after = await prisma.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT current_setting('app.platform_admin', true) AS v`,
    );
    expect(after[0]!.v ?? '').not.toBe('on');
  });
});

describe('what would not be safe', () => {
  it('shows that a session-level setting outlives its transaction', async () => {
    // Not a test of application code — nothing in src/ does this. It is here so
    // the assertions above are known to be capable of failing: the difference
    // between the safe pattern and the unsafe one is the third argument to
    // set_config, and this is what the unsafe one does.
    //
    // On its own connection, so the leak it deliberately creates cannot reach
    // the application's pool.
    const url = process.env.RLS_DATABASE_URL || process.env.DATABASE_URL!;
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenants[0]!.id]);
      await client.query('COMMIT');

      // A new transaction, which set nothing of its own.
      const { rows } = await client.query(`SELECT current_setting('app.tenant_id', true) AS v`);
      expect(rows[0].v).toBe(tenants[0]!.id);

      // And it reads that tenant's rows without having asked to.
      const leaked = await client.query('SELECT count(*)::int AS n FROM "TenantReferenceCounter"');
      expect(leaked.rows[0].n).toBe(tenants[0]!.rows);
    } finally {
      await client.end();
    }
  });
});
