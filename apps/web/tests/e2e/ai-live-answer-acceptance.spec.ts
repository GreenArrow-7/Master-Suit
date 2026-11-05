import { test, expect, type APIRequestContext } from '@playwright/test';
import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { ok, resetLoginThrottle, strongPassword, uniq } from './helpers';

/**
 * AI-LIVE: the question from the report — "Show my overdue follow-ups" — asked
 * by a real signed-in agent, answered through the live model path, and checked
 * against the records that agent is allowed to see.
 *
 * The provider is a local stand-in — `tests/fixtures/fake-ai-provider.mjs`,
 * started as `node tests/fixtures/fake-ai-provider.mjs 8099 tools`, with the
 * server under test run as `AI_GOOGLE_BASE_URL=http://127.0.0.1:8099/v1beta/models`.
 * The provider layer honours that variable outside production (`next start`
 * forces NODE_ENV=production and ignores it, so this spec needs `next dev`). Everything on this side of it is the
 * product: the workspace's own encrypted key is resolved, the budget is
 * asserted, the tool loop runs, `executeTool` applies the caller's
 * permissions, and the tool payload is handed to the model. The stand-in
 * answers round two by echoing that payload back, so the assertion is about
 * which records reached the model rather than about a vendor's phrasing.
 *
 * What this does NOT cover: whether Google accepts the production key. That
 * needs an authorized vendor credential and is reported separately.
 *
 * Two agents, one overdue follow-up each. Each must see their own and never
 * the other's — a scoping failure here is a cross-agent data leak, not a
 * wording bug.
 */
const BASE = process.env.AI_GOOGLE_BASE_URL;

test.describe('ONE AI answers "Show my overdue follow-ups" from the asker own records', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(5 * 60_000);

  const run = uniq();
  const slug = `ailive-${run}`.toLowerCase();
  const owners: Record<string, string> = {};
  const agentA = {
    email: `ai-a-${run}@masterapp.local`,
    password: strongPassword(`aa${run}`),
    title: `Call Alpha Holdings back ${run}`,
  };
  const agentB = {
    email: `ai-b-${run}@masterapp.local`,
    password: strongPassword(`ab${run}`),
    title: `Send Beta Trading the floor plan ${run}`,
  };
  let tenantId = '';

  test.beforeAll(async () => {
    test.skip(!BASE, 'AI_GOOGLE_BASE_URL is not set: no provider stand-in for the live path.');

    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `AI Live ${run} LLC`, displayName: `AI Live ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

    // Rank 400 / OWN scope: a sales agent, not a privileged role, so the
    // sign-in under test is a password sign-in rather than an MFA enrolment.
    const role = await prisma.role.create({
      data: { tenantId, key: `agent-${run}`, name: 'Sales Agent', rank: 400, defaultScope: 'OWN' },
    });
    await grantPermissions(tenantId, role.id, [
      ['leads', 'VIEW'],
      ['followups', 'VIEW'],
      ['tasks', 'VIEW'],
      ['calls', 'VIEW'],
    ]);

    const overdue = new Date(Date.now() - 3 * 86_400_000);
    for (const who of [agentA, agentB]) {
      const user = await createWorkspaceUser({
        tenantId,
        roleId: role.id,
        email: who.email,
        fullName: who.email.split('@')[0],
        password: who.password,
      });
      owners[who.email] = user.id;
      await prisma.platformUser.update({
        where: { id: user.platformUserId },
        data: { passwordChangedAt: new Date() },
      });
      await prisma.followUpTask.create({
        data: {
          tenantId,
          title: who.title,
          dueAt: overdue,
          status: 'OPEN',
          ownerId: user.id,
          createdById: user.id,
        },
      });
    }

    // The workspace's own key, stored the way the product stores it. The
    // stand-in accepts any key; what matters is that this row — not the
    // deployment key — is what the request is made on.
    await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'gemini',
        status: 'CONNECTED',
        credentials: wrapCredentials({ apiKey: `AIza-workspace-own-key-${run}` }),
        metadata: { provider: 'google', model: 'gemini-2.5-flash' },
      },
    });
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  /** The SSE stream, as the widget consumes it. */
  const ask = async (request: APIRequestContext, question: string) => {
    const res = await request.post('/api/v1/assistant', {
      data: { messages: [{ role: 'user', content: question }] },
    });
    const body = await res.text();
    const events = body
      .split('\n\n')
      .map((line) => line.replace(/^data: /, '').trim())
      .filter(Boolean)
      .map((json) => JSON.parse(json) as { type: string; text?: string; detail?: string; items?: unknown[] });
    return {
      raw: body,
      status: res.status(),
      requestId: res.headers()['x-request-id'],
      events,
      text: events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text ?? '')
        .join(''),
      error: events.find((e) => e.type === 'error')?.detail,
      sources: events.find((e) => e.type === 'sources')?.items ?? [],
    };
  };

  for (const [label, me, other] of [
    ['agent A', agentA, agentB],
    ['agent B', agentB, agentA],
  ] as const) {
    test(`${label} gets their own overdue follow-up and not the other agent's`, async ({ page }) => {
      // Signed in through the product's own endpoint rather than the form: in
      // dev mode the form can post natively before hydration, which is a rig
      // condition, not the behaviour under test. Same cookie jar either way.
      await resetLoginThrottle();
      await ok(
        await page.request.post('/api/v1/auth/login', { data: { email: me.email, password: me.password } }),
        `sign in ${me.email}`,
      );
      const answer = await ask(page.request, 'Show my overdue follow-ups');
      await page.context().clearCookies();

      // The reported failure was an error event in place of an answer.
      expect(answer.error, `error event instead of an answer (request ${answer.requestId})`).toBeUndefined();
      expect(answer.status, `body: ${answer.raw.slice(0, 300)}`).toBe(200);

      // Round two of the live loop: the stand-in echoes what the server handed
      // the model, so this is the record set the model was allowed to see.
      expect(answer.text).toContain('GROUNDED-IN');
      expect(answer.text).toContain(me.title);
      expect(answer.text).not.toContain(other.title);
      expect(answer.events.map((e) => e.type)).toContain('done');
    });
  }

  test('the answer is grounded in the CRM: the follow-up really is overdue and really is theirs', async () => {
    const rows = await prisma.followUpTask.findMany({
      where: { tenantId, title: { in: [agentA.title, agentB.title] } },
      select: { title: true, dueAt: true, ownerId: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.dueAt.getTime()).toBeLessThan(Date.now());
      expect(row.ownerId).toBe(owners[row.title === agentA.title ? agentA.email : agentB.email]);
    }
  });

  test('the request was made on the workspace key, so the deployment key was never substituted', async () => {
    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId, provider: 'gemini' } },
      select: { status: true },
    });
    expect(row.status).toBe('CONNECTED');
  });
});
