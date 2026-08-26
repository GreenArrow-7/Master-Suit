import { prisma } from '../db';
import { cached, redis } from '../redis';
import { Forbidden } from '../errors';

export type ProductModule = 'HRMS' | 'SALES';

/**
 * Every module, so invalidation can name its keys instead of searching for them.
 *
 * `satisfies` rather than a plain annotation: adding a third module to the union
 * without adding it here is a compile error, which is the only thing that stops
 * a new module's entitlement surviving a revoke for up to a TTL. Same idiom as
 * `RESOURCE_PERMISSION` in lib/security/rbac.ts, and for the same reason — a
 * list that has to be kept in step by hand eventually is not.
 */
const PRODUCT_MODULES = ['HRMS', 'SALES'] as const satisfies readonly ProductModule[];

/**
 * Short, and deliberately so.
 *
 * This runs on every API request and every workspace page, so uncached it was a
 * database round-trip per request across the whole platform. But it is also the
 * check that stops a workspace using a module it no longer pays for, and a long
 * TTL would mean a cancelled subscription kept working for as long as the TTL —
 * so the window is a minute, and disabling a module clears the key outright.
 */
const TTL_SECONDS = 60;

const key = (tenantId: string, module: ProductModule) => `t:${tenantId}:ent:${module}`;

/** What the check needs. Cached as JSON, so `endsAt` crosses as a string. */
interface CachedEntitlement {
  state: string;
  endsAt: string | null;
}

export async function assertModuleEntitlement(tenantId: string, module: ProductModule) {
  const entitlement = await cached<CachedEntitlement | null>(key(tenantId, module), TTL_SECONDS, async () => {
    const row = await prisma.moduleEntitlement.findUnique({
      where: { tenantId_module: { tenantId, module } },
    });
    return row ? { state: row.state, endsAt: row.endsAt?.toISOString() ?? null } : null;
  });

  const usable =
    entitlement &&
    ['TRIAL', 'ACTIVE', 'GRACE'].includes(entitlement.state) &&
    (!entitlement.endsAt || new Date(entitlement.endsAt) > new Date());
  if (!usable) {
    throw Forbidden(`${module === 'HRMS' ? 'HR' : 'Sales'} is not enabled for this company.`);
  }
  return entitlement;
}

/**
 * Call after any write to a workspace's module entitlements.
 *
 * Without this, revoking a module leaves it working for up to a minute. That is
 * a short window, but it is the wrong side of the trade to leave to a timeout.
 *
 * ── Why this deletes by name rather than sweeping ───────────────────────────
 *
 * It used to call `invalidate('t:<id>:ent:*')`, which ran a `SCAN`. The cost of
 * a SCAN sweep is O(*whole keyspace*), not O(matching keys): Redis has to walk
 * every key in the database to find the ones that match. This cache holds
 * exactly two keys per tenant, so the sweep visited every cached actor, every
 * live rate-limit counter and all of BullMQ's bookkeeping in order to delete
 * two — on every subscription edit.
 *
 * The assessment's recommendation was to version the values the way
 * lib/auth/actorCache.ts does. That shape exists because *that* cache holds one
 * key per signed-in user, so its keys cannot be enumerated. These can: the
 * module list is a closed union of two. Naming them is exact, needs no version
 * counter, and leaves nothing to go stale.
 */
export async function invalidateEntitlements(tenantId: string) {
  await redis.del(...PRODUCT_MODULES.map((module) => key(tenantId, module)));
}
