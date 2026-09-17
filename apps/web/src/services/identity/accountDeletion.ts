import { prisma } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { consumeTotp, REPLAYED_CODE } from '@/lib/auth/totp-consume';
import type { Ctx } from '@/lib/security/rbac';

/**
 * A person deleting their own platform account.
 *
 * ── What this deletes, and what it deliberately does not ────────────────────
 *
 * The unit is the **platform account**: the login identity, its credential, its
 * sessions and the personal profile on it, plus the person's membership of every
 * workspace they belong to. Three things are kept apart on purpose, because
 * conflating them destroys somebody else's data:
 *
 *   membership   one person leaving one workspace. Already exists as
 *                `deleteUser` and is an administrator's action on someone else.
 *   account      this file. The person's own identity, everywhere.
 *   workspace    an organisation closing down. Not offered here at all, and a
 *                request never triggers one.
 *
 * The records a person created — leads, calls, receipts — belong to the customer's
 * workspace, not to them. They stay, and the audit trail keeps naming who did what,
 * because a finance record whose author vanished is worse than useless. What goes is
 * the person's own identity and contact details.
 *
 * ── Why a row and not an email ──────────────────────────────────────────────
 *
 * A support mailbox cannot be audited, resumed after a crash, or shown to a reviewer
 * as evidence the request was honoured. The row is the record, the queue and the
 * evidence, and only `COMPLETED` may be described as deleted — a `DEACTIVATED` user is
 * a user who cannot sign in, which is not the same thing and must never be reported as
 * erasure.
 */

/** Statuses that mean "this request is still going somewhere". */
const OPEN = ['REQUESTED', 'BLOCKED', 'IN_PROGRESS'] as const;

/** Ranks at or above this are administrators for the last-admin check. */
const ADMIN_ROLE_RANK = 20;

export interface DeletionBlocker {
  tenantId: string;
  workspace: string;
  reason: 'PRIMARY_ADMIN' | 'LAST_ADMIN';
}

/** Resolves the signed-in actor to the identity that actually holds the credential. */
async function identityOf(ctx: Ctx) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { salesUserId: ctx.actor.id },
    select: { platformUserId: true, tenantId: true },
  });
  if (!membership) throw NotFound('User');
  const identity = await prisma.platformUser.findUnique({
    where: { id: membership.platformUserId },
    select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecret: true, deletedAt: true },
  });
  if (!identity || identity.deletedAt) throw NotFound('User');
  return { identity, tenantId: membership.tenantId };
}

/**
 * Workspaces this person cannot simply walk out of.
 *
 * Checked across every workspace they belong to, not just the one they are looking at:
 * someone can be an ordinary agent here and the only administrator somewhere else, and
 * discovering that after the credential was erased would lock a customer out of their
 * own workspace.
 */
export async function deletionBlockers(platformUserId: string): Promise<DeletionBlocker[]> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { platformUserId, status: 'ACTIVE', removedAt: null },
    select: {
      tenantId: true,
      isPrimaryAdmin: true,
      salesUserId: true,
      tenant: { select: { slug: true } },
    },
  });

  const blockers: DeletionBlocker[] = [];
  for (const membership of memberships) {
    const workspace = membership.tenant?.slug ?? membership.tenantId;
    if (membership.isPrimaryAdmin) {
      blockers.push({ tenantId: membership.tenantId, workspace, reason: 'PRIMARY_ADMIN' });
      continue;
    }
    // Last administrator: the same rule `deleteUser` already enforces, asked here so the
    // person is told before they reauthenticate rather than after.
    const self = await prisma.user.findFirst({
      where: { tenantId: membership.tenantId, id: membership.salesUserId ?? '', deletedAt: null },
      select: { id: true, role: { select: { rank: true } } },
    });
    if (!self || self.role.rank > ADMIN_ROLE_RANK) continue;
    const others = await prisma.user.count({
      where: {
        tenantId: membership.tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        id: { not: self.id },
        role: { rank: { lte: ADMIN_ROLE_RANK } },
      },
    });
    if (others === 0) blockers.push({ tenantId: membership.tenantId, workspace, reason: 'LAST_ADMIN' });
  }
  return blockers;
}

function describe(blockers: DeletionBlocker[]): string {
  return blockers
    .map((b) =>
      b.reason === 'PRIMARY_ADMIN'
        ? `${b.workspace}: you are the primary administrator. Transfer that to somebody else first.`
        : `${b.workspace}: you are the last active administrator. Promote somebody else first.`,
    )
    .join(' ');
}

/** The person's current request, if they have one. */
export async function myDeletionRequest(ctx: Ctx) {
  const { identity } = await identityOf(ctx);
  return prisma.accountDeletionRequest.findFirst({
    where: { platformUserId: identity.id, status: { in: [...OPEN] } },
    orderBy: { requestedAt: 'desc' },
    select: {
      id: true,
      status: true,
      reason: true,
      blockedReason: true,
      requestedAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
}

/**
 * Records a request after proving the person is who they say they are.
 *
 * Reauthentication is the password, and the second factor too when the account has one:
 * a request left on an unattended phone would otherwise be enough to erase somebody's
 * identity. The proof is checked before anything is written.
 */
export async function requestAccountDeletion(ctx: Ctx, input: { password: string; mfaCode?: string; reason?: string }) {
  const { identity, tenantId } = await identityOf(ctx);
  if (!identity.passwordHash) throw Forbidden('This account has no password set, so it cannot be verified here.');
  if (!(await verifyPassword(identity.passwordHash, input.password))) {
    throw Forbidden('That is not your current password.');
  }
  if (identity.mfaEnabled) {
    if (!input.mfaCode) throw Forbidden('Enter the code from your authenticator to confirm.');
    // consumeTotp, not a bare verify: it burns the step via mfaLastUsedStep, so a code
    // captured once cannot be replayed to confirm a deletion a second time.
    const outcome = await consumeTotp(identity.id, identity.mfaSecret, input.mfaCode);
    if (outcome === 'REPLAYED') throw Forbidden(REPLAYED_CODE);
    if (outcome !== 'ACCEPTED') throw Forbidden('That code did not match.');
  }

  const blockers = await deletionBlockers(identity.id);
  const status = blockers.length > 0 ? 'BLOCKED' : 'REQUESTED';
  const blockedReason = blockers.length > 0 ? describe(blockers) : null;

  try {
    const request = await prisma.accountDeletionRequest.create({
      data: {
        platformUserId: identity.id,
        requestedInTenantId: tenantId,
        status,
        reason: input.reason?.slice(0, 2000) || null,
        blockedReason,
      },
      select: { id: true, status: true, blockedReason: true, requestedAt: true },
    });
    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'account_deletion_request',
      recordId: request.id,
      newValue: { status, blockers: blockers.map((b) => `${b.workspace}:${b.reason}`) },
      metadata: { action: 'account.deletion.requested' },
    });
    return { ...request, blockers };
  } catch (err) {
    // The partial unique index is what actually prevents a double request; two taps on a
    // slow connection reach here rather than creating a second row.
    if ((err as { code?: string }).code === 'P2002') {
      throw Conflict('You already have a deletion request in progress.');
    }
    throw err;
  }
}

/** Withdraws a request that has not started being processed. */
export async function cancelAccountDeletion(ctx: Ctx) {
  const { identity } = await identityOf(ctx);
  const open = await prisma.accountDeletionRequest.findFirst({
    where: { platformUserId: identity.id, status: { in: ['REQUESTED', 'BLOCKED'] } },
    select: { id: true },
  });
  // IN_PROGRESS is deliberately not cancellable: erasure has begun and a half-erased
  // account cannot be restored by flipping a status back.
  if (!open) throw NotFound('Deletion request');
  const cancelled = await prisma.accountDeletionRequest.update({
    where: { id: open.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
    select: { id: true, status: true },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'account_deletion_request',
    recordId: cancelled.id,
    newValue: { status: 'CANCELLED' },
    metadata: { action: 'account.deletion.cancelled' },
  });
  return cancelled;
}

/**
 * ── The executor ────────────────────────────────────────────────────────────
 *
 * Erasure as a sequence of steps that can each run twice without harm and that report
 * what they actually did. Three properties matter more than tidiness:
 *
 *   idempotent    a crash halfway leaves a row IN_PROGRESS, and running again must
 *                 finish the job rather than fail on the half already done.
 *   visible       a failure leaves the row IN_PROGRESS with the error recorded — never
 *                 COMPLETED, never silently CANCELLED. It stays retryable.
 *   verified      COMPLETED is written only after re-reading the account and checking
 *                 that the credential, the second factor, the sessions and the
 *                 biometric templates are gone. "The update ran" is not evidence.
 *
 * Access ends first, deliberately: the account is deactivated and its sessions revoked
 * before anything slower runs, so no authenticated request can race the erasure.
 */

/** A request left IN_PROGRESS longer than this is treated as interrupted, and resumable. */
const STALE_AFTER_MS = 15 * 60 * 1000;

export interface ErasureOutcome {
  sessionsRevoked: number;
  membershipsRemoved: number;
  workspaceUsersSoftDeleted: number;
  faceTemplatesDeleted: number;
  biometricConsentsDeleted: number;
  passwordHistoryDeleted: number;
  resetTokensDeleted: number;
  credentialsCleared: boolean;
  identityAnonymised: boolean;
  /** Set when a step threw. The row stays IN_PROGRESS and can be run again. */
  error?: string;
}

export type ProcessResult =
  | { status: 'COMPLETED'; requestId: string; outcome: ErasureOutcome }
  | { status: 'BLOCKED'; requestId: string; blockedReason: string }
  | { status: 'FAILED'; requestId: string; outcome: ErasureOutcome }
  | { status: 'SKIPPED'; requestId: string; reason: string };

/**
 * Claims a request for processing, or reports that it cannot be claimed.
 *
 * This is where cancellation and processing are decided against each other, and the
 * database decides rather than a read-then-write. `updateMany` matching only the
 * claimable statuses is atomic: a cancel landing first leaves nothing to claim, and a
 * claim landing first leaves cancelAccountDeletion with no REQUESTED row. Exactly one
 * wins, in either arrival order.
 */
async function claim(requestId: string): Promise<'CLAIMED' | 'NOT_CLAIMABLE'> {
  const stale = new Date(Date.now() - STALE_AFTER_MS);
  const { count } = await prisma.accountDeletionRequest.updateMany({
    where: {
      id: requestId,
      OR: [
        { status: 'REQUESTED' },
        // Interrupted: started, never finished, long enough ago that whoever held it
        // is not coming back.
        { status: 'IN_PROGRESS', startedAt: { lt: stale } },
      ],
    },
    data: { status: 'IN_PROGRESS', startedAt: new Date() },
  });
  return count === 1 ? 'CLAIMED' : 'NOT_CLAIMABLE';
}

/**
 * Erases the account behind a request. Safe to call repeatedly.
 *
 * Shaped to be driven by the existing worker rather than a new queue: it takes an id,
 * does the work, and records the result on the row.
 */
export async function processAccountDeletion(requestId: string): Promise<ProcessResult> {
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { id: requestId },
    select: { id: true, platformUserId: true, status: true },
  });
  if (!request) throw NotFound('Deletion request');
  // Idempotent at the top: a second delivery of the same job is not an error.
  if (request.status === 'COMPLETED') return { status: 'SKIPPED', requestId, reason: 'already completed' };
  if (request.status === 'CANCELLED') {
    return { status: 'SKIPPED', requestId, reason: 'cancelled by the account holder' };
  }

  if ((await claim(requestId)) === 'NOT_CLAIMABLE') {
    return { status: 'SKIPPED', requestId, reason: `not claimable from status ${request.status}` };
  }

  // Re-checked after claiming, not only when it was asked for: somebody can become a
  // workspace's last administrator in between, and erasing them then would lock that
  // workspace out of its own data.
  const blockers = await deletionBlockers(request.platformUserId);
  if (blockers.length > 0) {
    const blockedReason = describe(blockers);
    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'BLOCKED', blockedReason, startedAt: null },
    });
    return { status: 'BLOCKED', requestId, blockedReason };
  }

  const platformUserId = request.platformUserId;
  const outcome: ErasureOutcome = {
    sessionsRevoked: 0,
    membershipsRemoved: 0,
    workspaceUsersSoftDeleted: 0,
    faceTemplatesDeleted: 0,
    biometricConsentsDeleted: 0,
    passwordHistoryDeleted: 0,
    resetTokensDeleted: 0,
    credentialsCleared: false,
    identityAnonymised: false,
  };

  try {
    // ── 1. End access before anything slower runs ───────────────────────────
    await prisma.platformUser.update({ where: { id: platformUserId }, data: { status: 'DEACTIVATED' } });
    outcome.sessionsRevoked = (await prisma.platformSession.deleteMany({ where: { platformUserId } })).count;

    // ── 2. Leave every workspace ────────────────────────────────────────────
    const memberships = await prisma.workspaceMembership.findMany({
      where: { platformUserId },
      select: { id: true, tenantId: true, salesUserId: true },
    });
    for (const membership of memberships) {
      outcome.membershipsRemoved += (
        await prisma.workspaceMembership.updateMany({
          where: { id: membership.id, status: { not: 'REMOVED' } },
          data: { status: 'REMOVED', removedAt: new Date() },
        })
      ).count;

      if (membership.salesUserId) {
        // Soft-deleted, not erased: the lead this user created and the receipt they
        // verified belong to the customer's workspace. Identity erasure happens once,
        // on the platform account, in step 4.
        outcome.workspaceUsersSoftDeleted += (
          await prisma.user.updateMany({
            where: { tenantId: membership.tenantId, id: membership.salesUserId, deletedAt: null },
            data: { deletedAt: new Date(), status: 'DEACTIVATED' },
          })
        ).count;
      }

      // Reset tokens carry a tenantId and are covered by the tenant guard, so they are
      // deleted here where the workspace is known rather than in one platform-wide
      // sweep. withPlatformTx would reach them, but its contract says every caller is
      // already behind requirePlatformOwner, and a worker acting on a recorded request
      // is not that — satisfying the guard honestly is better than bending the escape.
      outcome.resetTokensDeleted += (
        await prisma.passwordResetToken.deleteMany({
          where: { tenantId: membership.tenantId, platformUserId },
        })
      ).count;

      // ── 3. Biometrics ─────────────────────────────────────────────────────
      // A face template is the person's body, not the workspace's business record.
      const employees = await prisma.employeeProfile.findMany({
        where: { tenantId: membership.tenantId, membershipId: membership.id },
        select: { id: true },
      });
      for (const employee of employees) {
        outcome.faceTemplatesDeleted += (
          await prisma.hrFaceTemplate.deleteMany({
            where: { tenantId: membership.tenantId, employeeId: employee.id },
          })
        ).count;
        outcome.biometricConsentsDeleted += (
          await prisma.biometricConsent.deleteMany({
            where: { tenantId: membership.tenantId, employeeId: employee.id },
          })
        ).count;
      }
    }

    // ── 4. The identity itself ──────────────────────────────────────────────
    outcome.passwordHistoryDeleted = (await prisma.passwordHistory.deleteMany({ where: { platformUserId } })).count;

    // email is unique and not nullable, so it becomes a tombstone rather than being
    // cleared: unique per account, obviously not a real address, and it keeps the row
    // intact for the audit trail that still points at it.
    const tombstone = `deleted-${platformUserId}@deleted.invalid`;
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: {
        passwordHash: null,
        passwordVersion: 0,
        monitoringPasswordHash: null,
        monitoringPasswordVersion: 0,
        monitoringPasswordSetAt: null,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
        mfaLastUsedStep: null,
        email: tombstone,
        normalizedEmail: tombstone,
        username: null,
        fullName: 'Deleted account',
        phone: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        status: 'DEACTIVATED',
        deletedAt: new Date(),
      },
    });
    outcome.credentialsCleared = true;
    outcome.identityAnonymised = true;

    // ── 5. Verify before claiming it happened ───────────────────────────────
    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: platformUserId },
      select: {
        passwordHash: true,
        mfaSecret: true,
        mfaRecoveryCodes: true,
        email: true,
        phone: true,
        deletedAt: true,
      },
    });
    const sessionsLeft = await prisma.platformSession.count({ where: { platformUserId } });
    // Scoped by the tenants this account actually belonged to: the guard covers
    // HrFaceTemplate, and a verification query is not exempt from it just because it
    // only reads.
    const tenantIds = memberships.map((m) => m.tenantId);
    const facesLeft =
      tenantIds.length === 0
        ? 0
        : await prisma.hrFaceTemplate.count({
            where: { tenantId: { in: tenantIds }, employee: { membership: { platformUserId } } },
          });

    const unfinished: string[] = [];
    if (after.passwordHash !== null) unfinished.push('passwordHash');
    if (after.mfaSecret !== null) unfinished.push('mfaSecret');
    if (after.mfaRecoveryCodes.length !== 0) unfinished.push('mfaRecoveryCodes');
    if (after.phone !== null) unfinished.push('phone');
    if (after.email !== tombstone) unfinished.push('email');
    if (after.deletedAt === null) unfinished.push('deletedAt');
    if (sessionsLeft !== 0) unfinished.push(`sessions(${sessionsLeft})`);
    if (facesLeft !== 0) unfinished.push(`faceTemplates(${facesLeft})`);

    if (unfinished.length > 0) {
      outcome.error = `verification failed: ${unfinished.join(', ')}`;
      await prisma.accountDeletionRequest.update({ where: { id: requestId }, data: { outcome: { ...outcome } } });
      return { status: 'FAILED', requestId, outcome };
    }

    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: new Date(), outcome: { ...outcome } },
    });
    return { status: 'COMPLETED', requestId, outcome };
  } catch (err) {
    // Left IN_PROGRESS deliberately. Flipping back to REQUESTED would hide that erasure
    // had already started; writing COMPLETED would claim a deletion that did not finish.
    outcome.error = (err as Error).message;
    await prisma.accountDeletionRequest
      .update({ where: { id: requestId }, data: { outcome: { ...outcome } } })
      .catch(() => {});
    return { status: 'FAILED', requestId, outcome };
  }
}
