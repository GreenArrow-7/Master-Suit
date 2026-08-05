/**
 * Roles, the permission matrix, and effective-dated role assignment.
 *
 * Ported from the original HRMS `app/api/roles.py`. One rule governs everything
 * here, and it is the same one that governs account administration: **you may
 * only work at levels strictly below your own.** Applied to roles that means
 *
 *   - you cannot edit, delete or grant a role at or above your own rank;
 *   - you cannot create a role more senior than yourself;
 *   - you cannot give a role a permission scope you do not hold yourself.
 *
 * Without the last one the matrix is a privilege-escalation console: an
 * administrator with TEAM visibility grants a role they hold ORGANIZATION on
 * leads, assigns it to themselves, and has just promoted themselves.
 */
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { SCOPE_RANK, scopeFor, type Ctx, type Scope, type Action } from '@/lib/security/rbac';

/** System roles are the ones the workspace bootstrap depends on; they may be regraded but not deleted. */
const isSystemRole = (role: { isSystem: boolean }) => role.isSystem;

function assertMayEditRole(ctx: Ctx, role: { id: string; rank: number }) {
  if (role.id === ctx.actor.roleId) throw Forbidden('You cannot edit your own role.');
  if (role.rank <= ctx.actor.roleRank) throw Forbidden('You cannot edit a role at or above your own level.');
}

// ── H05: roles and the permission matrix ───────────────────────────────────

export async function listRoles(ctx: Ctx) {
  const roles = await prisma.role.findMany({
    where: { tenantId: ctx.tenantId },
    include: { _count: { select: { users: true, permissions: true } } },
    orderBy: { rank: 'asc' },
  });
  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    rank: role.rank,
    defaultScope: role.defaultScope,
    isSystem: role.isSystem,
    users: role._count.users,
    permissions: role._count.permissions,
    /** Whether the signed-in administrator may act on this role at all. */
    editable: role.rank > ctx.actor.roleRank && role.id !== ctx.actor.roleId,
  }));
}

/**
 * The matrix for one role: every permission in the catalogue, with the scope
 * this role grants and the ceiling the signed-in administrator may raise it to.
 */
export async function permissionMatrix(ctx: Ctx, roleId: string) {
  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: roleId } });
  if (!role) throw NotFound('Role');

  const [catalogue, granted] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] }),
    prisma.rolePermission.findMany({ where: { tenantId: ctx.tenantId, roleId }, select: { permissionId: true, granted: true, scope: true } }),
  ]);
  const current = new Map(granted.map((row) => [row.permissionId, row]));

  return {
    role: { id: role.id, key: role.key, name: role.name, rank: role.rank, isSystem: role.isSystem },
    editable: role.rank > ctx.actor.roleRank && role.id !== ctx.actor.roleId,
    permissions: catalogue.map((permission) => {
      const row = current.get(permission.id);
      return {
        permissionId: permission.id,
        module: permission.module,
        action: permission.action,
        granted: row?.granted ?? false,
        scope: (row?.scope ?? 'NONE') as Scope,
        /** The most this administrator may grant here — their own scope on it. */
        maxScope: scopeFor(ctx, permission.module, permission.action as Action),
      };
    }),
  };
}

export async function createRole(ctx: Ctx, input: { key: string; name: string; description?: string; rank: number; defaultScope: Scope }) {
  if (input.rank <= ctx.actor.roleRank) throw Forbidden('You cannot create a role at or above your own level.');
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, key } })) throw Conflict('A role with that key already exists.');

  const role = await prisma.role.create({
    data: {
      tenantId: ctx.tenantId, key, name: input.name, description: input.description ?? null,
      rank: input.rank, defaultScope: input.defaultScope, isSystem: false, createdById: ctx.actor.id,
    },
  });
  await audit(ctx, { event: 'PERMISSION_CHANGED', objectType: 'role', recordId: role.id, newValue: { key, rank: input.rank }, metadata: { action: 'role.created' } });
  return role;
}

export async function updateRole(ctx: Ctx, roleId: string, input: { name?: string; description?: string; rank?: number; defaultScope?: Scope }) {
  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: roleId } });
  if (!role) throw NotFound('Role');
  assertMayEditRole(ctx, role);
  if (input.rank !== undefined && input.rank <= ctx.actor.roleRank) throw Forbidden('You cannot raise a role to or above your own level.');

  const updated = await prisma.role.update({
    where: { tenantId: ctx.tenantId, id: role.id },
    data: { ...input, updatedById: ctx.actor.id },
  });
  await audit(ctx, { event: 'PERMISSION_CHANGED', objectType: 'role', recordId: role.id, previousValue: { name: role.name, rank: role.rank }, newValue: { name: updated.name, rank: updated.rank }, metadata: { action: 'role.updated' } });
  return updated;
}

/** A role still holding users cannot be deleted — those accounts would lose all access. */
export async function deleteRole(ctx: Ctx, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { tenantId: ctx.tenantId, id: roleId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw NotFound('Role');
  assertMayEditRole(ctx, role);
  if (isSystemRole(role)) throw Conflict('System roles cannot be deleted. The workspace bootstrap depends on them.');
  if (role._count.users > 0) throw Conflict(`${role._count.users} account${role._count.users === 1 ? ' is' : 's are'} still on this role. Move them to another role first.`);

  await prisma.role.delete({ where: { tenantId: ctx.tenantId, id: role.id } });
  await audit(ctx, { event: 'PERMISSION_CHANGED', objectType: 'role', recordId: role.id, previousValue: { key: role.key }, metadata: { action: 'role.deleted' } });
  return { deleted: true, roleId: role.id };
}

export interface MatrixChange {
  permissionId: string;
  granted: boolean;
  scope: Scope;
}

/**
 * Applies matrix changes. Each one is checked against the administrator's own
 * scope for that permission: you may never grant more than you hold.
 *
 * Everyone on the role is signed out afterwards, because a live session carries
 * the permission map it was built with and would otherwise keep the old rights
 * until it happened to expire.
 */
export async function updatePermissionMatrix(ctx: Ctx, roleId: string, changes: MatrixChange[]) {
  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: roleId } });
  if (!role) throw NotFound('Role');
  assertMayEditRole(ctx, role);

  const permissions = await prisma.permission.findMany({ where: { id: { in: changes.map((change) => change.permissionId) } } });
  const byId = new Map(permissions.map((permission) => [permission.id, permission]));

  for (const change of changes) {
    const permission = byId.get(change.permissionId);
    if (!permission) throw NotFound('Permission');
    if (!change.granted) continue;
    const ceiling = scopeFor(ctx, permission.module, permission.action as Action);
    if (SCOPE_RANK[change.scope] > SCOPE_RANK[ceiling]) {
      throw Forbidden(`You cannot grant ${permission.module}:${permission.action} at ${change.scope} — you hold ${ceiling} on it yourself.`);
    }
  }

  await withTx(async (tx) => {
    for (const change of changes) {
      if (!change.granted || change.scope === 'NONE') {
        await tx.rolePermission.deleteMany({ where: { tenantId: ctx.tenantId, roleId, permissionId: change.permissionId } });
        continue;
      }
      // Read-then-write rather than upsert: the (roleId, permissionId) unique key
      // carries no tenantId, so an upsert keyed on it cannot be tenant-scoped and
      // the query guard rejects it. The role was already resolved within this
      // tenant above, but the guard is right to insist the write says so too.
      const current = await tx.rolePermission.findFirst({
        where: { tenantId: ctx.tenantId, roleId, permissionId: change.permissionId },
        select: { id: true },
      });
      if (current) {
        await tx.rolePermission.update({ where: { id: current.id }, data: { granted: true, scope: change.scope } });
      } else {
        await tx.rolePermission.create({
          data: { tenantId: ctx.tenantId, roleId, permissionId: change.permissionId, granted: true, scope: change.scope },
        });
      }
    }
  });

  const holders = await prisma.user.findMany({ where: { tenantId: ctx.tenantId, roleId, deletedAt: null }, select: { id: true } });
  for (const holder of holders) await revokeAllSessions(ctx.tenantId, holder.id, undefined, 'PERMISSIONS_CHANGED');

  await audit(ctx, {
    event: 'PERMISSION_CHANGED', objectType: 'role', recordId: roleId,
    metadata: { action: 'role.permissions_updated', changes: changes.length, sessionsRevoked: holders.length },
  });
  return { roleId, changed: changes.length, sessionsRevoked: holders.length };
}

// ── H06: effective-dated assignment and history ────────────────────────────

/**
 * Grants a role for a window of time, alongside whatever the account already
 * holds. This is how cover works — someone acts up while a manager is on leave,
 * and the grant lapses on its own rather than depending on anyone remembering.
 */
export async function assignRole(ctx: Ctx, input: { membershipId: string; roleId: string; effectiveFrom?: Date; effectiveTo?: Date; scopeType?: string; scopeId?: string }) {
  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: input.roleId } });
  if (!role) throw NotFound('Role');
  if (role.rank <= ctx.actor.roleRank) throw Forbidden('You cannot assign a role at or above your own level.');
  if (input.effectiveTo && input.effectiveFrom && input.effectiveTo <= input.effectiveFrom) {
    throw Conflict('The end of the window must be after its start.');
  }

  const membership = await prisma.workspaceMembership.findFirst({ where: { tenantId: ctx.tenantId, id: input.membershipId } });
  if (!membership) throw NotFound('Membership');

  const existing = await prisma.membershipRole.findFirst({ where: { tenantId: ctx.tenantId, membershipId: input.membershipId, roleId: input.roleId } });
  if (existing && existing.status === 'ACTIVE') throw Conflict('That role is already assigned to this account.');

  const assignment = existing
    ? await prisma.membershipRole.update({
        where: { tenantId: ctx.tenantId, id: existing.id },
        data: {
          status: 'ACTIVE', effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null,
          assignedById: ctx.actor.id, revokedAt: null, revokedById: null, revocationReason: null,
        },
      })
    : await prisma.membershipRole.create({
        data: {
          tenantId: ctx.tenantId, membershipId: input.membershipId, roleId: input.roleId,
          scopeType: input.scopeType ?? 'ORGANIZATION', scopeId: input.scopeId ?? null,
          effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null,
          status: 'ACTIVE', assignedById: ctx.actor.id,
        },
      });

  if (membership.salesUserId) await revokeAllSessions(ctx.tenantId, membership.salesUserId, undefined, 'ROLE_ASSIGNED');
  await audit(ctx, {
    event: 'PERMISSION_CHANGED', objectType: 'membership_role', recordId: assignment.id,
    newValue: { role: role.key, from: input.effectiveFrom, to: input.effectiveTo },
    metadata: { action: 'role.assigned' },
  });
  return assignment;
}

/** Revocation keeps the row: the history of who held what, and when, is the point. */
export async function revokeRoleAssignment(ctx: Ctx, assignmentId: string, reason?: string) {
  const assignment = await prisma.membershipRole.findFirst({
    where: { tenantId: ctx.tenantId, id: assignmentId },
    include: { role: true, membership: true },
  });
  if (!assignment) throw NotFound('Role assignment');
  if (assignment.role.rank <= ctx.actor.roleRank) throw Forbidden('You cannot revoke a role at or above your own level.');
  if (assignment.status !== 'ACTIVE') throw Conflict('That assignment is already revoked.');

  const revoked = await prisma.membershipRole.update({
    where: { tenantId: ctx.tenantId, id: assignment.id },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedById: ctx.actor.id, revocationReason: reason ?? null },
  });

  if (assignment.membership.salesUserId) {
    await revokeAllSessions(ctx.tenantId, assignment.membership.salesUserId, undefined, 'ROLE_REVOKED');
  }
  await audit(ctx, {
    event: 'PERMISSION_CHANGED', objectType: 'membership_role', recordId: assignment.id,
    previousValue: { status: 'ACTIVE' }, newValue: { status: 'REVOKED' },
    metadata: { action: 'role.revoked', reason },
  });
  return revoked;
}

/** Every grant and revocation, current and past. */
export async function roleAssignmentHistory(ctx: Ctx, options: { membershipId?: string; roleId?: string; limit?: number } = {}) {
  const assignments = await prisma.membershipRole.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(options.membershipId ? { membershipId: options.membershipId } : {}),
      ...(options.roleId ? { roleId: options.roleId } : {}),
    },
    include: { role: true, membership: { include: { platformUser: { select: { fullName: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 200, 500),
  });

  const now = new Date();
  return assignments.map((assignment) => ({
    id: assignment.id,
    membershipId: assignment.membershipId,
    holder: assignment.membership.platformUser.fullName,
    email: assignment.membership.platformUser.email,
    role: { id: assignment.roleId, key: assignment.role.key, name: assignment.role.name, rank: assignment.role.rank },
    scopeType: assignment.scopeType,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    status: assignment.status,
    revokedAt: assignment.revokedAt,
    revocationReason: assignment.revocationReason,
    /** Whether the grant is actually in force right now, dates included. */
    inForce:
      assignment.status === 'ACTIVE'
      && (!assignment.effectiveFrom || assignment.effectiveFrom <= now)
      && (!assignment.effectiveTo || assignment.effectiveTo >= now),
  }));
}
