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
export async function requestAccountDeletion(
  ctx: Ctx,
  input: { password: string; mfaCode?: string; reason?: string },
) {
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
