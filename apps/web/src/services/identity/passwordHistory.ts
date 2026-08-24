import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import { verifyPassword, type PasswordPolicy } from '@/lib/auth/password';

/**
 * The two password-policy rules that had no implementation.
 *
 * `PasswordPolicy` has typed `reuseWindow` (defaulted to 5) and `maxAgeDays`
 * since it was written, and the workspace settings screen has offered
 * `reuseWindow` with a 0..24 validator the whole time. Nothing read either. An
 * administrator who turned them on got settings that saved, redisplayed, and did
 * nothing — which is worse than not offering them, because the screen reads as a
 * control that is working.
 *
 * `reuseWindow` needs somewhere to compare against, which is
 * `PasswordHistory`. `maxAgeDays` needs nothing new: expiry is derived from
 * `PlatformUser.passwordChangedAt`, which already existed for the
 * temporary-password gate.
 */

/**
 * Refuses a password the account has used inside the policy's window.
 *
 * Argon2 hashes are salted, so there is no way to look up "have you used this
 * before" — each stored hash has to be verified against the candidate
 * individually. That is deliberate on argon2's part and it sets the cost here:
 * `reuseWindow` verifications, each at the configured memory cost. At the
 * default of 5 that is a fifth of a second on a password change, and at the
 * settings screen's maximum of 24 it is around a second. Both are acceptable for
 * an operation a person performs a handful of times a year; neither would be on
 * a login.
 *
 * Sequential rather than parallel for that reason: 24 concurrent argon2
 * verifications at 19 MiB each is 456 MiB of memory arriving at once, which is a
 * denial-of-service against your own web process on a box sized for the median
 * request.
 */
export async function assertNotReused(platformUserId: string, plain: string, policy: PasswordPolicy): Promise<void> {
  if (policy.reuseWindow <= 0) return;

  const previous = await prisma.passwordHistory.findMany({
    where: { platformUserId },
    orderBy: { createdAt: 'desc' },
    take: policy.reuseWindow,
    select: { passwordHash: true },
  });

  for (const entry of previous) {
    if (await verifyPassword(entry.passwordHash, plain)) {
      throw Conflict(
        policy.reuseWindow === 1
          ? 'That is your current password. Choose a different one.'
          : `You have used that password within your last ${policy.reuseWindow}. Choose a different one.`,
      );
    }
  }
}

/**
 * Files the hash being replaced, and prunes beyond the window.
 *
 * Called with the hash that is *going away*, after the new one is written — the
 * new password becomes history the next time it is replaced, so the row for it
 * is written by the next change rather than this one. That keeps
 * `assertNotReused` a straight "have you used this before" against N entries,
 * with no need to special-case the current credential.
 *
 * The prune keeps `KEEP` rather than `policy.reuseWindow`, because the policy can
 * be widened later: an administrator who moves the window from 3 to 10 should get
 * ten passwords' worth of history immediately, not have to wait seven changes for
 * the rule to reach full strength. `KEEP` is the settings screen's maximum, so
 * the table cannot grow past it either way.
 *
 * Failures are swallowed. Recording history is bookkeeping; the password change
 * itself has already been committed and must not be reported as failed because
 * an auxiliary insert did not land.
 */
const KEEP = 24;

export async function recordPreviousPassword(platformUserId: string, previousHash: string | null): Promise<void> {
  if (!previousHash) return;
  try {
    await prisma.passwordHistory.create({ data: { platformUserId, passwordHash: previousHash } });

    const stale = await prisma.passwordHistory.findMany({
      where: { platformUserId },
      orderBy: { createdAt: 'desc' },
      skip: KEEP,
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.passwordHistory.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }
  } catch {
    // Bookkeeping, not the transaction. See above.
  }
}

/**
 * Whether a password has aged out of the policy.
 *
 * `null` means an administrator issued this password and the account has not yet
 * replaced it — the strongest reason to force a change, and the one the
 * temporary-password gate already read. Treating it as expired here means both
 * conditions flow through one predicate rather than two nearly-identical checks
 * in the login route and the workspace layout.
 */
export function passwordExpired(passwordChangedAt: Date | null, policy: Pick<PasswordPolicy, 'maxAgeDays'>): boolean {
  if (passwordChangedAt === null) return true;
  if (!policy.maxAgeDays || policy.maxAgeDays <= 0) return false;
  return passwordChangedAt.getTime() + policy.maxAgeDays * 24 * 60 * 60 * 1000 < Date.now();
}
