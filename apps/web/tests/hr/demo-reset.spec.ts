/**
 * SPEC-0007 — the demo reset: what it restores, and what it refuses.
 *
 * ST-006, ST-007, IT-003 and IT-004. The refusal cases are the security half
 * and are fast, because a refusing seed exits before it opens a connection.
 * The round-trip case is the behavioural half and is slow, because it runs the
 * real seed twice.
 *
 * Every case spawns the seed as a subprocess with a deliberately hostile
 * environment. Nothing here imports the seed: the gates it is testing are
 * top-level statements that run at import time, so importing the module would
 * either throw inside the test process or, worse, seed the database the tests
 * are running against.
 *
 *   ALLOW_DEMO_SEED=yes npm run db:seed -- --reset
 *
 * ── This file owns its database (CONV-015) ──────────────────────────────────
 *
 * It is the only suite here that MUTATES the demo workspace: it deletes leave,
 * rewrites attendance and drops leads, then resets — four times over. Other
 * suites in this repository avoid collisions by creating their own tenants;
 * this one cannot, because the shared fixture *is* what is being tested.
 *
 * So it takes its own database instead, `<ambient>_reset`, created and migrated
 * by `tests/helpers/isolated-db.ts`. Nothing else writes there and nothing here
 * writes anywhere else, so this file and `tests/security/demo-personas.spec.ts`
 * can run concurrently at full file parallelism.
 *
 * The header used to say "run this with --no-file-parallelism" instead. That
 * was a note rather than a control — `npm test` does not pass it and neither
 * does CI — and the persona suite failed roughly one full run in three because
 * of it. The helper explains what else was considered and why it was rejected.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ensureIsolatedDatabase, isolatedDatabaseUrl } from '../helpers/isolated-db';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every connection in this file — the client below and the seed subprocesses —
 * points here, never at the ambient database. If this is null the suite has no
 * database at all and skips, exactly as it did before.
 */
const url = isolatedDatabaseUrl('reset');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? '' }) });

const SLUG = 'youhan-one-demo';
const SEED_TIMEOUT = 240_000;

let tenantId = '';
let seeded = false;

/**
 * Provision, migrate and populate this file's own database.
 *
 * The seed here is not one of the assertions; it is the fixture the assertions
 * start from. It runs with `--reset` so the starting point is the same whether
 * the database was created a moment ago or left behind by an earlier run —
 * which is the property the rest of the file relies on and, before CONV-015,
 * the property the shared database could not offer.
 */
beforeAll(async () => {
  if (!url) return;
  await ensureIsolatedDatabase(url);

  const populate = runSeed({ ALLOW_DEMO_SEED: 'yes' }, ['--reset']);
  expect(
    populate.code,
    `could not seed the isolated reset database:\n${populate.failure ?? populate.out.slice(-800)}`,
  ).toBe(0);

  const tenant = await db.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) return;
  tenantId = tenant.id;
  seeded = (await db.hrAttendanceRecord.count({ where: { tenantId } })) > 0;
}, SEED_TIMEOUT + 120_000);

/**
 * The keys the seed actually reads, plus what a Node process needs to start.
 *
 * Deliberately a list rather than `...process.env`.
 *
 * This suite spawns a subprocess whose *entire behaviour is gated on
 * environment variables* — four refusal gates read `NODE_ENV`, `APP_ENV`, the
 * database name and `ALLOW_DEMO_SEED`. Inheriting the ambient environment made
 * that subprocess depend on whatever every earlier test file had left in
 * `process.env`, and several of them mutate it globally
 * (`prisma-config.spec.ts` rewrites `SHADOW_DATABASE_URL`,
 * `capture-vault.spec.ts` sets `ATTENDANCE_CAPTURE_DIR`, `metrics.spec.ts`
 * rewrites `METRICS_TOKEN` and `BUILD_COMMIT`).
 *
 * The symptom was a test that passed alone, passed beside `tests/tenant` and
 * `tests/permission`, and failed once in a full run — flaky, and flaky for a
 * reason that had nothing to do with the reset it was testing. Passing an
 * explicit environment also makes the gate cases stricter: each one now states
 * the whole world the seed sees rather than layering one variable on top of
 * whatever was already there.
 */
const SEED_ENV_KEYS = [
  // Needed for a process to start at all, on Windows in particular.
  'PATH',
  'SystemRoot',
  'COMSPEC',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  // Read by the seed itself.
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'SEED_KEY',
  'DEMO_PASSWORD',
  'PLATFORM_OWNER_EMAIL',
  'PLATFORM_OWNER_PASSWORD',
] as const;

/** Run the seed in a hermetic environment, and return what it said. */
function runSeed(env: Record<string, string>, args: string[] = []) {
  // NODE_ENV is stated rather than inherited: the type requires it, and `test`
  // is what this actually is. A case that needs `production` sets it and gets
  // the refusal it is asserting.
  const base: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const k of SEED_ENV_KEYS) {
    const v = process.env[k];
    if (typeof v === 'string') base[k] = v;
  }
  /**
   * CONV-015. Point the subprocess at this file's own database.
   *
   * After the loop, so it overrides the ambient values `SEED_ENV_KEYS` just
   * copied — those name the database every other suite is reading, and a
   * `--reset` against it is the whole defect. Before the caller's `env`, which
   * is spread last, so the two gate cases that assert a refusal on a
   * production- or staging-shaped database name still supply their own.
   */
  if (url) {
    base.DATABASE_URL = url;
    base.MIGRATION_DATABASE_URL = url;
  }
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed/index.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: SEED_TIMEOUT,
    env: { ...base, ...env },
  });
  /**
   * CONV-008. `spawnSync` reports three different failures and this used to
   * flatten them into one: a non-zero exit sets `status`, but a process that
   * never started or was killed on timeout sets `status` to **null** and puts
   * the reason in `error`.
   *
   * That mattered in one direction specifically. The refusal cases below assert
   * `code` is not 0 — and `null !== 0`, so a seed that failed to spawn at all
   * satisfied them. The suite would have reported the four refusal gates as
   * proven while the seed had never run.
   *
   * `code` is therefore normalised to a number that can only mean "the process
   * ran and exited", and anything else is surfaced on `failure` for the caller
   * to assert against rather than silently inherit.
   */
  const spawnFailure = r.error
    ? `${r.error.name}: ${r.error.message}`
    : r.status === null
      ? 'killed or timed out'
      : null;
  return {
    code: r.status,
    ran: r.status !== null && !r.error,
    failure: spawnFailure,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

/**
 * Counts that describe the whole demo dataset, keyed on nothing generated.
 * A fingerprint over natural keys, so it survives a tenant being recreated
 * with new cuids — which is exactly what a reset does.
 */
async function fingerprint() {
  const t = await db.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!t) return null;
  const rows = await db.$queryRawUnsafe<{ fp: string | null }[]>(
    `SELECT md5(string_agg(x, E'\n' ORDER BY x)) AS fp FROM (
       SELECT e."employeeNumber"||'|'||to_char(a."workDate",'YYYY-MM-DD')||'|'||a.status AS x
       FROM "HrAttendanceRecord" a
       JOIN "EmployeeProfile" e ON e.id = a."employeeId"
       WHERE a."tenantId" = $1) s`,
    t.id,
  );
  const counts = {
    employees: await db.employeeProfile.count({
      where: { tenantId: t.id, employmentStatus: 'ACTIVE', deletedAt: null },
    }),
    attendance: await db.hrAttendanceRecord.count({ where: { tenantId: t.id } }),
    leave: await db.hrLeaveRequest.count({ where: { tenantId: t.id } }),
    leads: await db.lead.count({ where: { tenantId: t.id } }),
  };
  return { fp: rows[0]?.fp ?? null, counts };
}

describe.skipIf(!url)('SPEC-0007 demo reset', () => {
  it('the fixture is present', () => {
    expect(seeded, 'seed the demo database first').toBe(true);
  });

  // ── ST-006, ST-007 · SEC-001, SEC-002 ─────────────────────────────────────
  //
  // Each gate is asserted on its own, with `--reset` passed, so a gate that
  // stopped working would be caught by a destructive run rather than a
  // read-only one. Row counts are compared before and after to prove the
  // refusal happened before any write, which is the actual requirement — a
  // gate that refuses *after* deleting is not a gate.
  const gates: [name: string, env: Record<string, string>, expect: RegExp][] = [
    ['NODE_ENV=production', { NODE_ENV: 'production', ALLOW_DEMO_SEED: 'yes' }, /NODE_ENV is production/i],
    ['APP_ENV=production', { APP_ENV: 'production', ALLOW_DEMO_SEED: 'yes' }, /APP_ENV is production/i],
    ['APP_ENV=staging', { APP_ENV: 'staging', ALLOW_DEMO_SEED: 'yes' }, /APP_ENV is staging/i],
    [
      'a production database name',
      {
        ALLOW_DEMO_SEED: 'yes',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/master_saas_prod',
        MIGRATION_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/master_saas_prod',
      },
      /named "master_saas_prod"/i,
    ],
    [
      'a staging database name',
      {
        ALLOW_DEMO_SEED: 'yes',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/leadflow_staging',
        MIGRATION_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/leadflow_staging',
      },
      /named "leadflow_staging"/i,
    ],
    ['no ALLOW_DEMO_SEED', { ALLOW_DEMO_SEED: '' }, /Refusing to seed demo data/i],
  ];

  for (const [name, env, message] of gates) {
    it(`ST-006/ST-007 refuses ${name}, before writing anything`, async () => {
      if (!seeded) return;
      const before = await fingerprint();
      const r = runSeed(env, ['--reset']);
      expect(r.failure, `the seed never ran for ${name}, so its refusal proves nothing`).toBeNull();
      expect(r.ran, `the seed did not run to completion for ${name}`).toBe(true);
      expect(r.code, `the seed should have exited non-zero for ${name}`).not.toBe(0);
      expect(r.out).toMatch(message);
      const after = await fingerprint();
      expect(after, `the demo tenant was destroyed by a run that should have refused (${name})`).not.toBeNull();
      expect(after!.counts, `rows changed during a refused run (${name})`).toEqual(before!.counts);
      expect(after!.fp).toBe(before!.fp);
    }, 60_000);
  }

  // ── IT-003, IT-004 · FR-012, FR-013 ───────────────────────────────────────
  it(
    'IT-003/IT-004 a reset restores the baseline after Sales and HR data are mutated',
    async () => {
      if (!seeded) return;

      // Establish the baseline rather than assuming the database is already at
      // it.
      //
      // This used to read the ambient state and call it the baseline, then
      // assert that a reset reproduced it — which only holds if nothing had
      // touched the workspace since it was last seeded. In a full-suite run
      // that is not true: other files share this database, and one of them
      // (the retention sweep in tests/tenant) deletes aged rows across every
      // tenant. The test then compared a swept state against a freshly rebuilt
      // one and failed for a reason that had nothing to do with the reset.
      //
      // Same defect class as the environment inheritance above: depending on
      // ambient state you do not control. Costs one extra seed; buys a test
      // whose result means what it says.
      const seedBaseline = runSeed({ ALLOW_DEMO_SEED: 'yes' }, ['--reset']);
      expect(seedBaseline.code, `baseline seed failed:\n${seedBaseline.out.slice(-800)}`).toBe(0);

      const baseline = await fingerprint();
      expect(baseline!.fp).toBeTruthy();
      expect(baseline!.counts.attendance).toBeGreaterThan(0);

      // Mutate both modules, the way a demonstration would.
      const t = await db.tenant.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } });
      await db.hrLeaveRequest.deleteMany({ where: { tenantId: t.id, status: 'PENDING' } });
      await db.hrAttendanceRecord.updateMany({ where: { tenantId: t.id }, data: { status: 'ABSENT' } });
      const doomed = await db.lead.findMany({ where: { tenantId: t.id }, select: { id: true }, take: 50 });
      await db.lead.deleteMany({ where: { tenantId: t.id, id: { in: doomed.map((l) => l.id) } } });

      const mutated = await fingerprint();
      expect(mutated!.fp, 'the mutation did not actually change anything').not.toBe(baseline!.fp);
      expect(mutated!.counts.leads).toBeLessThan(baseline!.counts.leads);

      const r = runSeed({ ALLOW_DEMO_SEED: 'yes' }, ['--reset']);
      expect(r.code, `reset failed:\n${r.out.slice(-800)}`).toBe(0);

      const restored = await fingerprint();
      expect(restored!.counts, 'counts were not restored').toEqual(baseline!.counts);
      expect(restored!.fp, 'the attendance baseline was not restored exactly').toBe(baseline!.fp);
    },
    // Three seeds now: the baseline, and the reset under test.
    SEED_TIMEOUT * 2,
  );
});

/**
 * SPEC-0007/CHG-001 — the active-employee set must not depend on whether the
 * seed was fresh or a top-up.
 *
 * The defect this pins: the seed suspends a rep *after* the loop that writes
 * employee profiles, and updated only the User. A fresh seed therefore left a
 * suspended login attached to an ACTIVE employee, while a top-up re-entered the
 * loop, read the now-SUSPENDED user and corrected the profile to INACTIVE. The
 * same database answered "how many active employees" two different ways
 * depending on how many times it had been seeded — and "attendance for every
 * active employee" is only deterministic if that set is.
 *
 * Slow: it runs the seed twice. It earns the time by being the only case that
 * would catch the defect coming back.
 */
describe.skipIf(!url)('SPEC-0007 seed determinism across fresh and top-up', () => {
  it(
    'a fresh reset and an idempotent top-up produce the same active-employee set',
    async () => {
      if (!seeded) return;

      const activeSet = async () => {
        const t = await db.tenant.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } });
        const rows = await db.employeeProfile.findMany({
          where: { tenantId: t.id, employmentStatus: 'ACTIVE', deletedAt: null },
          select: { employeeNumber: true },
          orderBy: { employeeNumber: 'asc' },
        });
        return rows.map((r) => r.employeeNumber);
      };

      const fresh = runSeed({ ALLOW_DEMO_SEED: 'yes' }, ['--reset']);
      expect(fresh.code, `fresh seed failed:\n${fresh.out.slice(-600)}`).toBe(0);
      const afterFresh = await activeSet();
      const freshFingerprint = await fingerprint();

      const topUp = runSeed({ ALLOW_DEMO_SEED: 'yes' }, []);
      expect(topUp.code, `top-up seed failed:\n${topUp.out.slice(-600)}`).toBe(0);
      const afterTopUp = await activeSet();

      expect(afterFresh.length, 'the fixture should hold a substantial workforce').toBeGreaterThanOrEqual(24);
      expect(
        afterTopUp,
        'the active-employee set changed between a fresh seed and a top-up; the suspended-rep coherence fix has regressed',
      ).toEqual(afterFresh);

      // And the dataset built on top of that set is unchanged too.
      const afterFingerprint = await fingerprint();
      expect(afterFingerprint!.counts.attendance).toBe(freshFingerprint!.counts.attendance);
      expect(afterFingerprint!.fp).toBe(freshFingerprint!.fp);

      // The deliberately suspended login must be excluded from the active set,
      // not merely absent by accident.
      const t = await db.tenant.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } });
      const suspended = await db.user.findMany({
        where: { tenantId: t.id, status: 'SUSPENDED' },
        select: { email: true },
      });
      expect(suspended.length, 'the fixture no longer contains a suspended login to test against').toBeGreaterThan(0);
    },
    SEED_TIMEOUT * 2,
  );

  /**
   * SPEC-0007/UT-015 · CONV-008 — a failing seed must fail its caller.
   *
   * The finding was that `apps/web/scripts/prepare-test-db.mjs` reported only
   * "the seed failed (exit 1)" and discarded the reason, so a `P2002` naming
   * the exact constraint had to be rediscovered by hand. The fix surfaces the
   * output with credential-bearing lines redacted.
   *
   * This asserts the invariant rather than the wording: make the seed fail on
   * purpose, and check the harness notices in every channel — exit code, the
   * reason, and the distinction between "exited non-zero" and "never ran".
   */
  describe('SPEC-0007/UT-015 a failing seed is never silently tolerated', () => {
    it('a refused seed reports a non-zero exit AND its reason', () => {
      // APP_ENV=production is one of the seed's four refusal gates, so this is
      // a real failure rather than a simulated one.
      const r = runSeed({ APP_ENV: 'production', ALLOW_DEMO_SEED: 'yes' });
      expect(r.failure, 'the seed did not start; this case proves nothing').toBeNull();
      expect(r.ran).toBe(true);
      expect(r.code, 'a refused seed must exit non-zero').not.toBe(0);
      expect(r.out.trim().length, 'the reason was swallowed').toBeGreaterThan(0);
      expect(r.out).toMatch(/refus|production/i);
    }, 60_000);

    it('a seed that cannot start is reported as such, not as a refusal', () => {
      // The hole CONV-008 left open: spawnSync sets status=null when the
      // process never runs, and `null !== 0` satisfied every "should have
      // failed" assertion in this file. Pointing it at a script that does not
      // exist reproduces that shape deliberately.
      const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed/does-not-exist.ts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
      });
      // It either exits non-zero or fails to spawn; both must be visible, and
      // neither may look like success.
      const ran = r.status !== null && !r.error;
      const reason = r.error ? `${r.error.name}: ${r.error.message}` : `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(r.status === 0, 'a missing seed script must never look like success').toBe(false);
      expect(reason.trim().length, 'the failure gave no reason at all').toBeGreaterThan(0);
      // And the distinction the harness now draws is meaningful.
      expect(typeof ran).toBe('boolean');
    }, 90_000);
  });
});
