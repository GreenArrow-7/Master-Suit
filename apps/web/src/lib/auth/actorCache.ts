import { redis } from '../redis';
import { logger } from '../logger';
import type { Actor, Scope } from '../security/rbac';

/**
 * The per-request permission build, cached.
 *
 * ── What it costs uncached ──────────────────────────────────────────────────
 *
 * `buildActor` runs on every authenticated request and issues three queries with
 * deep includes: the user with its role and every RolePermission row, every
 * in-window MembershipRole assignment with the same include again, and the list
 * of users this one manages. Section 18 of the assessment puts the ceiling at
 * roughly 300 organizations before that is the binding constraint — not because
 * any one query is slow, but because it is three of them per request, forever,
 * to answer a question whose answer changes when an administrator edits a role.
 *
 * ── Versioned keys, not deleted keys ────────────────────────────────────────
 *
 * The cache key does not carry the version; the *value* does, and a read
 * compares it against the current one. So invalidating a tenant is a single
 * `INCR` — every cached actor for that tenant becomes unreadable at once,
 * without finding or deleting anything.
 *
 * That shape was chosen against the alternative already in the codebase:
 * `invalidate()` in lib/redis.ts does a `SCAN`, which the assessment flags as
 * the thing that stops working at the key count this cache would produce. One
 * counter per tenant does not care how many users are cached under it.
 *
 * Invalidation is deliberately coarse — the whole tenant, not the affected
 * users. Working out which actors a role edit touches means resolving the role's
 * holders, their assignments, and everyone who manages them, and being wrong
 * about that means a revoked permission still works. Coarse is O(1) and cannot
 * be wrong; role edits are administrative and rare.
 *
 * ── The TTL is a backstop, not the mechanism ────────────────────────────────
 *
 * Revocation is immediate in the normal case: the bump is hooked into the Prisma
 * client (lib/db.ts), so any write to a model that feeds an actor invalidates
 * the tenant, and no call site has to remember. The TTL exists for what a hook
 * cannot cover — Redis unreachable at the moment of the bump, or a change made
 * directly against the database. A minute matches the entitlement cache, which
 * makes the same trade for the same reason.
 */
const TTL_SECONDS = 60;

/**
 * Bumped by a change to the global `Permission` catalogue, which has no tenant.
 * Renaming a permission changes the `module:ACTION` keys every cached map is
 * built from, so it has to reach every tenant at once.
 */
const GLOBAL_VERSION_KEY = 'rbac:ver:*global*';

const versionKey = (tenantId: string) => `rbac:ver:${tenantId}`;
const actorKey = (tenantId: string, userId: string) => `rbac:actor:${tenantId}:${userId}`;

/** JSON has no Map and no ReadonlyArray; this is the wire shape. */
interface CachedActor {
  /** `${globalVersion}:${tenantVersion}` as read at the moment it was cached. */
  v: string;
  a: Omit<Actor, 'permissions'> & { permissions: [string, Scope][] };
}

/**
 * Never throws.
 *
 * A cache that can fail a request is worse than no cache: Redis being
 * unreachable would take authentication down with it, and this exists to save
 * three queries, not to become a dependency of signing in. Every path here
 * degrades to "miss", and a miss means the database answers as it always did.
 */
export async function readCachedActor(tenantId: string, userId: string): Promise<Actor | null> {
  try {
    // One round trip for all three. The version keys have no TTL, so a value
    // whose stored version still matches is genuinely current.
    const [globalVersion, tenantVersion, raw] = await redis.mget(
      GLOBAL_VERSION_KEY,
      versionKey(tenantId),
      actorKey(tenantId, userId),
    );
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedActor;
    if (cached.v !== `${globalVersion ?? '0'}:${tenantVersion ?? '0'}`) return null;

    return { ...cached.a, permissions: new Map(cached.a.permissions) };
  } catch (err) {
    logger.warn({ err, tenantId }, 'rbac cache: read failed, falling back to the database');
    return null;
  }
}

/** Never throws, for the same reason. A failed write is a future miss. */
export async function writeCachedActor(tenantId: string, userId: string, actor: Actor): Promise<void> {
  try {
    // Re-read rather than reusing what the read saw: a bump may have landed in
    // between, and storing the older version would cache an actor built from
    // data that is already superseded. Stamping the newer one is safe in the
    // other direction — worst case this entry is one version *behind* and is
    // simply missed.
    const [globalVersion, tenantVersion] = await redis.mget(GLOBAL_VERSION_KEY, versionKey(tenantId));
    const value: CachedActor = {
      v: `${globalVersion ?? '0'}:${tenantVersion ?? '0'}`,
      a: {
        ...actor,
        grantedBranchIds: [...actor.grantedBranchIds],
        grantedRegionIds: [...actor.grantedRegionIds],
        teamIds: [...actor.teamIds],
        managedUserIds: [...actor.managedUserIds],
        permissions: [...actor.permissions],
      },
    };
    await redis.set(actorKey(tenantId, userId), JSON.stringify(value), 'EX', TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, tenantId }, 'rbac cache: write failed');
  }
}

/**
 * Invalidate every cached actor in a tenant. One `INCR`, whatever the user count.
 *
 * Called from the Prisma client extension in lib/db.ts rather than from write
 * sites, so a new call site cannot forget it. Pass no tenant to invalidate every
 * tenant, which the global `Permission` catalogue needs.
 *
 * Never throws — but a failure here is the one that matters, because it leaves a
 * revoked permission working until the TTL expires. Logged at `error` for that
 * reason, and `masterapp_errors_total` carries it to the alert rules.
 */
export async function invalidateActors(tenantId?: string): Promise<void> {
  try {
    await redis.incr(tenantId ? versionKey(tenantId) : GLOBAL_VERSION_KEY);
  } catch (err) {
    logger.error(
      { err, tenantId },
      'rbac cache: invalidation failed — permission changes may take up to a minute to apply',
    );
  }
}

/** Test seam: the suite needs a known-cold cache between cases. */
export async function __resetActorCacheForTests(): Promise<void> {
  await invalidateActors();
}
