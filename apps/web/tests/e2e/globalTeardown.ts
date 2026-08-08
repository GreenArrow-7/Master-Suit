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
export default async function teardown() {
  if (process.env.E2E_KEEP_DATA === 'true') {
    console.log(`[teardown] E2E_KEEP_DATA=true — leaving workspaces tagged ${RUN_TAG} in place.`);
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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
