/**
 * A workspace with a known-wrong `Lead.nextFollowUpAt`, and the report on it.
 *
 * The shared validation database was backfilled once by the parked prototype on
 * `claude/nextfollowup-wip`, so measuring drift there now says nothing about
 * whether this package works — the numbers were corrected by something that is
 * not in the tree. This seeds a fresh workspace whose every category is planted
 * deliberately, so the report can be checked against what was put in.
 *
 *   npx tsx --env-file=.env.test.local scripts/nfu-fixture.ts          # seed + report
 *   npx tsx --env-file=.env.test.local scripts/nfu-fixture.ts --apply  # + repair + re-report
 *   npx tsx --env-file=.env.test.local scripts/nfu-fixture.ts --clean  # remove the workspace
 *
 * Writes only to the workspace it creates, whose slug carries `nfu-fixture-`.
 * It refuses to run against a database whose name does not look disposable.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/db';
import { reportDrift, repairDrift } from '../src/services/leads/nextFollowUpReconcile';

const CORRECT = 12;
const STALE = 9;
const MISSING = 7;
const UNEXPECTED = 5;
const EMPTY = 4;
const WRONG = new Date('1999-01-01T00:00:00Z');

function assertDisposable() {
  const url = process.env.DATABASE_URL ?? '';
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  // A suffix is a safeguard against the wrong target, not proof of safety — but
  // running a seeding script against a database with neither marker is the one
  // mistake worth refusing outright.
  if (!/_nfu$|_val$|_test$/.test(name)) {
    throw new Error(`refusing to seed into "${name}": no disposable-database marker in the name`);
  }
  return name;
}

async function seed() {
  const suffix = randomBytes(4).toString('hex');
  const tenant = await prisma.tenant.create({
    data: { slug: `nfu-fixture-${suffix}`, legalName: 'NFU Fixture Ltd', displayName: 'NFU Fixture' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId,
      email: `owner-${suffix}@nfu.test`,
      fullName: 'Fixture Owner',
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const type = await prisma.taskType.create({
    data: { tenantId, key: `call-${suffix}`, name: 'Call', isActive: true },
  });

  let n = 0;
  const lead = async (label: string) =>
    (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `NFU-${suffix}-${String(++n).padStart(3, '0')}`,
          fullName: `${label} ${n}`,
          stageId: stage.id,
          ownerId: owner.id,
        },
        select: { id: true },
      })
    ).id;

  const due = (days: number) => new Date(Date.UTC(2026, 9, 1 + days, 9, 0, 0));

  // Correct: the column already equals the earliest open obligation.
  for (let i = 0; i < CORRECT; i++) {
    const id = await lead('correct');
    const d = due(i);
    await prisma.followUpTask.create({
      data: { tenantId, leadId: id, ownerId: owner.id, title: 'Call', dueAt: d, status: 'OPEN' },
    });
    await prisma.lead.update({ where: { tenantId, id }, data: { nextFollowUpAt: d } });
  }

  // Stale: an open obligation exists, the column holds a different date.
  for (let i = 0; i < STALE; i++) {
    const id = await lead('stale');
    await prisma.task.create({
      data: { tenantId, typeId: type.id, leadId: id, ownerId: owner.id, title: 'Call', dueAt: due(i), status: 'OPEN' },
    });
    await prisma.lead.update({ where: { tenantId, id }, data: { nextFollowUpAt: WRONG } });
  }

  // Missing: real work, and no overdue screen can see it.
  for (let i = 0; i < MISSING; i++) {
    const id = await lead('missing');
    await prisma.followUpTask.create({
      data: { tenantId, leadId: id, ownerId: owner.id, title: 'Call', dueAt: due(i), status: 'RESCHEDULED' },
    });
    await prisma.lead.update({ where: { tenantId, id }, data: { nextFollowUpAt: null } });
  }

  // Unexpected: the column claims something is owed; nothing open is behind it.
  // Half of them carry a closed obligation, which is the commoner cause.
  for (let i = 0; i < UNEXPECTED; i++) {
    const id = await lead('unexpected');
    if (i % 2 === 0) {
      await prisma.followUpTask.create({
        data: {
          tenantId,
          leadId: id,
          ownerId: owner.id,
          title: 'Done',
          dueAt: due(i),
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    }
    await prisma.lead.update({ where: { tenantId, id }, data: { nextFollowUpAt: WRONG } });
  }

  // Correctly empty: nothing open, nothing stored. These must not be reported.
  for (let i = 0; i < EMPTY; i++) await lead('empty');

  return { tenantId, slug: tenant.slug, leads: n };
}

function line(label: string, actual: number, expected?: number) {
  const verdict = expected === undefined ? '' : actual === expected ? '  ✓' : `  ✗ expected ${expected}`;
  return `  ${label.padEnd(24)} ${String(actual).padStart(4)}${verdict}`;
}

async function main() {
  const db = assertDisposable();
  const argv = process.argv.slice(2);

  if (argv.includes('--clean')) {
    const gone = await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'nfu-fixture-' } } });
    console.log(`removed ${gone.count} fixture workspace(s) from ${db}`);
    return;
  }

  const { tenantId, slug, leads } = await seed();
  console.log(`seeded ${leads} leads into ${slug} on ${db}\n`);

  const before = await reportDrift(tenantId);
  console.log('planted, then measured:');
  console.log(line('leads', before.leads, CORRECT + STALE + MISSING + UNEXPECTED + EMPTY));
  console.log(line('agreeing', before.agreeing, CORRECT + EMPTY));
  console.log(line('missing', before.missing, MISSING));
  console.log(line('stale', before.stale, STALE));
  console.log(line('unexpected', before.unexpected, UNEXPECTED));
  console.log(line('open tasks', before.openTasks, STALE));
  console.log(line('open follow-ups', before.openFollowUps, CORRECT + MISSING));
  console.log(line('unattached tasks', before.unattachedTasks, 0));
  console.log(line('unattached follow-ups', before.unattachedFollowUps, 0));
  console.log(line('ambiguous tasks', before.ambiguousTasks, 0));
  console.log(line('undated obligations', before.undatedObligations, 0));

  const dry = await repairDrift(tenantId, { apply: false });
  const stillWrong = await reportDrift(tenantId);
  console.log(`\ndry run: considered ${dry.considered}, repaired ${dry.repaired}`);
  console.log(
    line('disagreeing after dry run', stillWrong.missing + stillWrong.stale + stillWrong.unexpected, dry.considered),
  );

  if (!argv.includes('--apply')) {
    console.log(`\nnothing was repaired. rerun with --apply to repair. workspace: ${slug}`);
    return;
  }

  const applied = await repairDrift(tenantId, { apply: true });
  const after = await reportDrift(tenantId);
  console.log(`\napplied: considered ${applied.considered}, repaired ${applied.repaired}`);
  console.log(line('disagreeing after repair', after.missing + after.stale + after.unexpected, 0));

  const again = await repairDrift(tenantId, { apply: true });
  console.log(line('considered on rerun', again.considered, 0));
  console.log(`\nworkspace: ${slug} — remove with --clean`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
