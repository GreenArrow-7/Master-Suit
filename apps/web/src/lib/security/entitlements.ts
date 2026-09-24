import { prisma } from '../db';
import { cached, redis } from '../redis';
import { Forbidden } from '../errors';

export type ProductModule = 'HRMS' | 'SALES' | 'REAL_ESTATE';

/**
 * Every module, so invalidation can name its keys instead of searching for them.
 *
 * `satisfies` rather than a plain annotation: adding a third module to the union
 * without adding it here is a compile error, which is the only thing that stops
 * a new module's entitlement surviving a revoke for up to a TTL. Same idiom as
 * `RESOURCE_PERMISSION` in lib/security/rbac.ts, and for the same reason — a
 * list that has to be kept in step by hand eventually is not.
 */
const PRODUCT_MODULES = ['HRMS', 'SALES', 'REAL_ESTATE'] as const satisfies readonly ProductModule[];

/**
 * What each module is called when we have to tell somebody they cannot use it.
 *
 * This was `module === 'HRMS' ? 'HR' : 'Sales'`, which was true while there were
 * two modules and became a lie on the third: a workspace without Real Estate was
 * told "Sales is not enabled for this company", naming a product it may well be
 * paying for. A record keyed by the union is a compile error when a module is
 * added without a name, which the ternary could never be.
 */
const MODULE_LABEL: Record<ProductModule, string> = {
  HRMS: 'HR',
  SALES: 'Sales',
  REAL_ESTATE: 'Real Estate',
};

/**
 * The screens Sales and Real Estate genuinely share.
 *
 * Leads, follow-ups, calls and site visits are one register read two ways, not
 * two registers — the brief was explicit that Real Estate must not grow a
 * parallel `RealEstateLead`. So the page files live under `sales/` and the
 * `realty/` routes re-export them, and the entitlement they assert has to be
 * "either product", because the workspace reaching them may be paying for only
 * one. The `realty/` and `sales/` layouts still assert their own module, so the
 * specific URL is gated exactly as before; this only stops the page beneath
 * refusing a Real Estate workspace for not owning Sales.
 */
export const SALES_OR_REALTY = ['SALES', 'REAL_ESTATE'] as const satisfies readonly ProductModule[];

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
    throw Forbidden(`${MODULE_LABEL[module]} is not enabled for this company.`);
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

/** The states an entitlement can be usable in. Expiry is decided separately. */
export const USABLE_ENTITLEMENT_STATES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;

/**
 * One rule for "is this entitlement usable", for the readers outside the API
 * gate above: the workspace dashboard's module cards, the platform console's
 * entitled-workspace counts and the P&L's payroll margin each carried their own
 * copy that tested the state and forgot `endsAt`, so an entitlement that had
 * expired was still advertised and still used while this gate refused it.
 */
export function isEntitlementUsable(
  entitlement: { state: string; endsAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!entitlement) return false;
  if (!(USABLE_ENTITLEMENT_STATES as readonly string[]).includes(entitlement.state)) return false;
  return !entitlement.endsAt || new Date(entitlement.endsAt) > now;
}

/** The same rule as a Prisma `where` fragment, for queries that count or filter. */
export function usableEntitlementWhere(now: Date = new Date()) {
  return {
    state: { in: [...USABLE_ENTITLEMENT_STATES] },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
}
