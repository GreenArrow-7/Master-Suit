import { prisma } from '../db';
import { cached, invalidate } from '../redis';
import { Forbidden } from '../errors';

export type ProductModule = 'HRMS' | 'SALES';

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
 */
export async function invalidateEntitlements(tenantId: string) {
  await invalidate(`t:${tenantId}:ent:*`);
}
