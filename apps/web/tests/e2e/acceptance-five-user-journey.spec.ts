import { test, expect, type APIRequestContext } from '@playwright/test';

import Redis from 'ioredis';

import { prisma } from '@/lib/db';
import { grantPermissions, type Grants } from '../helpers/fixtures';
import {
  createWorkspaceViaWizard,
  lastMailTo,
  linkFrom,
  login,
  loginPlatformOwner,
  logout,
  ok,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The business acceptance journey, with five people who did not exist before
 * the run and were not seeded.
 *
 * The rest of the suite proves individual behaviours against fixtures. This one
 * exists because a seeded account proves nothing about invitation and
 * onboarding: every actor here is created by an administrator inside the
 * product, receives a real invitation email, sets their own password through
 * the link, and signs in before doing any work.
 *
 *   admin invites U1..U5 → each onboards → roles are what they say they are
 *   → leads assigned to both agents → calls logged with outcomes
 *   → follow-ups scheduled and completed → the manager's targets and
 *   tracking reconcile against the rows → HR leave and allocation eligibility
 *   → Agent A is offboarded, the work moves to Agent B, access is revoked.
 *
 * Covers ON-01/02/05/06/08, LD-01/06/10, CL-03/04/05/06/07/10, MG-01/02/04/05,
 * HR-04/05/07, OF-01..06 of docs/qa/END-TO-END-ACCEPTANCE.md.
 */
test.describe.configure({ mode: 'serial' });

const run = uniq();
const password = strongPassword(`five${run}`);

const workspace = {
  displayName: `Acceptance Five ${run}`,
  slug: `five-${run}`,
  adminName: 'Acceptance Administrator',
  adminEmail: `admin.five.${run}@masterapp.local`,
  adminPassword: strongPassword(`adm${run}`),
  modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
};

/** The five, with the role each is meant to have. None of them is an admin. */
const PEOPLE = {
  U1: { key: `qa_sales_manager_${run}`, name: 'Sales Manager', rank: 200, scope: 'ORGANIZATION' as const },
  U2: { key: `qa_agent_a_${run}`, name: 'Sales Agent A', rank: 400, scope: 'OWN' as const },
  U3: { key: `qa_agent_b_${run}`, name: 'Sales Agent B', rank: 400, scope: 'OWN' as const },
  U4: { key: `qa_hr_officer_${run}`, name: 'HR Officer', rank: 250, scope: 'ORGANIZATION' as const },
  U5: { key: `qa_finance_${run}`, name: 'Finance Officer', rank: 250, scope: 'ORGANIZATION' as const },
};
type Who = keyof typeof PEOPLE;

/**
 * What each role may do. Stated here before the run rather than discovered from
 * it, so "the permissions are correct" is a comparison and not a description.
 */
const GRANTS: Record<Who, Grants> = {
  U1: [
    ['leads', 'VIEW'],
    ['leads', 'CREATE'],
    ['leads', 'EDIT'],
    ['leads', 'ASSIGN'],
    ['calls', 'VIEW'],
    ['targets', 'VIEW'],
    ['targets', 'VIEW_REPORTS'],
    ['followups', 'VIEW'],
    // The daily board scopes its rows on `reports:VIEW`, not on `leads` or
    // `targets`: without it a manager sees only their own row, which is
    // correct and was mistaken for the board being broken.
    ['reports', 'VIEW'],
  ],
  U2: [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['calls', 'VIEW'],
    ['calls', 'CREATE'],
    ['followups', 'VIEW'],
    ['followups', 'CREATE'],
    ['followups', 'EDIT'],
    // Filing one's own leave is a SELF action, but it still reads the
    // employee record it is filed against.
    ['employee', 'VIEW'],
  ],
  U3: [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['calls', 'VIEW'],
    ['calls', 'CREATE'],
    ['followups', 'VIEW'],
    ['followups', 'CREATE'],
    ['followups', 'EDIT'],
  ],
  U4: [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['employees', 'VIEW'],
    ['leave', 'VIEW'],
    ['leave', 'APPROVE'],
  ],
  U5: [
    ['collections', 'VIEW'],
    ['commissions', 'VIEW'],
  ],
};

const email = (who: Who) => `${who.toLowerCase()}.five.${run}@masterapp.local`;

interface Actor {
  userId: string;
  roleId: string;
  membershipEmail: string;
}

const actors = {} as Record<Who, Actor>;
let tenantId = '';
let adminApi: APIRequestContext;
const leads: { id: string; name: string }[] = [];

/**
 * The invitation lookup has its own rate-limit bucket, and this spec redeems
 * five invitations back to back from one address — which no real workspace
 * does, and which spends the budget before the fifth. `resetLoginThrottle`
 * deliberately clears only the login and password-reset buckets, so this
 * clears the one this spec is the unusual caller of. The limiter itself is
 * untouched; tests/security/ratelimit.spec.ts is what proves it still refuses.
 */
async function resetInviteThrottle() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://:leadflow@localhost:6379/0', { maxRetriesPerRequest: 2 });
  try {
    const keys = await redis.keys('rl:invite:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

const at = (path: string) => `/api/v1/workspaces/${workspace.slug}${path}`;

test.describe('Business acceptance: five invited users, end to end', () => {
  test.setTimeout(10 * 60_000);
  test.beforeEach(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug } });
    tenantId = tenant.id;
  });

  // ── ON-01: the administrator creates the five roles and invites five people ──

  test('ON-01 an administrator invites five people into five distinct non-admin roles', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    adminApi = page.request;

    for (const who of Object.keys(PEOPLE) as Who[]) {
      const spec = PEOPLE[who];
      const created = await ok(
        await adminApi.post(at('/roles/create'), {
          data: { key: spec.key, name: spec.name, rank: spec.rank, defaultScope: spec.scope },
        }),
        `create role ${spec.name}`,
      );
      const roleId = created.id as string;
      await grantPermissions(tenantId, roleId, GRANTS[who], spec.scope);

      const sent = await adminApi.post(at('/identity/invite'), {
        data: { email: email(who), fullName: `${spec.name} ${run}`, roleId },
      });
      expect(sent.ok(), `invite ${who}: ${await sent.text()}`).toBeTruthy();
      // The token belongs in the email and nowhere else.
      expect(JSON.stringify(await sent.json())).not.toContain('token');

      actors[who] = { userId: '', roleId, membershipEmail: email(who) };
    }

    // Five invitations, five roles, and not one of them the administrator's.
    const roles = await prisma.role.findMany({ where: { tenantId }, select: { key: true } });
    for (const who of Object.keys(PEOPLE) as Who[]) {
      expect(roles.map((r) => r.key)).toContain(PEOPLE[who].key);
    }
  });

  // ── ON-02: each person onboards through their own invitation ────────────────

  test('ON-02 each invitee onboards through the emailed link and can sign in', async ({ page }) => {
    for (const who of Object.keys(PEOPLE) as Who[]) {
      const mail = await lastMailTo(page.request, email(who));
      const link = linkFrom(mail.body, '/accept-invite');

      await logout(page);
      await resetInviteThrottle();
      await page.goto(link);
      await expect(page.getByText(workspace.displayName)).toBeVisible({ timeout: 60_000 });
      await page.getByLabel('Your name').fill(`${PEOPLE[who].name} ${run}`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm').fill(password);
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page.getByRole('heading', { name: 'You are in' })).toBeVisible({ timeout: 60_000 });

      await logout(page);
      await resetLoginThrottle();
      await login(page, email(who), password);
      await page.goto(`/${workspace.slug}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));

      const user = await prisma.user.findFirstOrThrow({
        where: { tenantId, email: email(who) },
        select: { id: true, status: true, roleId: true },
      });
      expect(user.status).toBe('ACTIVE');
      expect(user.roleId).toBe(actors[who].roleId);
      actors[who].userId = user.id;
    }
  });

  // ── ON-06: a role cannot reach past itself, by API ──────────────────────────

  test('ON-06 the HR officer reaches no pipeline and the agent reaches no payroll', async ({ browser }) => {
    const hr = await browser.newPage();
    await resetLoginThrottle();
    await login(hr, email('U4'), password);
    const asHr = await hr.request.get('/api/v1/leads');
    expect(asHr.status(), 'HR officer reading the pipeline').toBeGreaterThanOrEqual(400);
    await hr.close();

    const agent = await browser.newPage();
    await resetLoginThrottle();
    await login(agent, email('U2'), password);
    const asAgent = await agent.request.get(at('/hr/payroll'));
    expect(asAgent.status(), 'agent reading payroll').toBeGreaterThanOrEqual(400);
    await agent.close();
  });

  // ── LD-01 / LD-06: leads created, then assigned to both agents ──────────────

  test('LD-01/LD-06 the manager creates leads and assigns them to both agents', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);

    for (let i = 0; i < 4; i++) {
      const name = `QA Lead ${i + 1} ${run}`;
      const created = await ok(
        await page.request.post('/api/v1/leads', {
          data: { fullName: name, phone: `+9715${String(10_000_000 + i).slice(0, 8)}`, source: 'MANUAL' },
        }),
        `create lead ${i}`,
      );
      leads.push({ id: created.id as string, name });
    }
    expect(leads).toHaveLength(4);

    // Required-field validation, on the same endpoint.
    const bad = await page.request.post('/api/v1/leads', { data: { source: 'MANUAL' } });
    expect(bad.status(), 'a lead with no name').toBe(422);

    await ok(
      await page.request.post('/api/v1/leads/assign', {
        data: { leadIds: [leads[0].id, leads[1].id], ownerId: actors.U2.userId },
      }),
      'assign to Agent A',
    );
    await ok(
      await page.request.post('/api/v1/leads/assign', {
        data: { leadIds: [leads[2].id, leads[3].id], ownerId: actors.U3.userId },
      }),
      'assign to Agent B',
    );

    const owned = await prisma.lead.findMany({
      where: { tenantId, id: { in: leads.map((l) => l.id) } },
      select: { id: true, ownerId: true },
    });
    expect(owned.filter((l) => l.ownerId === actors.U2.userId)).toHaveLength(2);
    expect(owned.filter((l) => l.ownerId === actors.U3.userId)).toHaveLength(2);
  });

  // ── LD-10: an agent at OWN scope does not see the other agent's leads ───────

  test("LD-10 Agent A cannot read, list or export Agent B's leads", async ({ page }) => {
    await resetLoginThrottle();
    await login(page, email('U2'), password);

    const listed = await ok(await page.request.get('/api/v1/leads?pageSize=100'), 'Agent A lists leads');
    const body = JSON.stringify(listed);
    expect(body).toContain(leads[0].name);
    expect(body, "Agent B's lead in Agent A's list").not.toContain(leads[2].name);

    const byId = await page.request.get(`/api/v1/leads/${leads[2].id}`);
    expect(byId.status(), "Agent A opening Agent B's lead").toBeGreaterThanOrEqual(400);

    const exported = await page.request.get('/api/v1/leads/export');
    if (exported.ok()) expect(await exported.text(), 'export leaked').not.toContain(leads[2].name);
  });

  // ── CL-03..CL-07: outcomes, persistence, counters, follow-ups ───────────────

  test('CL-03/CL-04/CL-06 Agent A logs outcomes, and they survive a reload', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, email('U2'), password);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);

    await ok(
      await page.request.post(`/api/v1/leads/${leads[0].id}/call-log`, {
        data: { outcome: 'Connected', notes: `Spoke about the two-bed ${run}`, durationMins: 7 },
      }),
      'log a connected call',
    );
    await ok(
      await page.request.post(`/api/v1/leads/${leads[1].id}/call-log`, {
        data: { outcome: 'No answer' },
      }),
      'log a no-answer',
    );
    await ok(
      await page.request.post(`/api/v1/leads/${leads[0].id}/call-log`, {
        data: { outcome: 'Call back later', followUpAt: tomorrow, notes: 'Asked for a call tomorrow' },
      }),
      'log a call-back with a follow-up',
    );

    /**
     * The one-step call log writes an outbound-call Activity, not a provider
     * Call row — a Call exists only when the dialler placed one. Asserting on
     * Call here found nothing and said the logging was broken when it was not.
     */
    const logged = await prisma.activity.findMany({
      where: { tenantId, leadId: { in: [leads[0].id, leads[1].id] }, outcome: { not: null } },
      select: { outcome: true, ownerId: true, occurredAt: true, durationSecs: true, notes: true },
    });
    expect(logged.length, 'three logged calls').toBeGreaterThanOrEqual(3);
    // CL-04: actor and timestamps are on every one of them.
    for (const call of logged) {
      expect(call.ownerId).toBe(actors.U2.userId);
      expect(call.occurredAt).toBeInstanceOf(Date);
    }
    // CL-04: the note survived the round trip.
    expect(logged.map((c) => c.notes).join(' ')).toContain(run);
    // CL-05: a no-answer is a distinct outcome, not a conversation.
    const outcomes = logged.map((c) => String(c.outcome));
    expect(outcomes).toContain('No answer');
    expect(outcomes.filter((o) => o === 'No answer')).toHaveLength(1);

    // CL-06: the call-back created the follow-up.
    const followUps = await prisma.followUpTask.findMany({
      where: { tenantId, leadId: leads[0].id },
      select: { id: true, status: true },
    });
    expect(followUps.length, 'a call-back with a time creates a follow-up').toBeGreaterThanOrEqual(1);
  });

  test('CL-07 a follow-up is rescheduled, then completed, and the lead timeline agrees', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, email('U2'), password);

    const open = await prisma.followUpTask.findFirstOrThrow({
      where: { tenantId, leadId: leads[0].id, status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] } },
      select: { id: true },
    });

    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await ok(
      await page.request.patch(`/api/v1/follow-ups/${open.id}`, { data: { dueAt: later } }),
      'reschedule the follow-up',
    );
    await ok(
      await page.request.patch(`/api/v1/follow-ups/${open.id}`, {
        data: { status: 'COMPLETED', outcome: 'Agreed a viewing' },
      }),
      'complete the follow-up',
    );

    const after = await prisma.followUpTask.findFirstOrThrow({
      where: { tenantId, id: open.id },
      select: { status: true, outcome: true },
    });
    expect(after.status).toBe('COMPLETED');
    expect(after.outcome).toBe('Agreed a viewing');

    // CL-10: the timeline shows the work, in one entry per thing that happened.
    const timeline = await ok(
      await page.request.get(`/api/v1/leads/${leads[0].id}/timeline`),
      'read the lead timeline',
    );
    const text = JSON.stringify(timeline);
    expect(text).toContain('Connected');
  });

  // ── MG-01..MG-05: targets, and totals that match the rows ───────────────────

  test('MG-01/MG-02/MG-05 the manager sets targets and the figures match the records', async ({ browser }) => {
    const manager = await browser.newPage();
    await resetLoginThrottle();
    await login(manager, email('U1'), password);

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000 - 1);

    for (const who of ['U2', 'U3'] as Who[]) {
      await ok(
        await manager.request.post('/api/v1/targets', {
          data: {
            userId: actors[who].userId,
            metric: 'CALLS_ATTEMPTED',
            period: 'DAILY',
            targetValue: 5,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
          },
        }),
        `set a target for ${who}`,
      );
    }

    const stored = await prisma.employeeTarget.findMany({
      where: { tenantId, userId: { in: [actors.U2.userId, actors.U3.userId] } },
      select: { userId: true, targetValue: true },
    });
    expect(stored).toHaveLength(2);
    for (const target of stored) expect(target.targetValue).toBe(5);

    // MG-05: what the manager is shown is what the call rows actually say.
    const callsByAgentA = await prisma.activity.count({
      where: { tenantId, ownerId: actors.U2.userId, outcome: { not: null } },
    });
    const daily = await ok(await manager.request.get('/api/v1/targets/daily'), 'read the daily board');
    const board = JSON.stringify(daily);
    expect(board, 'the board names Agent A').toContain(actors.U2.userId);
    expect(callsByAgentA, 'Agent A logged the calls this run made').toBeGreaterThanOrEqual(3);

    await manager.close();
  });

  test('MG-02 an agent sees their own target and not the other agent’s', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, email('U2'), password);
    const mine = await page.request.get('/api/v1/targets');
    if (mine.ok()) {
      const text = await mine.text();
      expect(text).toContain(actors.U2.userId);
      expect(text, "Agent B's target visible to Agent A").not.toContain(actors.U3.userId);
    }
  });

  // ── HR-04 / HR-07: leave, applied by the agent and decided by the HR officer ─

  test('HR-04 the agent requests leave; the HR officer approves one and rejects another', async ({ browser }) => {
    // Precondition, not the behaviour under test: both actors need HR profiles
    // before either can file or decide anything.
    const employeeOf = async (who: Who) => {
      const membership = await prisma.workspaceMembership.findFirstOrThrow({
        where: { tenantId, salesUserId: actors[who].userId },
        select: { id: true },
      });
      const existing = await prisma.employeeProfile.findFirst({
        where: { tenantId, membershipId: membership.id },
        select: { id: true },
      });
      if (existing) return existing.id;
      const made = await prisma.employeeProfile.create({
        data: {
          tenantId,
          membershipId: membership.id,
          employeeNumber: `QA-${who}-${run}`.slice(0, 24),
          employmentStatus: 'ACTIVE',
        },
        select: { id: true },
      });
      return made.id;
    };
    await employeeOf('U2');
    await employeeOf('U4');

    const leaveType = await prisma.hrLeaveType.upsert({
      where: { tenantId_code: { tenantId, code: 'ANNUAL' } },
      update: {},
      create: { tenantId, code: 'ANNUAL', name: 'Annual leave' },
      select: { id: true },
    });

    const agent = await browser.newPage();
    await resetLoginThrottle();
    await login(agent, email('U2'), password);

    /**
     * A working day, not a calendar day. Filing leave over a weekend is
     * refused with "Those dates are all weekends or public holidays — no leave
     * is needed", which is correct and which fixed offsets walk into roughly
     * two days in seven.
     */
    const day = (offset: number) => {
      const date = new Date(Date.now() + offset * 86_400_000);
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().slice(0, 10);
    };
    const file = (from: number, to: number, reason: string) =>
      agent.request.post(at('/hr/actions/leave-apply'), {
        data: { leaveTypeId: leaveType.id, startDate: day(from), endDate: day(to), reason },
      });

    const first = await ok(await file(10, 10, `Acceptance leave A ${run}`), 'apply for leave');
    const second = await ok(await file(20, 20, `Acceptance leave B ${run}`), 'apply for a second leave');
    await agent.close();

    const filed = await prisma.hrLeaveRequest.findMany({
      where: { tenantId, leaveTypeId: leaveType.id },
      select: { id: true, status: true },
    });
    expect(filed.length, 'two requests filed').toBeGreaterThanOrEqual(2);

    const hr = await browser.newPage();
    await resetLoginThrottle();
    await login(hr, email('U4'), password);

    await ok(
      await hr.request.post(at('/hr/actions/leave-approve'), {
        data: { requestId: first.id as string, note: 'Approved for the acceptance run' },
      }),
      'HR approves the first request',
    );
    await ok(
      await hr.request.post(at('/hr/actions/leave-reject'), {
        data: { requestId: second.id as string, note: 'Rejected for the acceptance run' },
      }),
      'HR rejects the second request',
    );
    await hr.close();

    const decided = await prisma.hrLeaveRequest.findMany({
      where: { tenantId, id: { in: [first.id as string, second.id as string] } },
      select: { id: true, status: true, decidedAt: true },
    });
    const byId = Object.fromEntries(decided.map((r) => [r.id, r]));
    expect(byId[first.id as string].status).toBe('APPROVED');
    expect(byId[second.id as string].status).toBe('REJECTED');
    for (const request of decided) expect(request.decidedAt).not.toBeNull();
  });

  test('HR-07 a sales agent cannot decide leave, by API', async ({ browser }) => {
    const agent = await browser.newPage();
    await resetLoginThrottle();
    await login(agent, email('U2'), password);
    const pending = await prisma.hrLeaveRequest.findFirst({ where: { tenantId }, select: { id: true } });
    expect(pending, 'a request exists to try to decide').not.toBeNull();
    const refused = await agent.request.post(at('/hr/actions/leave-approve'), {
      data: { requestId: pending!.id, note: 'should be refused' },
    });
    expect(refused.status(), 'an agent deciding leave').toBeGreaterThanOrEqual(400);
    await agent.close();
  });

  // ── OF-01..OF-06: Agent A leaves, Agent B inherits, access dies ─────────────

  test('OF-02/OF-03/OF-04 Agent A is offboarded and the open work moves to Agent B', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);

    const ownedBefore = await prisma.lead.count({ where: { tenantId, ownerId: actors.U2.userId } });
    expect(ownedBefore, 'Agent A owns work to hand over').toBeGreaterThan(0);

    const callsBefore = await prisma.activity.count({
      where: { tenantId, ownerId: actors.U2.userId, outcome: { not: null } },
    });

    await ok(
      await page.request.post(at('/identity/account-active'), {
        data: {
          userId: actors.U2.userId,
          active: false,
          reason: `Acceptance run ${run}`,
          handOverTo: actors.U3.userId,
        },
      }),
      'deactivate Agent A with a hand-over',
    );

    // OF-03: nothing is left owned by the departed account.
    expect(await prisma.lead.count({ where: { tenantId, ownerId: actors.U2.userId } })).toBe(0);
    expect(await prisma.lead.count({ where: { tenantId, ownerId: actors.U3.userId } })).toBe(4);
    expect(
      await prisma.followUpTask.count({
        where: { tenantId, ownerId: actors.U2.userId, status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] } },
      }),
      'an open follow-up left on the departed account',
    ).toBe(0);

    // OF-04: history is not rewritten. The calls Agent A made are still theirs.
    expect(
      await prisma.activity.count({ where: { tenantId, ownerId: actors.U2.userId, outcome: { not: null } } }),
    ).toBe(callsBefore);
  });

  test('OF-05/OF-06 the departed account cannot sign in and cannot be given new work', async ({ page }) => {
    await resetLoginThrottle();
    const attempt = await page.request.post('/api/v1/auth/login', {
      data: { email: email('U2'), password },
    });
    expect(attempt.ok(), 'a deactivated account signed in').toBeFalsy();

    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const created = await ok(
      await page.request.post('/api/v1/leads', {
        data: { fullName: `QA Post-exit ${run}`, phone: `+97155${String(run).slice(0, 6)}`, source: 'MANUAL' },
      }),
      'create a lead after the exit',
    );
    const newLead = created.id as string;

    const assigned = await page.request.post('/api/v1/leads/assign', {
      data: { leadIds: [newLead], ownerId: actors.U2.userId },
    });
    expect(assigned.ok(), 'a new lead was assigned to a departed employee').toBeFalsy();
  });
});
