#!/usr/bin/env node
/**
 * Changes the sign-in address of ONE platform identity, in one transaction, and
 * changes nothing else about it.
 *
 * Usage (dry run — inspects and prints the plan, writes nothing):
 *   node scripts/platform-identity-email.mjs --from old@example.com --to new@example.com
 *
 * Apply (refused unless the identity is the one you expect):
 *   node scripts/platform-identity-email.mjs --from old@example.com --to new@example.com \
 *     --expect-id <platformUserId> --reason "change ticket / who authorised it" --apply
 *
 * ── Why a script and not a page ────────────────────────────────────────────
 *
 * No screen changes a platform identity's email: the address is the sign-in
 * identifier for both the administration and the monitoring password, and the
 * console deliberately has no action that rewrites it. Changing it is therefore
 * an operator act from a shell, where possession of the database is already the
 * authority — the same reasoning as ensure-workspace-admin.mjs.
 *
 * ── What it does, exactly ──────────────────────────────────────────────────
 *
 *   1. Loads the identity by the old address. Stops if it does not exist, was
 *      removed, or is not the id named by --expect-id.
 *   2. Stops if the new address belongs to any identity (removed ones included)
 *      or to a workspace user in any workspace this identity belongs to. Nothing
 *      is merged, overwritten or deleted.
 *   3. Writes: PlatformUser.email + normalizedEmail; the matching User.email in
 *      each workspace membership (only where it still equals the old address);
 *      emailVerifiedAt cleared, because nobody has proved the new mailbox.
 *   4. Retires what was bound to the old identifier: every live session in both
 *      modes is revoked (EMAIL_CHANGED), unconsumed MFA challenges are deleted,
 *      unused password-reset tokens are marked used. The person signs in again
 *      with the new address and the same passwords and authenticator.
 *   5. Writes one PlatformAuditEvent (IDENTITY_EMAIL_CHANGED) naming the
 *      identity, both addresses, the reason and the counts. Historical audit
 *      rows are not rewritten.
 *   6. Re-reads the row and refuses to commit unless exactly this changed.
 *
 * Untouched by design: the id, platformRole, status, both password hashes and
 * versions, the MFA secret and recovery codes, memberships, grants, business
 * records. Nothing is printed that is secret: no hash, token or code.
 *
 * Recovery: run again with --from/--to swapped. Sessions stay revoked either way.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const from = (flag('from') ?? '').trim();
// Lowercased: every writer of PlatformUser.email stores it that way, and the workspace
// user match in accounts.ts is exact, so a mixed-case address would never resolve.
const to = (flag('to') ?? '').trim().toLowerCase();
const expectId = flag('expect-id');
const reason = flag('reason') ?? '';
const apply = argv.includes('--apply');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usage = (message) => {
  console.error(message);
  console.error(
    'Usage: node scripts/platform-identity-email.mjs --from <old> --to <new> [--expect-id <id> --reason "..." --apply]',
  );
  process.exit(2);
};
if (!EMAIL.test(from) || !EMAIL.test(to)) usage('Both --from and --to must be email addresses.');
if (from.toLowerCase() === to.toLowerCase()) usage('The two addresses are the same.');
if (apply && !expectId) usage('--apply needs --expect-id <platformUserId>: the id the dry run printed.');
if (apply && !reason) usage('--apply needs --reason: who asked, and where that is recorded.');

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** A stop that rolls the transaction back and is reported, not thrown as a crash. */
class Stop extends Error {}

const lower = (s) => s.toLowerCase();

async function main() {
  const summary = await client
    .$transaction(
      async (tx) => {
        // Every platform table here is RLS-forced; this is the transaction-local flag
        // withPlatformTx asserts, and it cannot leak to the next borrower of the pool.
        await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'on', true)`);

        // ── 1. The source, and only the source ─────────────────────────────
        const source = await tx.platformUser.findUnique({
          where: { normalizedEmail: lower(from) },
          select: {
            id: true,
            email: true,
            platformRole: true,
            status: true,
            mfaEnabled: true,
            deletedAt: true,
            passwordVersion: true,
            monitoringPasswordVersion: true,
            passwordHash: true,
            monitoringPasswordHash: true,
          },
        });
        if (!source)
          throw new Stop(`No identity has the address ${from}. Nothing was changed, and nothing was created.`);
        if (source.deletedAt) throw new Stop(`${from} belongs to a removed identity (${source.id}). Stopping.`);
        if (expectId && source.id !== expectId) {
          throw new Stop(
            `Precondition failed: ${from} is identity ${source.id}, not ${expectId}. Nothing was changed.`,
          );
        }
        const before = {
          id: source.id,
          platformRole: source.platformRole,
          status: source.status,
          mfaEnabled: source.mfaEnabled,
          hasAdministrationPassword: source.passwordHash !== null,
          hasMonitoringPassword: source.monitoringPasswordHash !== null,
          passwordVersion: source.passwordVersion,
          monitoringPasswordVersion: source.monitoringPasswordVersion,
        };

        // ── 2. The destination must be free everywhere this identity lives ──
        const occupant = await tx.platformUser.findUnique({
          where: { normalizedEmail: lower(to) },
          select: { id: true, deletedAt: true },
        });
        if (occupant) {
          throw new Stop(
            `${to} is already used by identity ${occupant.id}${occupant.deletedAt ? ' (removed)' : ''}. ` +
              'Stopping: nothing is merged, overwritten or deleted.',
          );
        }
        const memberships = await tx.workspaceMembership.findMany({
          where: { platformUserId: source.id },
          select: {
            id: true,
            tenantId: true,
            status: true,
            isPrimaryAdmin: true,
            tenant: { select: { slug: true } },
            salesUser: { select: { id: true, email: true, deletedAt: true } },
          },
        });
        const clashes = [];
        for (const m of memberships) {
          const taken = await tx.user.findFirst({
            where: { tenantId: m.tenantId, email: { equals: to, mode: 'insensitive' } },
            select: { id: true },
          });
          if (taken) clashes.push(m.tenant?.slug ?? m.tenantId);
        }
        if (clashes.length > 0) {
          throw new Stop(
            `${to} is already a user in workspace(s) ${clashes.join(', ')}. Stopping: nothing was changed.`,
          );
        }

        const liveSessions = await tx.platformSession.count({ where: { platformUserId: source.id, revokedAt: null } });
        const pendingChallenges = await tx.platformMfaChallenge.count({
          where: { platformUserId: source.id, consumedAt: null },
        });
        const unusedResetTokens = await tx.passwordResetToken.count({
          where: { platformUserId: source.id, usedAt: null },
        });
        const liveGrants = await tx.platformAccessGrant.count({
          where: { platformUserId: source.id, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        const pendingInvitesToNew = await tx.workspaceInvitation.count({
          where: { email: { equals: to, mode: 'insensitive' }, pendingKey: { not: null } },
        });
        // Reported, not touched: an invitation still addressed to the old mailbox would,
        // if accepted later, mint a new identity under that address.
        const pendingInvitesToOld = await tx.workspaceInvitation.count({
          where: { email: { equals: from, mode: 'insensitive' }, pendingKey: { not: null } },
        });
        const workspaceRows = memberships.map((m) => ({
          workspace: m.tenant?.slug ?? m.tenantId,
          membership: m.status,
          primaryAdmin: m.isPrimaryAdmin,
          userEmailMatchesOld: m.salesUser ? lower(m.salesUser.email) === lower(from) : null,
        }));

        console.log(`environment database: ${describe(process.env.DATABASE_URL)}`);
        console.log(`source identity: ${JSON.stringify(before)}`);
        console.log(`memberships: ${JSON.stringify(workspaceRows)}`);
        console.log(
          `live: sessions=${liveSessions} mfaChallenges=${pendingChallenges} unusedResetTokens=${unusedResetTokens} accessGrants=${liveGrants} pendingInvitationsToNewAddress=${pendingInvitesToNew} pendingInvitationsToOldAddress=${pendingInvitesToOld}`,
        );
        console.log(
          `plan: PlatformUser ${source.id} email ${from} → ${to} (emailVerifiedAt cleared); ` +
            `${workspaceRows.filter((r) => r.userEmailMatchesOld).length} workspace user row(s) follow; ` +
            `${liveSessions} session(s) revoked; ${pendingChallenges} challenge(s) deleted; ${unusedResetTokens} reset token(s) retired; 1 audit event.`,
        );
        if (!apply)
          throw new Stop('DRY RUN — nothing was written. Re-run with --expect-id, --reason and --apply to change it.');

        // ── 3. The change ────────────────────────────────────────────────────
        await tx.platformUser.update({
          where: { id: source.id },
          data: { email: to, normalizedEmail: lower(to), emailVerifiedAt: null },
        });
        let workspaceUsersUpdated = 0;
        for (const m of memberships) {
          if (!m.salesUser || lower(m.salesUser.email) !== lower(from)) continue;
          await tx.user.update({ where: { id: m.salesUser.id }, data: { email: to, emailVerifiedAt: null } });
          workspaceUsersUpdated += 1;
        }

        // ── 4. Retire what was bound to the old identifier ────────────────
        const now = new Date();
        const { count: sessionsRevoked } = await tx.platformSession.updateMany({
          where: { platformUserId: source.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'EMAIL_CHANGED' },
        });
        const { count: challengesDeleted } = await tx.platformMfaChallenge.deleteMany({
          where: { platformUserId: source.id, consumedAt: null },
        });
        const { count: resetTokensRetired } = await tx.passwordResetToken.updateMany({
          where: { platformUserId: source.id, usedAt: null },
          data: { usedAt: now },
        });

        // ── 5. One attributable audit row; history untouched ──────────────
        await tx.platformAuditEvent.create({
          data: {
            tenantId: null,
            actorUserId: null,
            // Named as the object, so the identity's own history page lists it.
            objectType: 'platform_user',
            objectId: source.id,
            event: 'IDENTITY_EMAIL_CHANGED',
            metadata: {
              platformUserId: source.id,
              from,
              to,
              reason,
              performedBy: 'scripts/platform-identity-email.mjs (operator shell)',
              workspaceUsersUpdated,
              sessionsRevoked,
              challengesDeleted,
              resetTokensRetired,
            },
          },
        });

        // ── 6. Verify before committing ───────────────────────────────────
        const after = await tx.platformUser.findUniqueOrThrow({
          where: { id: source.id },
          select: {
            email: true,
            normalizedEmail: true,
            emailVerifiedAt: true,
            platformRole: true,
            status: true,
            mfaEnabled: true,
            deletedAt: true,
            passwordVersion: true,
            monitoringPasswordVersion: true,
            passwordHash: true,
            monitoringPasswordHash: true,
          },
        });
        const problems = [];
        if (after.email !== to || after.normalizedEmail !== lower(to)) problems.push('email not written');
        if (after.emailVerifiedAt !== null) problems.push('emailVerifiedAt not cleared');
        if (after.platformRole !== before.platformRole) problems.push('platformRole changed');
        if (after.status !== before.status) problems.push('status changed');
        if (after.mfaEnabled !== before.mfaEnabled) problems.push('mfaEnabled changed');
        if (after.deletedAt !== null) problems.push('deletedAt set');
        if (after.passwordHash !== source.passwordHash) problems.push('administration password changed');
        if (after.monitoringPasswordHash !== source.monitoringPasswordHash)
          problems.push('monitoring password changed');
        if (after.passwordVersion !== before.passwordVersion) problems.push('passwordVersion changed');
        if (after.monitoringPasswordVersion !== before.monitoringPasswordVersion)
          problems.push('monitoringPasswordVersion changed');
        if (await tx.platformUser.findUnique({ where: { normalizedEmail: lower(from) }, select: { id: true } })) {
          problems.push('old address still resolves');
        }
        if ((await tx.platformSession.count({ where: { platformUserId: source.id, revokedAt: null } })) !== 0) {
          problems.push('live sessions remain');
        }
        if ((await tx.workspaceMembership.count({ where: { platformUserId: source.id } })) !== memberships.length) {
          problems.push('membership count changed');
        }
        if (problems.length > 0) throw new Error(`verification failed, rolled back: ${problems.join(', ')}`);
        return { id: source.id, workspaceUsersUpdated, sessionsRevoked, challengesDeleted, resetTokensRetired };
      },
      { timeout: 60_000 },
    )
    .catch((error) => {
      if (error instanceof Stop) {
        console.log(error.message);
        process.exitCode = error.message.startsWith('DRY RUN') ? 0 : 3;
        return null;
      }
      throw error;
    });
  if (summary) {
    console.log(`APPLIED: ${JSON.stringify(summary)}`);
    console.log('The person signs in again with the new address; passwords and authenticator are unchanged.');
  }
}

/** Host and database name only — never the credentials in the URL. */
function describe(url) {
  try {
    const u = new URL(url ?? '');
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparsed)';
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
