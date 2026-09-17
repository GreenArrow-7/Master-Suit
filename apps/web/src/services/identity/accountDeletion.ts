import { prisma, withPlatformTx } from '@/lib/db';
import { env } from '@/lib/env';
import { audit } from '@/lib/security/audit';
import { logger } from '@/lib/logger';
import { consume, limits } from '@/lib/security/ratelimit';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { consumeTotp, REPLAYED_CODE } from '@/lib/auth/totp-consume';
import { ADMIN_ROLE_RANK, otherActiveAdmins } from './accounts';
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

/**
 * Whether the worker may erase. Off by default: requests queue as REQUESTED or BLOCKED,
 * remain visible and withdrawable, and nothing irreversible happens until the operator
 * turns this on deliberately — see ACCOUNT_DELETION_EXECUTION_ENABLED in env.ts.
 */
export const executionEnabled = () => env.ACCOUNT_DELETION_EXECUTION_ENABLED;

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
    // The shared helper, not a second copy of the query. The copy that used to live here
    // carried its own threshold of 20, which is sales_director and hr_admin — neither
    // administers a workspace — so a workspace's only org_admin (rank 10) was not blocked
    // as long as any director existed. Importing both the constant and the count is what
    // stops the two definitions drifting again.
    if ((await otherActiveAdmins(membership.tenantId, self.id)) === 0) {
      blockers.push({ tenantId: membership.tenantId, workspace, reason: 'LAST_ADMIN' });
    }
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
    // Exactly what the card renders. `reason`, `startedAt` and `completedAt` were in here
    // and in nothing that read them: a server component serialises whatever it is handed,
    // so the person's free-text reason was crossing to the client for no purpose. It is
    // their own text, not a leak — but an unread field on the wire is one nobody is
    // checking, and the prop type said it was not there.
    select: { id: true, status: true, blockedReason: true, requestedAt: true },
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
  // Reauthentication is a password check reachable with nothing but a live session, so it
  // is an oracle unless it is throttled - a borrowed unlocked laptop should not get
  // unlimited guesses. Same bucket the platform credential reauthentication uses.
  await consume(limits.mfaConfirm(identity.id));
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
      // Reasons and a count, never the workspace names. The blocker list spans every
      // workspace the person belongs to, and this row lands in one tenant's audit log, so
      // writing slugs would tell this customer's administrator which other customers
      // employ the same person. The full text still goes back to the person.
      newValue: { status, blockerReasons: blockers.map((b) => b.reason), blockerCount: blockers.length },
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

/** What a person is told when the executor already holds their request. */
export const ALREADY_PROCESSING = 'That request is already being processed and can no longer be cancelled.';

/** Withdraws a request that has not started being processed. */
export async function cancelAccountDeletion(ctx: Ctx) {
  const { identity } = await identityOf(ctx);
  // Read the row whatever its status, then decide. Filtering this read to REQUESTED and
  // BLOCKED meant a row the sweep was holding as IN_PROGRESS matched nothing, so the
  // person was told their request did not exist — the one message that is certainly
  // false — instead of that it had started. That window is not rare: the sweep re-claims
  // BLOCKED rows to re-check them, so a blocked person pressing Withdraw could hit it.
  const open = await prisma.accountDeletionRequest.findFirst({
    where: { platformUserId: identity.id, status: { in: [...OPEN] } },
    select: { id: true, status: true },
  });
  if (!open) throw NotFound('Deletion request');
  // IN_PROGRESS is deliberately not cancellable: erasure has begun and a half-erased
  // account cannot be restored by flipping a status back.
  if (open.status === 'IN_PROGRESS') throw Conflict(ALREADY_PROCESSING);
  // Conditional on the status the read saw, because the read and the write are two
  // statements and the executor can claim the row between them. An unconditional update
  // here would write CANCELLED over IN_PROGRESS and tell somebody their erasure was
  // called off while it was running.
  const { count } = await prisma.accountDeletionRequest.updateMany({
    where: { id: open.id, status: { in: ['REQUESTED', 'BLOCKED'] } },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  if (count === 0) throw Conflict(ALREADY_PROCESSING);
  const cancelled = { id: open.id, status: 'CANCELLED' as const };
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

/**
 * The erasure's own audit record.
 *
 * It is the one act in this feature that cannot be reconstructed from the data afterwards,
 * and it was the only one writing no audit row at all. PlatformAuditEvent rather than
 * AuditLog because the erasure spans every workspace the person belonged to and therefore
 * belongs to none of them: tenantId stays null rather than naming one. Counts only - never
 * a workspace name, never anything the person wrote.
 */
async function recordErasure(platformUserId: string, requestId: string, outcome: ErasureOutcome) {
  await prisma.platformAuditEvent.create({
    data: {
      tenantId: null,
      actorUserId: null,
      event: 'ACCOUNT_ERASED',
      objectType: 'account_deletion_request',
      objectId: requestId,
      metadata: { platformUserId, ...outcome } as object,
    },
  });
}

/**
 * A request left IN_PROGRESS longer than this is treated as interrupted, and resumable.
 *
 * Must comfortably exceed the sweep cadence in `workers/maintenance.ts`. At exactly the
 * cadence (both were fifteen minutes) a run that overran its interval would have the next
 * run reclaim the row it was still erasing, and two executors would walk the same account.
 */
const STALE_AFTER_MS = 45 * 60 * 1000;

/**
 * How long a BLOCKED request waits before the sweep re-checks it.
 *
 * Without this the sweep starves. It takes the twenty oldest open rows, and a request
 * blocked by a sole founder who never transfers ownership keeps the oldest `requestedAt`
 * in the table for ever — twenty of those fill every batch on every run and no newer
 * request is ever reached. Re-checking a blocker that changes about as often as a
 * company's ownership does not need to happen every fifteen minutes. Somebody who has
 * just transferred ownership does not wait for it either: withdrawing and asking again
 * creates a REQUESTED row that the next sweep picks up.
 */
const BLOCKED_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Claims after which the sweep stops retrying an IN_PROGRESS row.
 *
 * Resuming an interrupted erasure is right; resuming one that fails the same way every
 * time, every 45 minutes, for the life of the deployment is not — and because the sweep
 * is oldest-first with a batch of twenty, such rows would eventually be the whole batch.
 * Past the cap the row stays IN_PROGRESS (never COMPLETED, never quietly CANCELLED), is
 * reported by `stuckAccountDeletions`, and needs a person.
 */
export const MAX_ATTEMPTS = 5;

/** Reads that must see rows HR has already offboarded; the guard hides them otherwise. */
const INCLUDE_DELETED: object = { __includeDeleted: true };

export interface RetainedCategory {
  category: string;
  count: number;
  reason: string;
}

/**
 * What is still here after the erasure, counted from the database rather than described.
 *
 * A completion notice that says "your data has been deleted" while an employment record
 * holds an IBAN, a WPS person id and a scanned passport is not a true statement, and this
 * feature's whole premise is that only a verified erasure may be reported as one. So the
 * executor states the remainder in the same breath as the result: category, actual count,
 * and the reason it is still there.
 *
 * Nothing here is erased by this request. Which of these categories should move from
 * retained to erased is a policy decision for the operator, and the counts are what make
 * that decision an informed one instead of a guess.
 */
async function retentionManifest(
  memberships: { id: string; tenantId: string; salesUserId: string | null }[],
): Promise<RetainedCategory[]> {
  let attributedNames = 0;
  let auditEntries = 0;
  let hrProfiles = 0;
  let hrFinancialIdentifiers = 0;
  let hrDocuments = 0;
  let hrStoredFiles = 0;

  for (const membership of memberships) {
    if (membership.salesUserId) {
      attributedNames += 1;
      auditEntries += await prisma.auditLog.count({
        where: { tenantId: membership.tenantId, actorUserId: membership.salesUserId },
      });
    }
    // Offboarded employees included deliberately: they are the people most likely to be
    // asking, and the guard's soft-delete filter would otherwise report zero for exactly
    // the accounts whose HR record is most complete.
    const profile = await prisma.employeeProfile.findFirst({
      where: { tenantId: membership.tenantId, membershipId: membership.id },
      select: { id: true, iban: true, bankAgentId: true, wpsPersonId: true, reraBrn: true },
      ...INCLUDE_DELETED,
    });
    if (!profile) continue;
    hrProfiles += 1;
    if (profile.iban || profile.bankAgentId || profile.wpsPersonId || profile.reraBrn) {
      hrFinancialIdentifiers += 1;
    }
    const documents = await prisma.hrEmployeeDocument.findMany({
      where: { tenantId: membership.tenantId, employeeId: profile.id },
      select: { storageKey: true },
    });
    hrDocuments += documents.length;
    hrStoredFiles += documents.filter((d) => d.storageKey).length;
  }

  const retained: RetainedCategory[] = [];
  if (attributedNames > 0) {
    retained.push({
      category: 'workspace_attribution',
      count: attributedNames,
      reason:
        'Name and user id kept on the workspace record so the leads, calls, receipts and approvals this person entered stay attributable.',
    });
  }
  if (auditEntries > 0) {
    retained.push({
      category: 'audit_trail',
      count: auditEntries,
      reason:
        'Audit entries keep the acting user id, and their lifetime follows the workspace audit policy rather than this request.',
    });
  }
  if (hrProfiles > 0) {
    retained.push({
      category: 'hr_employment_record',
      count: hrProfiles,
      reason:
        'Employment record retained: payroll runs, payslips and settlement snapshots reference it. Not erased by this request.',
    });
  }
  if (hrFinancialIdentifiers > 0) {
    retained.push({
      category: 'hr_financial_identifiers',
      count: hrFinancialIdentifiers,
      reason:
        'IBAN, bank agent id, WPS person id and RERA BRN are still on the employment record. Not erased by this request.',
    });
  }
  if (hrDocuments > 0) {
    retained.push({
      category: 'hr_identity_documents',
      count: hrDocuments,
      reason: `Identity and visa documents retained, ${hrStoredFiles} of them with a stored file. Not erased by this request.`,
    });
  }
  // Always stated. It is never zero and it is never erasable in place, so leaving it out
  // when nothing else remains would read as "nothing is left", which is not true.
  retained.push({
    category: 'backups',
    count: 0,
    reason:
      'Encrypted backups still contain this account until they age out of their retention window; a backup cannot be edited selectively.',
  });
  return retained;
}

export interface ErasureOutcome {
  sessionsRevoked: number;
  membershipsRemoved: number;
  workspaceUsersSoftDeleted: number;
  faceTemplatesDeleted: number;
  biometricConsentsDeleted: number;
  passwordHistoryDeleted: number;
  resetTokensDeleted: number;
  authenticationFactorsDeleted: number;
  mfaChallengesDeleted: number;
  workspaceUsersAnonymised: number;
  apiKeysRevoked: number;
  deviceTokensDeleted: number;
  /** Platform-staff credentials and grants keyed on this identity. */
  serviceCredentialsRevoked: number;
  accessGrantsRevoked: number;
  coverageGrantsRevoked: number;
  /** Open invitations to this address in the person's own workspaces. */
  invitationsRevoked: number;
  credentialsCleared: boolean;
  identityAnonymised: boolean;
  /** Counted, not claimed: what this erasure did not remove, and why. */
  retained?: RetainedCategory[];
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
        // BLOCKED is reclaimable: the blocker re-check below re-blocks it immediately if
        // the blocker still stands, so a person who transfers ownership is not stranded
        // with a row the partial index also stops them replacing.
        { status: 'BLOCKED' },
        // Interrupted: started, never finished, long enough ago that whoever held it
        // is not coming back.
        { status: 'IN_PROGRESS', startedAt: { lt: stale } },
      ],
    },
    data: { status: 'IN_PROGRESS', startedAt: new Date(), attempts: { increment: 1 } },
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

  // Before the claim, so a disabled executor changes no state at all: the row is not
  // moved to IN_PROGRESS, no startedAt is written, and cancel still works.
  if (!executionEnabled()) return { status: 'SKIPPED', requestId, reason: 'execution disabled' };

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
    authenticationFactorsDeleted: 0,
    mfaChallengesDeleted: 0,
    workspaceUsersAnonymised: 0,
    apiKeysRevoked: 0,
    deviceTokensDeleted: 0,
    serviceCredentialsRevoked: 0,
    accessGrantsRevoked: 0,
    coverageGrantsRevoked: 0,
    invitationsRevoked: 0,
    credentialsCleared: false,
    identityAnonymised: false,
  };

  try {
    // Read before step 4 tombstones it: open invitations are keyed on this address.
    const { normalizedEmail } = await prisma.platformUser.findUniqueOrThrow({
      where: { id: platformUserId },
      select: { normalizedEmail: true },
    });

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

        // Attribution needs a name and an id. It does not need a working email address, a
        // mobile number or a photograph, and the CRM renders all three. Keeping the row is
        // deliberate; keeping the contact details was not, and a status of COMPLETED while
        // they sat there was the soft-deactivation this feature must not report as erasure.
        outcome.workspaceUsersAnonymised += (
          await prisma.user.updateMany({
            where: { tenantId: membership.tenantId, id: membership.salesUserId },
            data: {
              email: `deleted-${membership.salesUserId}@deleted.invalid`,
              phone: null,
              avatarUrl: null,
            },
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
      //
      // Deleted through the relation rather than by first listing employee profiles.
      // EmployeeProfile is in SOFT_DELETE_MODELS, so the guard adds `deletedAt: null`
      // to that list — which silently skips anyone HR has offboarded, the very person
      // most likely to be asking for erasure. Their templates would survive, and the
      // verification below (a relation filter the guard does not touch) would then count
      // them and fail the request for ever. Step 5 counts through the same
      // `employee: { membershipId }` predicate, so what is deleted and what is
      // verified cannot drift apart.
      outcome.faceTemplatesDeleted += (
        await prisma.hrFaceTemplate.deleteMany({
          where: { tenantId: membership.tenantId, employee: { membershipId: membership.id } },
        })
      ).count;
      outcome.biometricConsentsDeleted += (
        await prisma.biometricConsent.deleteMany({
          where: { tenantId: membership.tenantId, employee: { membershipId: membership.id } },
        })
      ).count;

      // ── 3b. Credentials that outlive the session ──────────────────────────
      // An API key authenticates as the person who created it and carries its role's
      // permissions; nothing in the key path re-reads the creating user, so a key minted
      // by this person keeps working after the account is gone.
      if (membership.salesUserId) {
        outcome.apiKeysRevoked += (
          await prisma.aPIKey.updateMany({
            where: { tenantId: membership.tenantId, createdById: membership.salesUserId, revokedAt: null },
            data: { revokedAt: new Date() },
          })
        ).count;
        // Push registrations are keyed on the tenant User, which is soft-deleted rather
        // than removed, so the cascade never fires and the handset keeps receiving
        // notification titles.
        outcome.deviceTokensDeleted += (
          await prisma.deviceToken.deleteMany({ where: { userId: membership.salesUserId } })
        ).count;
      }

      // An open invitation to this address in a workspace the person belongs to is both
      // their personal data sitting in a pending row and, once the identity is tombstoned,
      // a way to mint a fresh account under the same address without anyone deciding to.
      // Revoked here, per workspace, because the table is tenant-guarded; invitations sent
      // by other workspaces are that inviter's record and stay theirs.
      outcome.invitationsRevoked += (
        await prisma.workspaceInvitation.updateMany({
          where: { tenantId: membership.tenantId, email: normalizedEmail, pendingKey: { not: null } },
          data: { revokedAt: new Date(), revokedReason: 'account deleted', pendingKey: null },
        })
      ).count;
    }

    // ── 3c. Platform-side credentials and grants ─────────────────────────
    // Platform staff authenticate with a service credential and act on tenants through
    // access and coverage grants, all keyed on the platform identity. None of them is
    // reached by the per-workspace loop, and the PlatformUser row survives as a tombstone,
    // so `onDelete: Cascade` never fires for them. Revoked, never deleted: the grant is the
    // audit record of who was allowed to see what.
    outcome.serviceCredentialsRevoked = (
      await prisma.platformServiceCredential.updateMany({
        where: { platformUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'account deleted' },
      })
    ).count;
    // PlatformAccessGrant carries a tenantId and is under row-level security
    // (20260826120000): without a pinned tenant or `app.platform_admin` the update
    // matches nothing and the count below reads zero — which is precisely what CI, running
    // as the RLS role, reported while a local run as the table owner passed. A person's
    // grants span whichever tenants they were granted, so no single tenant can be pinned;
    // this is the same cross-tenant read `liveGrantCount` makes, and it is narrowed to one
    // platformUserId and to revocation. withPlatformTx's contract names requirePlatformOwner;
    // the executor has no request actor — it acts on a reauthenticated, recorded request —
    // and that departure is deliberate and confined to these two statements.
    outcome.accessGrantsRevoked = await withPlatformTx(
      async (tx) =>
        (
          await tx.platformAccessGrant.updateMany({
            where: { platformUserId, revokedAt: null },
            data: { revokedAt: new Date() },
          })
        ).count,
    );
    outcome.coverageGrantsRevoked = (
      await prisma.platformCoverageGrant.updateMany({
        where: { platformUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'account deleted' },
      })
    ).count;

    // ── 4. The identity itself ──────────────────────────────────────────────
    // tenantId is nullable on this table: an account that has no workspace yet still
    // gets reset links, and those rows match no membership, so the per-workspace deletes
    // above walk straight past them. A live reset link is a way back into the account.
    // PasswordResetToken is on the RLS bootstrap list — it has to be readable before a
    // tenant is known — so this delete genuinely reaches them rather than failing closed.
    outcome.resetTokensDeleted += (
      await prisma.passwordResetToken.deleteMany({ where: { tenantId: null, platformUserId } })
    ).count;
    outcome.passwordHistoryDeleted = (await prisma.passwordHistory.deleteMany({ where: { platformUserId } })).count;
    // Clearing mfaSecret on PlatformUser is a third of the job. clearFactors in
    // twoFactor.ts has removed all three since TOTP was added: the factor rows carry their
    // own secret, and an unconsumed challenge is a sign-in already part-way through.
    // Leaving the factor rows also makes the platform console report a second factor on an
    // account that no longer exists.
    outcome.authenticationFactorsDeleted = (
      await prisma.authenticationFactor.deleteMany({ where: { platformUserId } })
    ).count;
    outcome.mfaChallengesDeleted = (await prisma.platformMfaChallenge.deleteMany({ where: { platformUserId } })).count;

    // email is unique and not nullable, so it becomes a tombstone rather than being
    // cleared: unique per account, obviously not a real address, and it keeps the row
    // intact for the audit trail that still points at it.
    const tombstone = `deleted-${platformUserId}@deleted.invalid`;
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: {
        passwordHash: null,
        // Forward, never back: these counters are what credential and challenge checks
        // compare against, so resetting them to 0 would re-admit anything minted at 0.
        passwordVersion: { increment: 1 },
        monitoringPasswordHash: null,
        monitoringPasswordVersion: { increment: 1 },
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
        monitoringPasswordHash: true,
        mfaSecret: true,
        mfaRecoveryCodes: true,
        email: true,
        phone: true,
        deletedAt: true,
      },
    });
    const sessionsLeft = await prisma.platformSession.count({ where: { platformUserId } });
    const factorsLeft = await prisma.authenticationFactor.count({ where: { platformUserId } });
    const challengesLeft = await prisma.platformMfaChallenge.count({ where: { platformUserId } });
    // Scoped by the tenants this account actually belonged to: the guard covers these
    // models, and a verification query is not exempt from it just because it only reads.
    // One pinned count per tenant. `tenantId: { in: [...] }` is not a literal, so the
    // client pins no app.tenant_id, RLS fails closed, and the count comes back 0 whatever
    // the table holds — a verification that could never fail and therefore proved nothing.
    //
    // Every write in steps 2 and 3 is counted here. Steps were added to this executor
    // twice without a matching check, and an `updateMany` that quietly matched zero rows
    // still let COMPLETED be written: the tombstoning added precisely because a COMPLETED
    // row had kept the person's phone number was itself going unverified.
    let facesLeft = 0;
    let consentsLeft = 0;
    let resetTokensLeft = 0;
    let apiKeysLeft = 0;
    let deviceTokensLeft = 0;
    let contactableLeft = 0;
    for (const membership of memberships) {
      facesLeft += await prisma.hrFaceTemplate.count({
        where: { tenantId: membership.tenantId, employee: { membershipId: membership.id } },
      });
      consentsLeft += await prisma.biometricConsent.count({
        where: { tenantId: membership.tenantId, employee: { membershipId: membership.id } },
      });
      resetTokensLeft += await prisma.passwordResetToken.count({
        where: { tenantId: membership.tenantId, platformUserId },
      });
      if (!membership.salesUserId) continue;
      apiKeysLeft += await prisma.aPIKey.count({
        where: { tenantId: membership.tenantId, createdById: membership.salesUserId, revokedAt: null },
      });
      deviceTokensLeft += await prisma.deviceToken.count({ where: { userId: membership.salesUserId } });
      // `deletedAt: { not: null }` explicitly, because the guard injects `deletedAt: null`
      // into a read that does not mention it — and step 2 has just soft-deleted this very
      // row, so the default filter would match nothing and this check would be vacuous.
      contactableLeft += await prisma.user.count({
        where: {
          tenantId: membership.tenantId,
          id: membership.salesUserId,
          deletedAt: { not: null },
          OR: [
            { phone: { not: null } },
            { avatarUrl: { not: null } },
            { email: { not: `deleted-${membership.salesUserId}@deleted.invalid` } },
          ],
        },
      });
    }

    resetTokensLeft += await prisma.passwordResetToken.count({ where: { tenantId: null, platformUserId } });

    // Counted for the account, not for the snapshot taken back in step 2. Accepting a
    // workspace invitation reactivates an existing identity, and it refuses only on
    // `deletedAt`, which is not written until step 4 — so a membership created while this
    // erasure was running was invisible to the loop above and COMPLETED would still have
    // been written over it. `acceptInvitation` now refuses outright; this is the check
    // that does not depend on that one holding.
    const membershipsLeft = await prisma.workspaceMembership.count({
      where: { platformUserId, status: { not: 'REMOVED' } },
    });
    const serviceCredentialsLeft = await prisma.platformServiceCredential.count({
      where: { platformUserId, revokedAt: null },
    });
    const accessGrantsLeft = await withPlatformTx((tx) =>
      tx.platformAccessGrant.count({ where: { platformUserId, revokedAt: null } }),
    );
    const coverageGrantsLeft = await prisma.platformCoverageGrant.count({
      where: { platformUserId, revokedAt: null },
    });
    let invitationsLeft = 0;
    for (const membership of memberships) {
      invitationsLeft += await prisma.workspaceInvitation.count({
        where: { tenantId: membership.tenantId, email: normalizedEmail, pendingKey: { not: null } },
      });
    }

    const unfinished: string[] = [];
    if (after.passwordHash !== null) unfinished.push('passwordHash');
    // The step exists to prove the credentials are gone, so it has to check both of them.
    if (after.monitoringPasswordHash !== null) unfinished.push('monitoringPasswordHash');
    if (after.mfaSecret !== null) unfinished.push('mfaSecret');
    if (after.mfaRecoveryCodes.length !== 0) unfinished.push('mfaRecoveryCodes');
    if (after.phone !== null) unfinished.push('phone');
    if (after.email !== tombstone) unfinished.push('email');
    if (after.deletedAt === null) unfinished.push('deletedAt');
    if (sessionsLeft !== 0) unfinished.push(`sessions(${sessionsLeft})`);
    if (factorsLeft !== 0) unfinished.push(`authenticationFactors(${factorsLeft})`);
    if (challengesLeft !== 0) unfinished.push(`mfaChallenges(${challengesLeft})`);
    if (facesLeft !== 0) unfinished.push(`faceTemplates(${facesLeft})`);
    if (consentsLeft !== 0) unfinished.push(`biometricConsents(${consentsLeft})`);
    if (resetTokensLeft !== 0) unfinished.push(`passwordResetTokens(${resetTokensLeft})`);
    if (apiKeysLeft !== 0) unfinished.push(`activeApiKeys(${apiKeysLeft})`);
    if (deviceTokensLeft !== 0) unfinished.push(`deviceTokens(${deviceTokensLeft})`);
    if (contactableLeft !== 0) unfinished.push(`workspaceContactDetails(${contactableLeft})`);
    if (membershipsLeft !== 0) unfinished.push(`activeMemberships(${membershipsLeft})`);
    if (serviceCredentialsLeft !== 0) unfinished.push(`serviceCredentials(${serviceCredentialsLeft})`);
    if (accessGrantsLeft !== 0) unfinished.push(`accessGrants(${accessGrantsLeft})`);
    if (coverageGrantsLeft !== 0) unfinished.push(`coverageGrants(${coverageGrantsLeft})`);
    if (invitationsLeft !== 0) unfinished.push(`openInvitations(${invitationsLeft})`);

    if (unfinished.length > 0) {
      outcome.error = `verification failed: ${unfinished.join(', ')}`;
      await prisma.accountDeletionRequest.update({ where: { id: requestId }, data: { outcome: { ...outcome } } });
      return { status: 'FAILED', requestId, outcome };
    }

    // Counted before COMPLETED is written, so the row that says the request was honoured
    // carries, in the same record, the categories it did not remove.
    outcome.retained = await retentionManifest(memberships);

    // Before COMPLETED, and no longer swallowing its own failure. It used to run after,
    // catching its error, so the one act this feature cannot reconstruct from the data
    // could leave no record at all while the row claimed success. If it throws now, the
    // catch below leaves the request IN_PROGRESS and the sweep runs it again; a duplicate
    // erasure event on a retry is a far smaller problem than a missing one.
    await recordErasure(platformUserId, requestId, outcome);

    await prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: new Date(), outcome: { ...outcome } },
    });
    return { status: 'COMPLETED', requestId, outcome };
  } catch (err) {
    // Left IN_PROGRESS deliberately. Flipping back to REQUESTED would hide that erasure
    // had already started; writing COMPLETED would claim a deletion that did not finish.
    // A Prisma failure message embeds the data payload it was called with, and a
    // connection error can embed the DSN. This column is read by an operator surface and
    // handed back to the caller, so it carries a code; the detail goes to the log, where
    // the existing redaction applies.
    const code = (err as { code?: string }).code ?? (err as Error).name ?? 'UNKNOWN';
    outcome.error = `step failed: ${code}`;
    logger.error({ err, requestId, platformUserId }, 'account deletion erasure failed');
    await prisma.accountDeletionRequest
      .update({ where: { id: requestId }, data: { outcome: { ...outcome } } })
      .catch(() => {});
    return { status: 'FAILED', requestId, outcome };
  }
}

/**
 * The consumer the request row was always waiting for.
 *
 * Without this the feature is a receipt for work that never happens: a person exercises a
 * deletion right, the row says REQUESTED, and nothing ever reads it. Driven by the existing
 * maintenance worker rather than a new queue - the `[status, requestedAt]` index exists for
 * exactly this query.
 *
 * Each request is processed independently and a failure is recorded on its own row, so one
 * account that cannot be erased does not stop the others.
 *
 * The three arms below are the queue, and they have to match what `claim` accepts —
 * they did not, and the mismatch was the worst defect this feature has had. A failed
 * erasure leaves the row IN_PROGRESS on purpose, because by then the account has already
 * been deactivated and its sessions killed; if nothing ever selects IN_PROGRESS then that
 * account is half-erased, cannot be finished, cannot be withdrawn, and cannot be asked
 * for again because the partial unique index counts the row as open. The executor's
 * retry logic existed and was unreachable outside its own tests.
 *
 * `platformUserIds` narrows the sweep to named accounts. Tests need it: the suites run in
 * parallel against one database, and an unscoped sweep erases a sibling suite's fixtures
 * mid-assertion.
 */
/** Rows the sweep has given up on. Surfaced so "held indefinitely" is never silent. */
export function stuckAccountDeletions() {
  return prisma.accountDeletionRequest.findMany({
    where: { status: 'IN_PROGRESS', attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, platformUserId: true, attempts: true, startedAt: true, outcome: true },
    orderBy: { requestedAt: 'asc' },
  });
}

export async function sweepAccountDeletions(limit = 20, platformUserIds?: string[]) {
  if (!executionEnabled()) {
    logger.info('account deletion sweep: execution disabled, requests left queued');
    return { considered: 0, completed: 0, blocked: 0, failed: 0, skipped: 0, stuck: 0, disabled: true };
  }
  const now = Date.now();
  const due = await prisma.accountDeletionRequest.findMany({
    where: {
      ...(platformUserIds ? { platformUserId: { in: platformUserIds } } : {}),
      OR: [
        { status: 'REQUESTED' },
        // Re-checked on a cooldown rather than every tick, so a permanently blocked
        // request cannot hold a batch slot for ever and starve everyone behind it.
        { status: 'BLOCKED', updatedAt: { lt: new Date(now - BLOCKED_RECHECK_MS) } },
        // Interrupted or failed. Resumed, because the alternative is an account left
        // half-erased with nobody coming back for it — up to the cap, after which it is
        // an operator's problem rather than a permanent occupant of the batch.
        { status: 'IN_PROGRESS', startedAt: { lt: new Date(now - STALE_AFTER_MS) }, attempts: { lt: MAX_ATTEMPTS } },
      ],
    },
    orderBy: { requestedAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const stuck = (await stuckAccountDeletions()).length;
  if (stuck > 0) logger.error({ stuck }, 'account deletion sweep: requests past the retry cap need an operator');
  const tally = { considered: due.length, completed: 0, blocked: 0, failed: 0, skipped: 0, stuck, disabled: false };
  for (const { id } of due) {
    try {
      const result = await processAccountDeletion(id);
      if (result.status === 'COMPLETED') tally.completed += 1;
      else if (result.status === 'BLOCKED') tally.blocked += 1;
      else if (result.status === 'FAILED') tally.failed += 1;
      else tally.skipped += 1;
    } catch (err) {
      // One unerasable account must not stop the sweep for everybody else.
      tally.failed += 1;
      logger.error({ err, requestId: id }, 'account deletion sweep: request threw');
    }
  }
  return tally;
}
