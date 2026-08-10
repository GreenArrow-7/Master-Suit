/**
 * Account administration: passwords, lockout, suspension, manager and role.
 *
 * Ported from the original HRMS `app/api/auth.py`. Two rules from that system
 * carry the whole design and are enforced on every path here:
 *
 *   1. **You can never act on an account that outranks you.** Without it, an
 *      administrator's deputy resets the administrator's password and becomes
 *      the administrator — and the role split is decoration.
 *   2. **A workspace can never be left without an administrator.** This falls out
 *      of rule 1 rather than needing its own check: because you may only act on
 *      an account strictly below your own level, the acting administrator always
 *      survives their own action. The explicit last-admin checks below are
 *      defence in depth — unreachable while rule 1 holds, and load-bearing the
 *      moment anyone relaxes it to allow equal-rank administration.
 *
 * A reset issues a temporary password and revokes every session the account has.
 * Leaving the old refresh tokens alive would make the reset pointless in exactly
 * the case it matters — an account that has already been taken over.
 */
import { randomBytes } from 'node:crypto';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { checkPolicy, DEFAULT_POLICY, hashPassword, verifyPassword, type PasswordPolicy } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';

/** Rank 10 is `company_admin`/`org_admin`; anything at or above it administers the workspace. */
export const ADMIN_ROLE_RANK = 10;

export async function passwordPolicy(tenantId: string): Promise<PasswordPolicy> {
  const settings = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { passwordPolicy: true },
  });
  const stored = (settings?.passwordPolicy ?? {}) as Partial<PasswordPolicy>;
  return { ...DEFAULT_POLICY, ...stored };
}

function assertPolicy(plain: string, policy: PasswordPolicy) {
  const problems = checkPolicy(plain, policy);
  if (problems.length)
    throw Invalid(problems.map((message) => ({ field: 'newPassword', code: 'weak-password', message })));
}

/**
 * A temporary password the administrator reads out and the user replaces. Shown
 * once, in the browser, at the moment it is created — hand it over in person or
 * by phone, not by email.
 */
export const generateTemporaryPassword = () =>
  `${randomBytes(9).toString('base64url')}-${randomBytes(3).toString('hex').toUpperCase()}`;

/** The workspace user being administered, with the role rank the guards compare. */
async function loadTarget(ctx: Ctx, userId: string) {
  const user = await prisma.user.findFirst({
    where: { tenantId: ctx.tenantId, id: userId, deletedAt: null },
    include: {
      role: true,
      workspaceMembership: {
        include: {
          // Explicit: nothing here needs the credential columns, and `true` would
          // pull passwordHash and mfaSecret into every account screen.
          platformUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
              status: true,
              lockedUntil: true,
              failedLoginCount: true,
              lastLoginAt: true,
              mfaEnabled: true,
              mfaRecoveryCodes: true,
              passwordChangedAt: true,
            },
          },
        },
      },
    },
  });
  if (!user) throw NotFound('User');
  return user;
}

/**
 * The rank guard. `allowSelf` is for the operations that legitimately target
 * your own account (viewing it, revoking your own sessions); everything that
 * changes someone else's credentials or standing goes through the strict form.
 */
function assertMayAdminister(ctx: Ctx, target: { id: string; role: { rank: number } }, allowSelf = false) {
  if (target.id === ctx.actor.id) {
    if (allowSelf) return;
    throw Forbidden('Use your own profile to change your own account.');
  }
  if (target.role.rank <= ctx.actor.roleRank) {
    throw Forbidden('You cannot administer an account at or above your own level.');
  }
}

/**
 * Active administrators other than the one being acted on.
 *
 * Currently always at least 1 on any path that reaches it, because the rank
 * guard has already established that the actor outranks the target and is
 * therefore themselves an administrator. Kept deliberately: it is the check that
 * would catch a future relaxation of the rank rule before it stranded a workspace.
 */
async function otherActiveAdmins(tenantId: string, excludeUserId: string) {
  return prisma.user.count({
    where: {
      tenantId,
      deletedAt: null,
      status: 'ACTIVE',
      id: { not: excludeUserId },
      role: { rank: { lte: ADMIN_ROLE_RANK } },
    },
  });
}

// ── H02: password lifecycle ────────────────────────────────────────────────

/**
 * Changing your own password requires the current one — otherwise a borrowed
 * unlocked laptop is a permanent account takeover. Every other session is
 * revoked, keeping the one making the change.
 */
export async function changeOwnPassword(ctx: Ctx, currentPassword: string, newPassword: string) {
  // The credential lives on PlatformUser and nowhere else, so it is read and
  // written in one place. Verifying against a second copy is how the two used
  // to drift apart.
  const membership = await prisma.workspaceMembership.findUnique({
    where: { salesUserId: ctx.actor.id },
    select: { platformUserId: true },
  });
  if (!membership) throw NotFound('User');
  const identity = await prisma.platformUser.findUnique({
    where: { id: membership.platformUserId },
    select: { id: true, passwordHash: true },
  });
  if (!identity?.passwordHash) throw NotFound('User');

  if (!(await verifyPassword(identity.passwordHash, currentPassword))) {
    throw Forbidden('That is not your current password.');
  }
  if (currentPassword === newPassword) throw Conflict('The new password must be different from the current one.');
  assertPolicy(newPassword, await passwordPolicy(ctx.tenantId));

  const passwordHash = await hashPassword(newPassword);
  await prisma.platformUser.update({
    where: { id: identity.id },
    data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });

  await revokeAllSessions(ctx.tenantId, ctx.actor.id, undefined, 'PASSWORD_CHANGED');
  await audit(ctx, {
    event: 'PASSWORD_CHANGED',
    objectType: 'user',
    recordId: ctx.actor.id,
    metadata: { action: 'password.changed.self' },
  });
  return { changed: true };
}

/**
 * An administrator resets someone else's password to a temporary value. The
 * returned password is shown once and never stored in readable form.
 *
 * `passwordChangedAt` is cleared deliberately: that null is what the forced-change
 * gate reads, so the user must set their own before anything else opens.
 */
export async function resetUserPassword(ctx: Ctx, userId: string, temporaryPassword?: string) {
  const target = await loadTarget(ctx, userId);
  assertMayAdminister(ctx, target);

  const password = temporaryPassword ?? generateTemporaryPassword();
  assertPolicy(password, await passwordPolicy(ctx.tenantId));
  const passwordHash = await hashPassword(password);

  await prisma.platformUser.update({
    where: { id: target.workspaceMembership!.platformUserId },
    data: { passwordHash, passwordChangedAt: null, failedLoginCount: 0, lockedUntil: null },
  });

  await revokeAllSessions(ctx.tenantId, target.id, undefined, 'PASSWORD_RESET');
  await audit(ctx, {
    event: 'PASSWORD_CHANGED',
    objectType: 'user',
    recordId: target.id,
    metadata: { action: 'password.reset.by_admin' },
  });

  return {
    userId: target.id,
    temporaryPassword: password,
    note: 'Shown once. Hand it over in person or by phone — not by email or chat. The user must set their own before anything else opens.',
  };
}

/** True when the account is still on an administrator-issued temporary password. */
export async function mustChangePassword(ctx: Ctx) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { salesUserId: ctx.actor.id },
    select: { platformUser: { select: { passwordChangedAt: true } } },
  });
  return membership !== null && membership.platformUser.passwordChangedAt === null;
}

// ── H07: lockout, suspension, sessions ─────────────────────────────────────

/** Clears a lockout after repeated failed sign-ins, without touching the password. */
export async function unlockUser(ctx: Ctx, userId: string) {
  const target = await loadTarget(ctx, userId);
  assertMayAdminister(ctx, target);

  await withTx(ctx.tenantId, async (tx) => {
    await tx.platformUser.update({
      where: { id: target.workspaceMembership!.platformUserId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'user',
    recordId: target.id,
    metadata: { action: 'account.unlocked' },
  });
  return { userId: target.id, unlocked: true };
}

/**
 * Suspends or restores an account. Suspension revokes every live session at the
 * same time — an account you have decided to stop trusting must not keep working
 * until its cookie happens to expire.
 */
export async function setUserActive(ctx: Ctx, userId: string, active: boolean, reason?: string) {
  const target = await loadTarget(ctx, userId);
  assertMayAdminister(ctx, target);

  if (!active && target.role.rank <= ADMIN_ROLE_RANK && (await otherActiveAdmins(ctx.tenantId, target.id)) === 0) {
    throw Conflict(
      'This is the last active administrator. Promote someone else before suspending this account, or the workspace locks itself out.',
    );
  }

  const status = active ? 'ACTIVE' : 'SUSPENDED';
  await withTx(ctx.tenantId, async (tx) => {
    await tx.user.update({ where: { tenantId: ctx.tenantId, id: target.id }, data: { status } });
    await tx.workspaceMembership.update({
      where: { id: target.workspaceMembership!.id },
      data: { status: active ? 'ACTIVE' : 'SUSPENDED' },
    });
  });

  if (!active) await revokeAllSessions(ctx.tenantId, target.id, undefined, 'ACCOUNT_SUSPENDED');
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'user',
    recordId: target.id,
    previousValue: { status: target.status },
    newValue: { status },
    metadata: { action: active ? 'account.restored' : 'account.suspended', reason },
  });
  return { userId: target.id, status };
}

/** Signs an account out everywhere without changing anything else about it. */
export async function revokeUserSessions(ctx: Ctx, userId: string) {
  const target = await loadTarget(ctx, userId);
  assertMayAdminister(ctx, target, true);
  await revokeAllSessions(ctx.tenantId, target.id, undefined, 'ADMIN_REVOKED');
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'user',
    recordId: target.id,
    metadata: { action: 'sessions.revoked' },
  });
  return { userId: target.id, revoked: true };
}

/** Everything an administrator needs to judge one account, in one call. */
export async function accountDetail(ctx: Ctx, userId: string) {
  const target = await loadTarget(ctx, userId);
  const [sessions, employee, loginHistory] = await Promise.all([
    /**
     * Read from PlatformSession, which is where sessions actually live.
     *
     * This used to read the legacy `Session` table. Nothing has created a row in
     * it since the single-credential-store change, so an administrator opening
     * an account saw "no active sessions" for a user who was signed in on three
     * devices — and would have judged a suspected compromise on that.
     */
    prisma.platformSession.findMany({
      where: {
        platformUserId: target.workspaceMembership!.platformUserId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, ipAddress: true, userAgent: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    }),
    prisma.employeeProfile.findFirst({
      where: { tenantId: ctx.tenantId, membershipId: target.workspaceMembership!.id, deletedAt: null },
      select: { id: true, employeeNumber: true, employmentStatus: true, managerMembershipId: true },
    }),
    // v21 §1 access panel: the account's recent sign-ins, successful and
    // failed, so an administrator judging a suspected compromise sees the
    // pattern rather than just the last-login timestamp.
    prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, actorUserId: target.id, event: { in: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] } },
      select: { event: true, ipAddress: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
  ]);

  const platformUser = target.workspaceMembership!.platformUser;
  return {
    userId: target.id,
    fullName: target.fullName,
    email: target.email,
    status: target.status,
    role: { id: target.roleId, key: target.role.key, name: target.role.name, rank: target.role.rank },
    membershipStatus: target.workspaceMembership!.status,
    lockedUntil: platformUser.lockedUntil,
    failedLoginCount: platformUser.failedLoginCount,
    lastLoginAt: platformUser.lastLoginAt,
    mfaEnabled: platformUser.mfaEnabled,
    recoveryCodesRemaining: platformUser.mfaRecoveryCodes.length,
    /** Null means the account is still on an administrator-issued temporary password. */
    passwordChangedAt: platformUser.passwordChangedAt,
    activeSessions: sessions,
    loginHistory: loginHistory.map((row) => ({
      event: row.event,
      ipAddress: row.ipAddress,
      at: row.occurredAt,
    })),
    employee,
  };
}

// ── H04: directory, manager, role ──────────────────────────────────────────

export async function listAccounts(ctx: Ctx) {
  return prisma.user.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    include: {
      role: true,
      workspaceMembership: {
        include: {
          platformUser: { select: { lockedUntil: true, mfaEnabled: true, lastLoginAt: true, passwordChangedAt: true } },
        },
      },
    },
    orderBy: [{ role: { rank: 'asc' } }, { fullName: 'asc' }],
  });
}

/**
 * Changing someone's role. Guarded twice: you may not touch an account at or
 * above your level, and you may not grant a role at or above your own — which is
 * the escalation an attacker reaches for first.
 */
export async function changeUserRole(ctx: Ctx, userId: string, roleId: string) {
  const target = await loadTarget(ctx, userId);
  assertMayAdminister(ctx, target);

  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: roleId } });
  if (!role) throw NotFound('Role');
  if (role.rank <= ctx.actor.roleRank) throw Forbidden('You cannot grant a role at or above your own level.');

  if (
    target.role.rank <= ADMIN_ROLE_RANK &&
    role.rank > ADMIN_ROLE_RANK &&
    (await otherActiveAdmins(ctx.tenantId, target.id)) === 0
  ) {
    throw Conflict('This is the last active administrator. Promote someone else before demoting this account.');
  }

  const updated = await prisma.user.update({
    where: { tenantId: ctx.tenantId, id: target.id },
    data: { roleId: role.id },
    include: { role: true },
  });
  await prisma.workspaceMembership.update({
    where: { id: target.workspaceMembership!.id },
    data: { roleSnapshot: role.key },
  });

  // A role change alters what the session may do, so the session must be rebuilt.
  await revokeAllSessions(ctx.tenantId, target.id, undefined, 'ROLE_CHANGED');
  await audit(ctx, {
    event: 'PERMISSION_CHANGED',
    objectType: 'user',
    recordId: target.id,
    fieldKey: 'roleId',
    previousValue: target.role.key,
    newValue: role.key,
    metadata: { action: 'account.role_changed' },
  });
  return updated;
}

/** Sets the line manager, which is what drives leave approval and exception endorsement. */
export async function setManager(ctx: Ctx, employeeId: string, managerEmployeeId: string | null) {
  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
  });
  if (!employee) throw NotFound('Employee');

  let managerMembershipId: string | null = null;
  if (managerEmployeeId) {
    if (managerEmployeeId === employeeId) throw Conflict('An employee cannot be their own manager.');
    const manager = await prisma.employeeProfile.findFirst({
      where: { tenantId: ctx.tenantId, id: managerEmployeeId, deletedAt: null },
    });
    if (!manager) throw NotFound('Manager');

    // Walk up from the proposed manager. Reaching this employee means the chain
    // would close into a loop, and leave requests would route in a circle with
    // nobody able to approve them.
    let cursor: string | null = manager.managerMembershipId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === employee.membershipId) throw Conflict('That would create a reporting loop.');
      if (visited.has(cursor)) break; // a pre-existing cycle elsewhere; don't spin on it
      visited.add(cursor);
      const next: { managerMembershipId: string | null } | null = await prisma.employeeProfile.findFirst({
        where: { tenantId: ctx.tenantId, membershipId: cursor, deletedAt: null },
        select: { managerMembershipId: true },
      });
      cursor = next?.managerMembershipId ?? null;
    }
    managerMembershipId = manager.membershipId;
  }

  const updated = await prisma.employeeProfile.update({
    where: { tenantId: ctx.tenantId, id: employee.id },
    data: { managerMembershipId },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'employee',
    recordId: employee.id,
    fieldKey: 'managerMembershipId',
    previousValue: employee.managerMembershipId,
    newValue: managerMembershipId,
    metadata: { action: 'employee.manager_changed' },
  });
  return updated;
}
