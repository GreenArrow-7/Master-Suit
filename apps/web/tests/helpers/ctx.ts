/**
 * In-memory Ctx builders for pure unit checks that never reach the database.
 *
 * Anything asserting real authorization or isolation must go through
 * tests/helpers/fixtures.ts instead — these objects are not backed by rows, and
 * building suites on them is what made the old isolation tests meaningless.
 */
import { ulid } from 'ulid';
import type { Ctx, Actor, PermissionMap } from '@/lib/security/rbac';

export function buildActor(overrides: Partial<Actor> & { id: string; tenantId: string }): Actor {
  return {
    roleId: 'role_default',
    roleKey: 'admin',
    roleRank: 0,
    branchId: null,
    regionId: null,
    grantedBranchIds: [],
    grantedRegionIds: [],
    teamIds: [],
    managedUserIds: [],
    permissions: new Map() as PermissionMap,
    ...overrides,
  };
}

export function buildCtx(actor: Actor): Ctx {
  return { tenantId: actor.tenantId, actor, requestId: ulid(), ip: '127.0.0.1', userAgent: 'vitest' };
}
