/**
 * The end-to-end teardown removes the roles its own run created, and nothing
 * else.
 *
 * Three specs used to leave one role per run inside the shared demo workspace,
 * which is how "Journey Rep mu8vfn6x" and friends reached a Role picker
 * somebody uses. The fix tags what the suite creates with `RUN_TAG` and deletes
 * on that tag — deliberately **not** on "looks like a test", which would
 * eventually take a real role with it.
 *
 * This holds that line. The predicate is the one `globalTeardown.ts` runs; the
 * roles beside it are the ones a brokerage actually has, including two whose
 * names contain the words a looser rule would have matched.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

const suffix = randomBytes(4).toString('hex');
const slug = `teardownmatch-${suffix}`;
/** The same shape the config mints: `e2e` plus a base-36 clock reading. */
const RUN_TAG = `e2e${Date.now().toString(36)}`;

let tenantId = '';

const KEEP = [
  'org_admin',
  'sales_director',
  'branch_manager',
  'team_manager',
  'sales_rep',
  // Named to look like the thing a looser rule would delete. They are real.
  'qa_reviewer',
  'test_drive_coordinator',
];

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Teardown LLC', displayName: 'Teardown', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  await prisma.role.createMany({
    data: [
      ...KEEP.map((key, i) => ({ tenantId, key, name: key, rank: 20 + i })),
      { tenantId, key: `journey-rep-${RUN_TAG}`, name: 'Journey Rep', rank: 90 },
      { tenantId, key: `scope-probe-${RUN_TAG}`, name: 'Scope probe', rank: 91 },
    ],
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('globalTeardown role matching', () => {
  it('deletes the run-tagged roles and keeps every real one', async () => {
    // The predicate from tests/e2e/globalTeardown.ts, narrowed to this tenant
    // so the assertion cannot be confused by anything else in the database.
    const removed = await prisma.role.deleteMany({ where: { tenantId, key: { contains: RUN_TAG } } });
    expect(removed.count).toBe(2);

    const left = await prisma.role.findMany({ where: { tenantId }, select: { key: true } });
    expect(left.map((role) => role.key).sort()).toEqual([...KEEP].sort());
  });
});
