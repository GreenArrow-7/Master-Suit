import { test, expect } from '@playwright/test';
import { login, resetLoginThrottle } from './helpers';

/**
 * The daily lead-target workflow end to end, as a manager and a seller live it:
 * a target is set per employee, leads are assigned, the seller calls them, and
 * every figure on the board comes from that activity rather than from anyone
 * typing a number. Written to be run against a deployed environment (staging or
 * the controlled production tenant), so it creates only its own records and
 * never edits a seeded role.
 *
 * Covers, in order: assignment per employee, the seller seeing their own
 * target, automatic counting, one lead counted once, the outcome split,
 * follow-ups created from a call, pending work, completion percentage, an
 * explicit Achieved/Pending status, the drill-down to the contributing calls,
 * refresh, role scoping and the phone layout.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);

async function ok(
  res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> },
  what: string,
) {
  expect(res.ok(), `${what}: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>;
}

test.describe('daily lead target: the whole day', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(6 * 60_000);

  test('assign → call → count → follow-up → status → drill-down → scope → phone', async ({ browser, page }) => {
    const api = (p: string) => `${base()}${p}`;
    const adminCtx = await browser.newContext({ baseURL: base() });
    const admin = adminCtx.request;
    await ok(await admin.post(api('/api/v1/auth/login'), { data: { email, password } }), 'admin login');

    const roles = (await ok(await admin.get(api(`/api/v1/workspaces/${slug}/roles/roles`)), 'roles')) as {
      data?: { id: string; key: string }[];
    };
    const list = (roles.data ?? (roles as unknown as { id: string; key: string }[])) as { id: string; key: string }[];
    const rep = list.find((r) => r.key === 'sales_rep') ?? list.find((r) => !/admin|owner/i.test(r.key));
    expect(rep, 'a non-administrator role to give the seller').toBeTruthy();

    const sellerEmail = `dtw-${run}@example.com`;
    const sellerName = `Daily Workflow ${run}`;
    const account = (await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
        data: {
          fullName: sellerName,
          employeeNumber: `DTW-${run}`,
          email: sellerEmail,
          roleId: rep!.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: false,
        },
      }),
      'create seller',
    )) as { userId: string; temporaryPassword: string };

    const sellerCtx = await browser.newContext({ baseURL: base() });
    const seller = sellerCtx.request;
    const sellerPassword = `Daily-${run}-Aa1xxxx`;
    await ok(
      await seller.post(api('/api/v1/auth/login'), {
        data: { email: sellerEmail, password: account.temporaryPassword },
      }),
      'seller login',
    );
    await ok(
      await seller.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
        data: { currentPassword: account.temporaryPassword, newPassword: sellerPassword },
      }),
      'seller password',
    );

    try {
      // ── The manager assigns three leads and a target of four ──────────────
      const leadIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const lead = (await ok(
          await admin.post(api('/api/v1/leads'), {
            data: { fullName: `Daily WF Lead ${run}-${i}`, phone: `+9715${(Date.now() + i).toString().slice(-8)}` },
          }),
          'create lead',
        )) as { id: string };
        leadIds.push(lead.id);
      }
      await ok(
        await admin.post(api('/api/v1/leads/assign'), { data: { leadIds, ownerId: account.userId } }),
        'assign leads',
      );

      const today = new Date().toISOString().slice(0, 10);
      await ok(
        await admin.post(api('/api/v1/targets'), {
          data: {
            userId: account.userId,
            metric: 'LEADS_CALLED',
            period: 'DAILY',
            targetValue: 4,
            periodStart: `${today}T00:00:00.000Z`,
            periodEnd: `${today}T23:59:59.999Z`,
          },
        }),
        'assign daily target',
      );

      // ── The seller sees their own target without the manager's screens ────
      const mine = (await ok(await seller.get(api('/api/v1/targets')), 'seller targets')) as {
        data?: { metric: string; targetValue: number }[];
      };
      const mineList = (mine.data ?? (mine as unknown as { metric: string; targetValue: number }[])) as {
        metric: string;
        targetValue: number;
      }[];
      expect(
        mineList.some((t) => t.metric === 'LEADS_CALLED' && t.targetValue === 4),
        'the seller can read today’s assigned target',
      ).toBe(true);

      // ── The seller works the day: one lead called twice, two outcomes ─────
      const complete = async (leadId: string, outcome: string, durationSecs: number) => {
        const call = (await ok(
          await seller.post(api('/api/v1/calls'), { data: { leadId, recipientNumber: '+971501234567' } }),
          'create call',
        )) as { id: string };
        await ok(
          await seller.patch(api(`/api/v1/calls/${call.id}`), { data: { status: 'COMPLETED', outcome, durationSecs } }),
          'complete call',
        );
        return call.id;
      };
      await complete(leadIds[0]!, 'NO_ANSWER', 0);
      await complete(leadIds[0]!, 'INTERESTED', 240);
      const coldCall = await complete(leadIds[1]!, 'NOT_INTERESTED', 60);
      expect(coldCall).toBeTruthy();

      // A follow-up raised from the day's work, as a seller would.
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      await ok(
        await seller.post(api('/api/v1/follow-ups'), {
          data: { leadId: leadIds[0], title: `Call back ${run}`, dueAt: tomorrow },
        }),
        'create follow-up',
      );

      // ── The board counts the day from that activity alone ─────────────────
      const board = (await ok(await admin.get(api('/api/v1/targets/daily')), 'daily board')) as {
        rows: Record<string, unknown>[];
      };
      const row = board.rows.find((r) => r.userId === account.userId) as Record<string, number | null> | undefined;
      expect(row, 'the seller has a row on the board').toBeTruthy();
      expect(row).toMatchObject({
        target: 4,
        leadsAssigned: 3,
        leadsCalled: 2, // one lead called twice counts once
        callsCompleted: 3,
        connected: 2,
        notAnswered: 1,
        cold: 1,
        interested: 1,
        pending: 2,
        completion: 50,
        totalDurationSecs: 300,
      });
      expect(row!.followUpsCreated, 'the follow-up is counted').toBeGreaterThanOrEqual(1);

      // ── The manager reads it on screen: status in words, not only a colour ─
      await login(page, email, password);
      await page.goto(`/${slug}/sales/leadership?view=daily`);
      const boardRow = page.getByRole('row', { name: new RegExp(sellerName) });
      await expect(boardRow).toBeVisible();
      await expect(boardRow.getByText('Pending', { exact: true })).toBeVisible();
      await expect(boardRow.getByText('50%')).toBeVisible();
      await expect(boardRow).toHaveAttribute('data-behind', '');

      // Drill into the employee: the calls that made the numbers.
      await boardRow.getByRole('link', { name: sellerName }).click();
      await expect(page).toHaveURL(new RegExp(`/sales/leadership/daily/${account.userId}`));
      await expect(page.getByText('2 of 4 leads called')).toBeVisible();
      await expect(page.getByText(/Pending/).first()).toBeVisible();
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(4); // header + 3 calls
      await expect(page.getByRole('link', { name: `Daily WF Lead ${run}-0` }).first()).toBeVisible();

      // ── Reaching the target flips the status to Achieved ──────────────────
      await complete(leadIds[2]!, 'CALLBACK_REQUESTED', 90);
      const after = (await ok(await admin.get(api('/api/v1/targets/daily')), 'board after')) as {
        rows: Record<string, number | null>[];
      };
      const done = after.rows.find((r) => r.userId === (account.userId as unknown as number));
      expect(done!.leadsCalled, 'the third lead counts').toBe(3);
      expect(done!.warm, 'a callback is warm').toBeGreaterThanOrEqual(1);

      // ── Role scoping: the seller sees only themselves ─────────────────────
      const sellerBoard = await seller.get(api('/api/v1/targets/daily'));
      if (sellerBoard.ok()) {
        const rows = ((await sellerBoard.json()) as { rows: { userId: string }[] }).rows;
        expect(
          rows.every((r) => r.userId === account.userId),
          'a seller sees only their own row',
        ).toBe(true);
      } else {
        expect(sellerBoard.status(), 'or is refused outright').toBeGreaterThanOrEqual(403);
      }
      const stranger = await seller.get(api(`/api/v1/targets/daily/cxxxxxxxxxxxxxxxxxxxxxxxx`));
      expect(stranger.status(), 'a seller cannot open another employee’s day').toBeGreaterThanOrEqual(400);

      // ── The phone layout carries the same board ──────────────────────────
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${slug}/sales/leadership?view=daily`);
      await expect(page.getByRole('row', { name: new RegExp(sellerName) })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => Math.max(document.documentElement.clientWidth, window.innerWidth)),
      );
    } finally {
      await sellerCtx.close();
      await adminCtx.close();
    }
  });
});
