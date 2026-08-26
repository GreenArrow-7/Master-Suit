import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { RUN_TAG } from './run-tag';

/**
 * Removes the workspaces this run created, and nothing else.
 *
 * Each run creates six or so workspaces and used to leave every one behind: a
 * development database had accumulated 106 of them, which slows the platform
 * workspace list and makes a real customer hard to spot among the debris.
 *
 * Scoped by `RUN_TAG`, a marker unique to this process. Deleting by a looser
 * pattern — anything that looks generated, anything recent — would eventually
 * delete something real, and a test suite must not be able to do that.
 *
 * Runs after passing *and* failing runs, because Playwright always calls
 * globalTeardown. A failed run is exactly when the leftovers matter least and
 * accumulate fastest.
 */
/**
 * Gives the platform owner's own authenticator back.
 *
 * `ensureOwnerAuthenticator` borrows the account so the suite can compute its
 * own TOTP codes, parking whatever was there in a file first. Without this the
 * borrow is permanent: on a developer machine the codes in somebody's phone
 * stop working after every run, and the only way back is re-enrolling by hand.
 *
 * Runs before the workspace cleanup and outside its early return, so an
 * operator who passes E2E_KEEP_DATA to inspect leftovers still gets their
 * authenticator back.
 */
async function restoreOwnerAuthenticator(prisma: PrismaClient) {
  const backup = path.join(process.cwd(), '.e2e-owner-mfa.json');
  if (!existsSync(backup)) return;
  try {
    const saved = JSON.parse(readFileSync(backup, 'utf8')) as {
      email: string;
      mfaSecret: string | null;
      mfaEnabled: boolean;
      passwordChangedAt: string | null;
    };
    await prisma.platformUser.update({
      where: { email: saved.email },
      data: {
        mfaSecret: saved.mfaSecret,
        mfaEnabled: saved.mfaEnabled,
        passwordChangedAt: saved.passwordChangedAt ? new Date(saved.passwordChangedAt) : null,
      },
    });
    console.log(`[teardown] restored the platform owner's authenticator (${saved.email}).`);
  } catch (error) {
    // Loud, because the operator's sign-in depends on it and a silent failure
    // looks exactly like the bug this exists to prevent.
    console.error(`[teardown] COULD NOT restore the owner authenticator: ${(error as Error).message}`);
    console.error('[teardown] re-enrol with: node scripts/owner-mfa.mjs --enroll');
    return; // Keep the file so it can be retried or read by hand.
  }
  unlinkSync(backup);
}

export default async function teardown() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  // First, and before the E2E_KEEP_DATA return: keeping the workspaces around
  // to inspect them is no reason to leave somebody unable to sign in.
  await restoreOwnerAuthenticator(prisma);

  if (process.env.E2E_KEEP_DATA === 'true') {
    console.log(`[teardown] E2E_KEEP_DATA=true — leaving workspaces tagged ${RUN_TAG} in place.`);
    await prisma.$disconnect();
    return;
  }

  try {
    // Tenant deletion cascades to users, roles, memberships, leads and the rest.
    const { count } = await prisma.tenant.deleteMany({ where: { slug: { endsWith: RUN_TAG } } });

    // The platform users the specs invented are not tenant-scoped, so the
    // cascade does not reach them.
    const { count: identities } = await prisma.platformUser.deleteMany({
      where: { email: { contains: RUN_TAG } },
    });

    console.log(`[teardown] removed ${count} workspace(s) and ${identities} account(s) tagged ${RUN_TAG}.`);
  } catch (error) {
    // A teardown failure must not turn a green run red — it is reported and the
    // leftovers are named so they can be removed by hand.
    console.warn(`[teardown] could not clean up ${RUN_TAG}: ${(error as Error).message}`);
  } finally {
    await prisma.$disconnect();
  }
}
