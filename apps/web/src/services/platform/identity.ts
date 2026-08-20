/**
 * Platform-owner account recovery.
 *
 * The operational answer to "a customer cannot sign in". Everything here reads
 * or repairs the *account-level* authentication state that
 * `app/api/v1/auth/login/route.ts` checks, in the same order it checks it:
 * existence → lock → status → active workspace → password → MFA.
 *
 * Three boundaries this file does not cross:
 *
 *  1. **Credentials are write-only.** `passwordHash`, `mfaSecret` and
 *     `mfaRecoveryCodes` are never selected into anything a caller can return.
 *     A generated temporary password is handed back exactly once, from the call
 *     that created it, and is never persisted in readable form or audited.
 *  2. **Platform role is not workspace role.** `PlatformUser.platformRole`
 *     decides who may use this console; `User.roleId` inside a tenant decides
 *     what someone may do in that workspace. They are edited by different
 *     functions and shown in different columns.
 *  3. **The last active owner cannot be disarmed.** Deactivating, demoting or
 *     stripping the MFA of the only remaining platform owner is refused here,
 *     not discovered at the next sign-in.
 *
 * Every mutating function writes a PlatformAuditEvent naming the actor, the
 * target and the result. `PlatformAuditEvent.event` is a free string column, so
 * the names below (`PASSWORD_RESET`, `ACCOUNT_UNLOCKED`, …) needed no migration.
 */
import { prisma, withPlatformTx } from '@/lib/db';
import { invalidate, redis } from '@/lib/redis';
import { limits } from '@/lib/security/ratelimit';
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { checkPolicy, DEFAULT_POLICY, hashPassword } from '@/lib/auth/password';
import { generateTemporaryPassword } from '@/services/identity/accounts';
import { isPrivilegedPlatformRole } from '@/lib/auth/platform-policy';
import type { PlatformCtx } from '@/lib/auth/session';

export type MfaState = 'ENABLED' | 'ENROLMENT_PENDING' | 'ENROLMENT_REQUIRED' | 'NOT_CONFIGURED' | 'RECOVERY_REQUIRED';

/** Columns that are safe to read. Credentials are absent by construction. */
const SAFE_USER = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  platformRole: true,
  emailVerifiedAt: true,
  mfaEnabled: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  createdAt: true,
} as const;

// ── Reads ──────────────────────────────────────────────────────────────────

export interface UserFilters {
  q?: string;
  tenantId?: string;
  status?: string;
  /** Workspace role key, e.g. `org_admin`. Not the platform role. */
  role?: string;
  platformRole?: string;
  /** `LOCKED` is derived, not a column — see below. */
  lock?: 'LOCKED' | 'NORMAL';
  mfa?: 'ENABLED' | 'DISABLED' | 'ENROLMENT_REQUIRED';
}

/**
 * The directory behind the Platform Users table.
 *
 * Search spans the person and their workspace, because an operator on a support
 * call has whichever of the two the customer happened to say — an email, a
 * name, or "the Manath Homes admin".
 */
export async function listPlatformUsers(filters: UserFilters) {
  const q = filters.q?.trim();
  const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;

  const rows = await prisma.platformUser.findMany({
    where: {
      deletedAt: null,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.platformRole ? { platformRole: filters.platformRole as never } : {}),
      ...(filters.tenantId ? { memberships: { some: { tenantId: filters.tenantId } } } : {}),
      ...(filters.role ? { memberships: { some: { roleSnapshot: filters.role } } } : {}),
      ...(filters.mfa === 'ENABLED' ? { mfaEnabled: true } : {}),
      ...(filters.mfa === 'DISABLED' ? { mfaEnabled: false } : {}),
      // "Enrolment required" is a policy question, not a column: privileged
      // platform staff always need a factor, so any of them without one is
      // pending enrolment. Filtered in memory below for that reason.
      ...(contains
        ? {
            OR: [
              { fullName: contains },
              { email: contains },
              { memberships: { some: { tenant: { displayName: contains } } } },
              { memberships: { some: { tenant: { slug: contains } } } },
              { memberships: { some: { roleSnapshot: contains } } },
            ],
          }
        : {}),
    },
    select: {
      ...SAFE_USER,
      memberships: {
        select: {
          id: true,
          status: true,
          roleSnapshot: true,
          tenantId: true,
          tenant: { select: { id: true, slug: true, displayName: true, status: true } },
        },
        orderBy: { joinedAt: 'asc' },
      },
      // Presence only. The secret itself is never read outside the login path.
      authenticationFactors: { where: { type: 'TOTP' }, select: { id: true, verifiedAt: true } },
    },
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    take: 500,
  });

  const now = new Date();
  const pending = await pendingEnrolments();
  const decorated = rows.map((user) => ({
    ...user,
    locked: user.lockedUntil !== null && user.lockedUntil > now,
    mfaState: mfaStateFor(user, pending.has(user.id)),
    primaryMembership: user.memberships[0] ?? null,
  }));

  return decorated.filter((user) => {
    if (filters.lock === 'LOCKED' && !user.locked) return false;
    if (filters.lock === 'NORMAL' && user.locked) return false;
    if (filters.mfa === 'ENROLMENT_REQUIRED' && user.mfaState !== 'ENROLMENT_REQUIRED') return false;
    return true;
  });
}

type MfaShape = {
  mfaEnabled: boolean;
  platformRole: string;
  authenticationFactors: { verifiedAt: Date | null }[];
};

/**
 * The five states an operator needs to tell apart when diagnosing a sign-in.
 *
 * `ENROLMENT_REQUIRED` is the one that matters most: the account has no factor
 * but policy demands one, so login will hand it a restricted enrolment grant
 * rather than a session. Without this state that reads as a mysterious
 * half-login.
 */
function mfaStateFor(user: MfaShape, secretPending: boolean): MfaState {
  if (user.mfaEnabled) return 'ENABLED';
  // A secret was issued and never confirmed with a working code: the QR was
  // shown, the scan failed or was abandoned, and the account is stuck part-way
  // through enrolment. Indistinguishable from "no MFA" without this.
  if (secretPending) return 'ENROLMENT_PENDING';
  // A factor row with no live secret means the authenticator is gone but the
  // enrolment record survives — recovery codes are the only way back.
  if (user.authenticationFactors.length > 0) return 'RECOVERY_REQUIRED';
  if (isPrivilegedPlatformRole(user.platformRole)) return 'ENROLMENT_REQUIRED';
  return 'NOT_CONFIGURED';
}

/**
 * Accounts holding an unconfirmed authenticator secret.
 *
 * Read as a boolean over a raw query rather than by selecting `mfaSecret`: the
 * column is a bearer credential, and the rule in this file is that it is never
 * loaded into anything a caller could return. One query for the whole page
 * rather than one per row.
 */
async function pendingEnrolments(): Promise<Set<string>> {
  // ponytail: unfiltered scan of PlatformUser. It returns only the half-enrolled
  // accounts, which is a handful on any real platform; add an id filter if the
  // table ever grows past what one page can hold.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "PlatformUser"
    WHERE "mfaSecret" IS NOT NULL AND "mfaEnabled" = false AND "deletedAt" IS NULL
  `;
  return new Set(rows.map((row) => row.id));
}

/**
 * Everything the drawer shows for one account, including the two things the
 * table cannot: what the workspace role actually grants, and why the last few
 * sign-ins failed.
 */
export async function platformUserDetail(userId: string) {
  const user = await prisma.platformUser.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      ...SAFE_USER,
      updatedAt: true,
      memberships: {
        select: {
          id: true,
          status: true,
          roleSnapshot: true,
          isPrimaryAdmin: true,
          joinedAt: true,
          suspendedAt: true,
          tenantId: true,
          salesUserId: true,
          tenant: { select: { id: true, slug: true, displayName: true, status: true, deletedAt: true } },
        },
        orderBy: { joinedAt: 'asc' },
      },
      authenticationFactors: { where: { type: 'TOTP' }, select: { id: true, verifiedAt: true, createdAt: true } },
    },
  });
  if (!user) throw NotFound('User');

  // `User` is RLS-forced, so the workspace side of each membership is read one
  // tenant at a time — the same reason login hydrates them separately.
  const memberships = await Promise.all(
    user.memberships.map(async (membership) => {
      // A soft-deleted workspace user comes back null here — the guard filters
      // `deletedAt` for us — and that null is itself the diagnosis the drawer
      // reports: the membership points at a workspace user that no longer exists.
      const salesUser = membership.salesUserId
        ? await prisma.user.findFirst({
            where: { tenantId: membership.tenantId, id: membership.salesUserId },
            select: {
              id: true,
              status: true,
              deletedAt: true,
              roleId: true,
              role: { select: { id: true, key: true, name: true, rank: true } },
            },
          })
        : null;
      return { ...membership, salesUser };
    }),
  );

  const active = memberships.find(
    (m) =>
      m.status === 'ACTIVE' &&
      m.tenant.status === 'ACTIVE' &&
      m.tenant.deletedAt === null &&
      m.salesUser?.status === 'ACTIVE' &&
      m.salesUser.deletedAt === null,
  );

  const [events, effectiveAccess, roleOptions, throttle, pending] = await Promise.all([
    // Both directions. `actorUserId` is what this account did — its sign-ins and
    // failures; `objectId` is what was done *to* it — the resets and unlocks an
    // owner performed. Reading only the first hid every administrative action
    // from the very screen that took it.
    prisma.platformAuditEvent.findMany({
      where: {
        OR: [{ actorUserId: user.id }, { objectType: 'platform_user', objectId: user.id }],
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { id: true, event: true, occurredAt: true, metadata: true, ipAddress: true, actorUserId: true },
    }),
    active?.salesUser ? effectiveAccessFor(active.tenantId, active.salesUser.roleId) : Promise.resolve([]),
    active
      ? prisma.role.findMany({
          where: { tenantId: active.tenantId, isActive: true },
          select: { id: true, key: true, name: true, rank: true },
          orderBy: { rank: 'asc' },
        })
      : Promise.resolve([]),
    signInThrottle(user.email),
    pendingEnrolments(),
  ]);

  const now = new Date();
  return {
    ...user,
    memberships,
    locked: user.lockedUntil !== null && user.lockedUntil > now,
    mfaState: mfaStateFor(user, pending.has(user.id)),
    mustChangePassword: user.passwordChangedAt === null,
    hasPassword: await hasPassword(user.id),
    canSignIn: canSignIn(user, memberships, now),
    activeMembership: active ?? null,
    effectiveAccess,
    roleOptions,
    throttle,
    events,
  };
}

type SalesUserShape = {
  id: string;
  status: string;
  deletedAt: Date | null;
  roleId: string;
  role: { id: string; key: string; name: string; rank: number };
};

/** Presence of a credential, never the credential. */
async function hasPassword(id: string) {
  const row = await prisma.$queryRaw<{ has: boolean }[]>`
    SELECT "passwordHash" IS NOT NULL AS has FROM "PlatformUser" WHERE id = ${id}
  `;
  return row[0]?.has ?? false;
}

/**
 * Why login would refuse this account today, in the order login checks.
 *
 * The sign-in form deliberately answers every credential failure with one
 * message so an attacker cannot enumerate accounts. That secrecy is owed to the
 * *public*, not to the operator holding the platform-owner session — so the
 * real reason is surfaced here instead, which is the whole point of the console.
 */
function canSignIn(
  user: { status: string; lockedUntil: Date | null; platformRole: string },
  memberships: {
    status: string;
    tenant: { status: string; deletedAt: Date | null };
    salesUser: SalesUserShape | null;
  }[],
  now: Date,
): { ok: boolean; reason: string } {
  if (user.lockedUntil && user.lockedUntil > now) {
    return { ok: false, reason: `Locked until ${user.lockedUntil.toLocaleString('en-AE')} after repeated failures.` };
  }
  if (user.status !== 'ACTIVE') return { ok: false, reason: `Account status is ${user.status}.` };
  const usable = memberships.some(
    (m) =>
      m.status === 'ACTIVE' &&
      m.tenant.status === 'ACTIVE' &&
      m.tenant.deletedAt === null &&
      m.salesUser?.status === 'ACTIVE' &&
      m.salesUser.deletedAt === null,
  );
  if (user.platformRole === 'USER' && !usable) {
    return { ok: false, reason: 'No active workspace membership — login is refused before the password is checked.' };
  }
  return { ok: true, reason: 'Password and account state permit sign-in.' };
}

/**
 * The per-account sign-in throttle, read from the same Redis window the login
 * route writes. Separate from the account lock and easy to mistake for it: a
 * throttled sign-in is refused before the password is read, so an operator who
 * only looked at `lockedUntil` would call the account healthy and be wrong.
 */
async function signInThrottle(email: string) {
  const limit = limits.loginPerAccount(email);
  const windowMs = limit.windowSeconds * 1000;
  const window = Math.floor(Date.now() / windowMs);
  // A dead Redis must not blank the whole drawer; the counter is diagnostic.
  const used = Number(await redis.get(`rl:${limit.key}:${window}`).catch(() => null)) || 0;
  return { used, max: limit.max, throttled: used >= limit.max, resetsAt: new Date((window + 1) * windowMs) };
}

/** `module → strongest granted scope`, straight off the role's permission rows. */
async function effectiveAccessFor(tenantId: string, roleId: string) {
  const rows = await prisma.rolePermission.findMany({
    where: { tenantId, roleId, granted: true },
    select: { scope: true, permission: { select: { module: true, action: true } } },
  });
  const rank = ['NONE', 'OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION'];
  const byModule = new Map<string, { scope: string; actions: string[] }>();
  for (const row of rows) {
    const entry = byModule.get(row.permission.module) ?? { scope: 'NONE', actions: [] };
    if (rank.indexOf(row.scope) > rank.indexOf(entry.scope)) entry.scope = row.scope;
    entry.actions.push(row.permission.action);
    byModule.set(row.permission.module, entry);
  }
  return [...byModule.entries()]
    .map(([module, entry]) => ({ module, scope: entry.scope, actions: entry.actions.sort() }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

// ── Guards ─────────────────────────────────────────────────────────────────

/**
 * Refuses the action that leaves nobody able to undo it.
 *
 * Both halves matter. Acting on *yourself* is refused because the console offers
 * no way back; acting on the *last* active owner is refused because promoting a
 * replacement first is the only safe order. Reset-password is deliberately not
 * guarded — an owner resetting their own password still knows the new one.
 */
export async function refuseOwnerLockout(
  ctx: PlatformCtx,
  target: { id: string; platformRole: string; status: string },
) {
  if (target.id === ctx.platformUserId) {
    throw Conflict('You cannot disable or demote your own platform account. Ask another platform owner.');
  }
  if (target.platformRole === 'OWNER' && target.status === 'ACTIVE') {
    const others = await prisma.platformUser.count({
      where: { platformRole: 'OWNER', status: 'ACTIVE', deletedAt: null, id: { not: target.id } },
    });
    if (others === 0) {
      throw Conflict('This is the last active platform owner. Promote another owner before changing this account.');
    }
  }
}

async function loadTarget(userId: string) {
  const user = await prisma.platformUser.findFirst({
    where: { id: userId, deletedAt: null },
    select: { ...SAFE_USER, memberships: { select: { id: true, tenantId: true, salesUserId: true, status: true } } },
  });
  if (!user) throw NotFound('User');
  return user;
}

async function record(
  ctx: PlatformCtx,
  event: string,
  target: { id: string; email: string },
  metadata: Record<string, unknown>,
  tenantId?: string | null,
) {
  await prisma.platformAuditEvent.create({
    data: {
      tenantId: tenantId ?? null,
      actorUserId: ctx.platformUserId,
      event,
      objectType: 'platform_user',
      objectId: target.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      // `target` and `result` only. No password, temporary or otherwise, and no
      // hash — see SECRET_KEYS in lib/security/audit.ts for the same rule on the
      // workspace side.
      metadata: { target: target.email, ...metadata },
    },
  });
}

// ── Recovery actions ───────────────────────────────────────────────────────

/**
 * Sets a password the owner chose, or mints a temporary one.
 *
 * `requireChange` writes `passwordChangedAt: null`, which is what the forced-change
 * gate in the workspace layout reads — the user signs in with what they were
 * given and must replace it before anything else opens. It is the right default
 * for a real customer. A demo workspace wants a known, stable password instead,
 * which is why the flag exists rather than being implied by "temporary".
 */
export async function resetPassword(
  ctx: PlatformCtx,
  userId: string,
  options: { password?: string; requireChange: boolean },
) {
  const target = await loadTarget(userId);
  const password = options.password ?? generateTemporaryPassword();

  const problems = checkPolicy(password, DEFAULT_POLICY);
  if (problems.length) {
    throw Invalid(problems.map((message) => ({ field: 'password', code: 'weak-password', message })));
  }

  const passwordHash = await hashPassword(password);
  await withPlatformTx(async (tx) => {
    await tx.platformUser.update({
      where: { id: target.id },
      data: {
        passwordHash,
        passwordChangedAt: options.requireChange ? null : new Date(),
        // A reset that left the account locked would look like it had failed.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // The old sessions belong to whoever held the old password. That is exactly
    // the case a reset exists for, so they end here rather than at their TTL.
    await tx.platformSession.updateMany({
      where: { platformUserId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
    });
  });
  await clearSignInThrottle(target.email);

  await record(ctx, 'PASSWORD_RESET', target, {
    result: 'ok',
    generated: !options.password,
    mustChangeAtNextLogin: options.requireChange,
  });

  return {
    userId: target.id,
    // Returned only when this call minted it. An owner-chosen password is
    // already known to the owner and is not echoed back.
    temporaryPassword: options.password ? null : password,
    mustChangePassword: options.requireChange,
  };
}

/**
 * Clears everything that refuses a sign-in before the password is even read:
 * the account lock, the failed counter, and the per-account Redis throttle.
 *
 * All three, deliberately. Clearing only `lockedUntil` leaves an operator
 * telling a customer to try again into a throttle that is still closed, which is
 * how "I unlocked it and it still says the password is wrong" happens. Global
 * and per-IP brute-force limits are untouched.
 */
export async function unlockAccount(ctx: PlatformCtx, userId: string) {
  const target = await loadTarget(userId);
  const wasLocked = target.lockedUntil !== null && target.lockedUntil > new Date();

  await prisma.platformUser.update({
    where: { id: target.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await clearSignInThrottle(target.email);

  await record(ctx, 'ACCOUNT_UNLOCKED', target, {
    result: 'ok',
    wasLocked,
    clearedFailedAttempts: target.failedLoginCount,
  });
  return { userId: target.id, unlocked: true, wasLocked };
}

/** Drops the account's sign-in throttle windows. Per-IP limits are not touched. */
async function clearSignInThrottle(email: string) {
  const { key } = limits.loginPerAccount(email);
  await invalidate(`rl:${key}:*`).catch(() => {});
}

/**
 * Invalidates the authenticator and every recovery code, so the next successful
 * password sign-in starts enrolment again.
 *
 * Not a disable: for a privileged platform role `mfaRequired` stays true in the
 * login route, so the account gets a restricted enrolment grant rather than a
 * session. Turning security off permanently for the accounts that need it most
 * is the failure mode this avoids.
 */
export async function resetMfa(ctx: PlatformCtx, userId: string) {
  const target = await loadTarget(userId);
  // The last owner losing their factor is recoverable — the login route routes
  // them to enrolment — but it is still an event worth refusing by accident.
  await refuseOwnerLockout(ctx, target);

  await withPlatformTx(async (tx) => {
    await tx.platformUser.update({
      where: { id: target.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });
    await tx.authenticationFactor.deleteMany({ where: { platformUserId: target.id, type: 'TOTP' } });
    await tx.platformSession.updateMany({
      where: { platformUserId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'MFA_RESET' },
    });
  });

  await record(ctx, 'MFA_RESET', target, {
    result: 'ok',
    enrolmentRequired: isPrivilegedPlatformRole(target.platformRole),
  });
  return { userId: target.id, mfaState: 'ENROLMENT_REQUIRED' as MfaState };
}

/**
 * Deactivation stops authentication and nothing else. CRM ownership, audit
 * attribution and history stay pointing at the account, which is why this sets a
 * status rather than deleting anything.
 */
export async function setAccountActive(ctx: PlatformCtx, userId: string, active: boolean) {
  const target = await loadTarget(userId);
  if (!active) await refuseOwnerLockout(ctx, target);

  await withPlatformTx(async (tx) => {
    await tx.platformUser.update({
      where: { id: target.id },
      data: {
        status: active ? 'ACTIVE' : 'DEACTIVATED',
        ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    if (!active) {
      await tx.platformSession.updateMany({
        where: { platformUserId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DEACTIVATED' },
      });
    }
  });
  if (active) await clearSignInThrottle(target.email);

  await record(ctx, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', target, { result: 'ok' });
  return { userId: target.id, status: active ? 'ACTIVE' : 'DEACTIVATED' };
}

/** Promotes or demotes the *platform* role. Workspace roles go through `changeWorkspaceRole`. */
export async function setPlatformRole(ctx: PlatformCtx, userId: string, platformRole: string) {
  const target = await loadTarget(userId);
  await refuseOwnerLockout(ctx, target);

  await withPlatformTx(async (tx) => {
    await tx.platformUser.update({ where: { id: target.id }, data: { platformRole: platformRole as never } });
    // The role decides what the session may reach, so the session is rebuilt.
    await tx.platformSession.updateMany({
      where: { platformUserId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ROLE_CHANGED' },
    });
  });

  await record(ctx, 'ROLE_CHANGED', target, {
    result: 'ok',
    scope: 'platform',
    from: target.platformRole,
    to: platformRole,
  });
  return { userId: target.id, platformRole };
}

// ── Workspace membership repair ────────────────────────────────────────────

/**
 * Changes the workspace role through the tenant's own RBAC tables — the role
 * row, the user's `roleId`, and the membership snapshot login reads — rather
 * than inventing a platform-side permission of its own.
 */
export async function changeWorkspaceRole(ctx: PlatformCtx, membershipId: string, roleId: string) {
  const membership = await membershipFor(membershipId);
  const role = await prisma.role.findFirst({
    where: { tenantId: membership.tenantId, id: roleId },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw NotFound('Role');
  if (!membership.salesUserId) throw Conflict('This membership has no workspace user to assign a role to.');

  await prisma.user.update({
    where: { tenantId: membership.tenantId, id: membership.salesUserId },
    data: { roleId: role.id },
  });
  await prisma.workspaceMembership.update({ where: { id: membership.id }, data: { roleSnapshot: role.key } });
  await prisma.platformSession.updateMany({
    where: { platformUserId: membership.platformUserId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'ROLE_CHANGED' },
  });

  await record(
    ctx,
    'ROLE_CHANGED',
    { id: membership.platformUserId, email: membership.platformUser.email },
    {
      result: 'ok',
      scope: 'workspace',
      workspace: membership.tenant.slug,
      from: membership.roleSnapshot,
      to: role.key,
    },
    membership.tenantId,
  );
  return { membershipId: membership.id, role: role.key };
}

/**
 * The repair for "the account looks fine but login says no workspace".
 *
 * Login requires *four* things to line up: membership ACTIVE, tenant ACTIVE and
 * undeleted, and the tenant-side `User` row ACTIVE and undeleted. Activating
 * only the membership fixes one of them and leaves the symptom, so this sets the
 * membership and its workspace user together.
 */
export async function setMembershipStatus(
  ctx: PlatformCtx,
  membershipId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED',
) {
  const membership = await membershipFor(membershipId);
  const now = new Date();

  await prisma.workspaceMembership.update({
    where: { id: membership.id },
    data: {
      status,
      joinedAt: status === 'ACTIVE' ? (membership.joinedAt ?? now) : membership.joinedAt,
      suspendedAt: status === 'SUSPENDED' ? now : null,
      removedAt: status === 'REMOVED' ? now : null,
    },
  });

  if (membership.salesUserId) {
    await prisma.user.update({
      where: { tenantId: membership.tenantId, id: membership.salesUserId },
      data:
        status === 'ACTIVE'
          ? { status: 'ACTIVE', deletedAt: null }
          : { status: status === 'REMOVED' ? 'DEACTIVATED' : 'SUSPENDED' },
    });
  }
  if (status !== 'ACTIVE') {
    await prisma.platformSession.updateMany({
      where: { platformUserId: membership.platformUserId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'MEMBERSHIP_CHANGED' },
    });
  }

  await record(
    ctx,
    'MEMBERSHIP_CHANGED',
    { id: membership.platformUserId, email: membership.platformUser.email },
    { result: 'ok', workspace: membership.tenant.slug, from: membership.status, to: status },
    membership.tenantId,
  );
  return { membershipId: membership.id, status };
}

async function membershipFor(membershipId: string) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      tenantId: true,
      platformUserId: true,
      salesUserId: true,
      status: true,
      roleSnapshot: true,
      joinedAt: true,
      tenant: { select: { slug: true } },
      platformUser: { select: { email: true } },
    },
  });
  if (!membership) throw NotFound('Membership');
  return membership;
}

// ── Owner dashboard ────────────────────────────────────────────────────────

/**
 * The operational counters the platform overview leads with. Deliberately the
 * five an operator acts on — locked accounts, privileged accounts missing a
 * second factor, recent authentication failures — rather than vanity totals.
 */
export async function platformSecuritySnapshot() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [workspaces, users, lockedRows, privileged, failures, recentFailures] = await Promise.all([
    prisma.tenant.count({ where: { deletedAt: null } }),
    prisma.platformUser.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.platformUser.findMany({
      where: { deletedAt: null, lockedUntil: { gt: now } },
      select: { id: true, email: true, fullName: true, lockedUntil: true, failedLoginCount: true },
      orderBy: { lockedUntil: 'desc' },
      take: 10,
    }),
    prisma.platformUser.findMany({
      where: { deletedAt: null, status: 'ACTIVE', platformRole: { not: 'USER' }, mfaEnabled: false },
      select: { id: true, email: true, fullName: true, platformRole: true },
      take: 10,
    }),
    prisma.platformAuditEvent.count({ where: { event: 'LOGIN_FAILED', occurredAt: { gte: dayAgo } } }),
    prisma.platformAuditEvent.findMany({
      where: { event: 'LOGIN_FAILED', occurredAt: { gte: dayAgo } },
      select: { id: true, occurredAt: true, metadata: true, ipAddress: true, objectId: true },
      orderBy: { occurredAt: 'desc' },
      take: 8,
    }),
  ]);

  return { workspaces, users, locked: lockedRows, privilegedWithoutMfa: privileged, failures, recentFailures };
}
