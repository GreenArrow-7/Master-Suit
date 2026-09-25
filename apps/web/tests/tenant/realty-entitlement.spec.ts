import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { requestWorkspace } from '@/lib/workspace-page';
import { SALES_OR_REALTY, invalidateEntitlements } from '@/lib/security/entitlements';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Whether a workspace may open the shared client register.
 *
 * Leads, follow-ups, calls and site visits are one register served at two URLs,
 * `/{slug}/sales/leads` and `/{slug}/realty/leads`. The page file is shared, so
 * the entitlement it asserts has to be "either product" — a brokerage on a Real
 * Estate-only plan owns no Sales entitlement, and a page demanding SALES refuses
 * it the screen its own navigation offers.
 *
 * The drift guard in tests/unit/realty-routes.spec.ts asserts the pages *say*
 * `SALES_OR_REALTY`. This asserts what that actually does against real
 * entitlement rows, through the same helper the pages call.
 *
 * Entitlements are Redis-cached for a minute, so every row change here is
 * followed by an explicit invalidation — without it these tests would assert
 * against a previous test's cached answer, which is the kind of green that means
 * nothing.
 */
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');

/** Replace a workspace's entitlements with exactly this set, cache included. */
async function entitleOnly(tenantId: string, modules: readonly ('HRMS' | 'SALES' | 'REAL_ESTATE')[]) {
  await prisma.moduleEntitlement.deleteMany({ where: { tenantId } });
  if (modules.length) {
    await prisma.moduleEntitlement.createMany({
      data: modules.map((module) => ({ tenantId, module, state: 'ACTIVE' as const })),
    });
  }
  await invalidateEntitlements(tenantId);
}

describe('the shared register admits either product', () => {
  let pair: Fixture;

  beforeAll(async () => {
    pair = await seedTwoTenants();
  }, 120_000);

  afterAll(async () => {
    await pair.cleanup();
  });

  it('a Sales-only workspace reaches it', async () => {
    await entitleOnly(pair.a.tenantId, ['SALES']);
    const ctx = await ctxFrom(pair.a.cookie);
    await expect(requestWorkspace(ctx, pair.a.slug, SALES_OR_REALTY)).resolves.toBeTruthy();
  });

  /** The case the whole change exists for. */
  it('a Real Estate-only workspace reaches it', async () => {
    await entitleOnly(pair.a.tenantId, ['REAL_ESTATE']);
    const ctx = await ctxFrom(pair.a.cookie);
    await expect(requestWorkspace(ctx, pair.a.slug, SALES_OR_REALTY)).resolves.toBeTruthy();
  });

  it('a workspace owning neither is still refused', async () => {
    await entitleOnly(pair.a.tenantId, ['HRMS']);
    const ctx = await ctxFrom(pair.a.cookie);
    await expect(requestWorkspace(ctx, pair.a.slug, SALES_OR_REALTY)).rejects.toMatchObject({ status: 403 });
  });

  /**
   * "Either product" widens the shared page and nothing else. The per-URL gate
   * is the module layout, and a Sales-only workspace must still be refused
   * `/{slug}/realty/...` — otherwise the shared entitlement would have quietly
   * handed every Sales workspace the Real Estate module.
   */
  it('a Sales-only workspace is still refused the Real Estate module itself', async () => {
    await entitleOnly(pair.a.tenantId, ['SALES']);
    const ctx = await ctxFrom(pair.a.cookie);
    await expect(requestWorkspace(ctx, pair.a.slug, 'REAL_ESTATE')).rejects.toMatchObject({ status: 403 });
  });

  it('names the module it refused, not whichever one it checked first', async () => {
    await entitleOnly(pair.a.tenantId, ['SALES']);
    const ctx = await ctxFrom(pair.a.cookie);
    await expect(requestWorkspace(ctx, pair.a.slug, 'REAL_ESTATE')).rejects.toThrow(/Real Estate/);
    await entitleOnly(pair.a.tenantId, ['REAL_ESTATE']);
    await expect(requestWorkspace(await ctxFrom(pair.a.cookie), pair.a.slug, 'SALES')).rejects.toThrow(/Sales/);
  });

  /** Entitlement is per workspace: widening one must not reach the other. */
  it('does not leak across workspaces', async () => {
    await entitleOnly(pair.a.tenantId, ['REAL_ESTATE']);
    await entitleOnly(pair.b.tenantId, ['HRMS']);
    await expect(requestWorkspace(await ctxFrom(pair.a.cookie), pair.a.slug, SALES_OR_REALTY)).resolves.toBeTruthy();
    await expect(requestWorkspace(await ctxFrom(pair.b.cookie), pair.b.slug, SALES_OR_REALTY)).rejects.toMatchObject({
      status: 403,
    });
  });
});
