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

/**
 * The rule that decides whether an entitlement row grants access.
 *
 * Exported because it was being re-implemented by eye on every surface that
 * shows a module, and the copies disagreed: the workspace layout tested state
 * *and* `endsAt`, the dashboard tested only state, and the API tested both. A
 * subscription left ACTIVE past its end date was therefore refused by every
 * endpoint while still being advertised on the landing page and the sidebar.
 *
 * `endsAt` is the hard stop — the same rule `isProductSubscriptionUsable` in
 * services/platform/subscriptions.ts applies to the purchase this row is derived
 * from, so the projection cannot outlive the product it projects.
 */
export function isEntitlementUsable(
  entitlement: { state: string; endsAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!entitlement) return false;
  if (!['TRIAL', 'ACTIVE', 'GRACE'].includes(entitlement.state)) return false;
  if (!entitlement.endsAt) return true;
  return new Date(entitlement.endsAt) > now;
}

/**
 * The modules a workspace can actually use, from rows already loaded.
 *
 * For callers that hold `tenant.moduleEntitlements` — the layout, the dashboard,
 * the product switcher — so they answer "which products does this company have"
 * with the same rule the API gate uses, without a second query.
 */
export function usableModules(
  entitlements: readonly { module: string; state: string; endsAt?: Date | string | null }[],
  now: Date = new Date(),
): ProductModule[] {
  return entitlements
    .filter((entitlement) => isEntitlementUsable(entitlement, now))
    .map((entitlement) => entitlement.module)
    .filter((module): module is ProductModule => (PRODUCT_MODULES as readonly string[]).includes(module));
}

export async function assertModuleEntitlement(tenantId: string, module: ProductModule) {
  const entitlement = await cached<CachedEntitlement | null>(key(tenantId, module), TTL_SECONDS, async () => {
    const row = await prisma.moduleEntitlement.findUnique({
      where: { tenantId_module: { tenantId, module } },
    });
    return row ? { state: row.state, endsAt: row.endsAt?.toISOString() ?? null } : null;
  });

  if (!isEntitlementUsable(entitlement)) {
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
