/**
 * Agent and manager, looking at the same lead, on the production serving path.
 *
 * Seeds a small workspace where the difference is visible rather than asserted:
 * one lead carries an overdue obligation owned by a *different* rep, so the
 * manager must see it and the agent must not. Then signs each of them in and
 * photographs the same screen.
 *
 * No password is handled or printed. Sessions are minted the way the test
 * fixtures do — a real `PlatformSession` row — and the cookie stays inside this
 * process.
 *
 *   npx tsx --env-file=.env scripts/nfu-screens.ts            # seed, shoot, keep
 *   npx tsx --env-file=.env scripts/nfu-screens.ts --clean     # remove the workspace
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import { createSessionToken } from '../tests/helpers/session';
import { repairDrift } from '../src/services/leads/nextFollowUpReconcile';

// The standalone artifact under NODE_ENV=production, behind the TLS
// terminator — the session cookie is `secure` in production, so plain HTTP
// cannot authenticate and evidence taken over it would be evidence of nothing.
const BASE = process.env.SCREENS_BASE_URL ?? 'https://127.0.0.1:3443';
const OUT = path.resolve(__dirname, '../../../validation-evidence/next-follow-up');
const DESKTOP = { width: 1440, height: 960 };
const MOBILE = { width: 390, height: 844 };

async function seed() {
  const suffix = randomBytes(3).toString('hex');
  const slug = `nfu-demo-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Next Follow-up Demo', displayName: 'Follow-up Demo' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const team = await prisma.team.create({ data: { tenantId, name: 'Team One', code: `T1-${suffix}` } });
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true, category: 'OPEN' },
  });
  const type = await prisma.taskType.create({
    data: { tenantId, key: `call-${suffix}`, name: 'Call', isActive: true },
  });

  /** A role holding `leads` and `tasks` at one scope. */
  async function role(key: string, scope: 'OWN' | 'TEAM', rank: number) {
    const r = await prisma.role.create({
      data: { tenantId, key: `${key}-${suffix}`, name: key, rank, defaultScope: scope },
    });
    for (const permissionModule of ['leads', 'tasks'] as const) {
      for (const action of ['VIEW', 'CREATE', 'EDIT'] as const) {
        const permission = await prisma.permission.upsert({
          where: { module_action: { module: permissionModule, action } },
          update: {},
          create: { module: permissionModule, action },
        });
        await prisma.rolePermission.create({
          data: { tenantId, roleId: r.id, permissionId: permission.id, granted: true, scope },
        });
      }
    }
    return r;
  }

  const repRole = await role('rep', 'OWN', 60);
  const managerRole = await role('manager', 'TEAM', 40);

  async function person(name: string, roleId: string, isManager = false) {
    const platformUser = await prisma.platformUser.create({
      data: {
        email: `${name}-${suffix}@demo.test`,
        normalizedEmail: `${name}-${suffix}@demo.test`,
        fullName: name,
        status: 'ACTIVE',
        /**
         * Without this the workspace layout redirects to "set your own
         * password" — a null `passwordChangedAt` means the account is still on
         * an administrator-issued password. These accounts never had one: the
         * session is minted directly, so the flag is stamped rather than
         * worked around, and the guard is left exactly as it is.
         */
        passwordChangedAt: new Date(),
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email: `${name}-${suffix}@demo.test`, fullName: name, roleId, status: 'ACTIVE' },
    });
    await prisma.workspaceMembership.create({
      data: {
        tenantId,
        platformUserId: platformUser.id,
        salesUserId: user.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await prisma.userTeam.create({ data: { tenantId, userId: user.id, teamId: team.id, isManager } });
    return user;
  }

  const agent = await person('Priya Nair', repRole.id);
  const colleague = await person('Omar Haddad', repRole.id);
  const manager = await person('Sara Mensah', managerRole.id, true);

  const now = Date.now();
  const day = 86_400_000;
  let n = 0;
  async function lead(fullName: string, company: string) {
    return prisma.lead.create({
      data: {
        tenantId,
        reference: `FD-${suffix}-${String(++n).padStart(3, '0')}`,
        fullName,
        company,
        stageId: stage.id,
        ownerId: agent.id,
        score: 40 + n * 7,
        phone: `+9715000000${n}`,
        email: `${fullName.split(' ')[0]!.toLowerCase()}@example.test`,
      },
      select: { id: true },
    });
  }

  // 1 — the agent's own obligation, overdue. Both views show it.
  const a = await lead('Hassan Kaddoura', 'Gulf Stone');
  await prisma.task.create({
    data: {
      tenantId,
      typeId: type.id,
      leadId: a.id,
      ownerId: agent.id,
      title: 'Call back',
      dueAt: new Date(now - 3 * day),
    },
  });

  // 2 — the point of the split: overdue, owned by a colleague. The manager
  //     sees a date; the agent sees that it is not theirs, and no date.
  const b = await lead('Layla Farouk', 'Marina Holdings');
  await prisma.task.create({
    data: {
      tenantId,
      typeId: type.id,
      leadId: b.id,
      ownerId: colleague.id,
      title: 'Contract review',
      dueAt: new Date(now - 5 * day),
    },
  });

  // 3 — the agent's own, still to come.
  const c = await lead('Tariq Aziz', 'Aziz & Sons');
  await prisma.followUpTask.create({
    data: { tenantId, leadId: c.id, ownerId: agent.id, title: 'Send brochure', dueAt: new Date(now + 4 * day) },
  });

  // 4 — nothing scheduled by anyone. Not overdue; not fine either.
  await lead('Noor Rahman', 'Rahman Trading');

  // 5 — both stores on one lead, the follow-up earlier than the task.
  const e = await lead('Yusuf Demir', 'Demir Group');
  await prisma.task.create({
    data: {
      tenantId,
      typeId: type.id,
      leadId: e.id,
      ownerId: agent.id,
      title: 'Site visit',
      dueAt: new Date(now + 9 * day),
    },
  });
  await prisma.followUpTask.create({
    data: { tenantId, leadId: e.id, ownerId: agent.id, title: 'Confirm time', dueAt: new Date(now + 2 * day) },
  });

  /**
   * Reconcile, exactly as step 3 of the rollout does.
   *
   * These rows were created directly, so the stored column is null everywhere.
   * The *dates* on screen do not need it — they are derived per request — but
   * one thing does: telling "no next action scheduled" apart from "somebody
   * else is handling this" reads the stored aggregate as a boolean. Until the
   * column is reconciled that distinction degrades to "No next action", which
   * is safe and under-informative rather than wrong. Running the repair here
   * is what a deployed workspace would have already done.
   */
  await repairDrift(tenantId, { apply: true });

  return {
    tenantId,
    slug,
    agentCookie: await createSessionToken(tenantId, agent.id),
    managerCookie: await createSessionToken(tenantId, manager.id),
  };
}

async function shoot(browser: Browser, cookie: string, slug: string, who: string) {
  const context = await browser.newContext({ viewport: DESKTOP, ignoreHTTPSErrors: true });
  const value = cookie.split('=')[1]!.split(';')[0]!;
  await context.addCookies([
    { name: SESSION_COOKIE, value, domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
  const page: Page = await context.newPage();

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });

  const url = `${BASE}/${slug}/sales/leads`;
  const res = await page.goto(url, { waitUntil: 'networkidle' });
  if (!res || res.status() >= 400) problems.push(`${who}: ${url} returned ${res?.status()}`);
  if (page.url().includes('/login')) problems.push(`${who}: bounced to /login`);

  await page.screenshot({ path: path.join(OUT, `leads-${who}-desktop.png`), fullPage: false });

  // What the follow-up column actually says, as text, for the report.
  const cells = await page
    .locator('.lf-table tbody tr, .lf-grid tbody tr, table tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) => Array.from(r.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim())),
    )
    .catch(() => [] as string[][]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) problems.push(`${who}: ${overflow}px horizontal overflow at ${DESKTOP.width}px`);

  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `leads-${who}-mobile.png`), fullPage: false });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (mobileOverflow > 0) problems.push(`${who}: ${mobileOverflow}px horizontal overflow at ${MOBILE.width}px`);

  await context.close();
  return { problems, cells, overflow, mobileOverflow };
}

async function main() {
  if (process.argv.includes('--clean')) {
    const gone = await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'nfu-demo-' } } });
    console.log(`removed ${gone.count} demo workspace(s)`);
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const { slug, agentCookie, managerCookie } = await seed();
  console.log(`seeded workspace ${slug}\n`);

  const browser = await chromium.launch();
  try {
    const agent = await shoot(browser, agentCookie, slug, 'agent');
    const manager = await shoot(browser, managerCookie, slug, 'manager');

    const show = (label: string, r: Awaited<ReturnType<typeof shoot>>) => {
      console.log(`${label}: ${r.cells.length} rows, overflow ${r.overflow}px desktop / ${r.mobileOverflow}px mobile`);
      for (const row of r.cells) {
        const name = row[1] ?? row[0] ?? '?';
        console.log(`   ${name.padEnd(28)} ${row.join(' | ')}`);
      }
      for (const p of r.problems) console.log(`   ! ${p}`);
      console.log('');
    };
    show('agent  (leads OWN, tasks OWN)', agent);
    show('manager (leads TEAM, tasks TEAM)', manager);

    const problems = [...agent.problems, ...manager.problems];
    console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems found');
    console.log(`\nscreenshots in ${OUT}`);
    console.log(`workspace ${slug} — remove with --clean`);
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
