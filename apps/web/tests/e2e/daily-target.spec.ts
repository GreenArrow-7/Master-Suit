import { test, expect } from '@playwright/test';
import { login, resetLoginThrottle } from './helpers';

/**
 * Daily lead target, end to end: the manager sets a seller's "leads to call
 * today" on the leadership board, leads are assigned, the seller completes
 * calls with outcomes, and the board and the seller's drill-down count the
 * day from those calls without anyone typing a number. Runs on the demo
 * workspace; skips without it.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);

async function ok(res: { ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }, what: string) {
  expect(res.ok(), `${what}: ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()) as Record<string, any>;
}

test.describe('Daily lead target', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(4 * 60_000);

  test('manager assigns → seller calls → board and drill-down count the day', async ({ browser, page }) => {
    const api = (p: string) => `${base()}${p}`;
    const adminCtx = await browser.newContext({ baseURL: base() });
    const admin = adminCtx.request;
    await ok(await admin.post(api('/api/v1/auth/login'), { data: { email, password } }), 'admin login');
    const roles = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/roles/roles`)), 'roles');
    const rep = ((roles.data ?? roles) as { id: string; key: string }[]).find((r) => r.key === 'sales_rep');
    expect(rep, 'seeded sales_rep role').toBeTruthy();

    const sellerEmail = `daily-${run}@example.com`;
    const sellerName = `Daily Seller ${run}`;
    const account = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
        data: {
          fullName: sellerName,
          employeeNumber: `DT-${run}`,
          email: sellerEmail,
          roleId: rep!.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: false,
        },
      }),
      'create seller',
    );
    const sellerCtx = await browser.newContext({ baseURL: base() });
    const seller = sellerCtx.request;
    await ok(
      await seller.post(api('/api/v1/auth/login'), {
        data: { email: sellerEmail, password: account.temporaryPassword },
      }),
      'seller login',
    );
    await ok(
      await seller.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
        data: { currentPassword: account.temporaryPassword, newPassword: `Daily-${run}-Aa1xxxx` },
      }),
      'seller password change',
    );

    try {
      // Manager: three leads on the seller's desk and a target of four for today.
      const leadIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const lead = await ok(
          await admin.post(api('/api/v1/leads'), {
            data: { fullName: `Daily Lead ${run}-${i}`, phone: `+9715${(Date.now() + i).toString().slice(-8)}` },
          }),
          'create lead',
        );
        leadIds.push(lead.id);
      }
      await ok(
        await admin.post(api('/api/v1/leads/assign'), { data: { leadIds, ownerId: account.userId } }),
        'assign leads',
      );

      await login(page, email, password);
      await page.goto(`/${slug}/sales/leadership?view=daily`);
      const row = page.getByRole('row', { name: new RegExp(sellerName) });
      await expect(row).toBeVisible();
      await expect(row.getByText('no target')).toBeVisible();
      await row.getByLabel('Leads to call today').fill('4');
      await row.getByRole('button', { name: 'Assign' }).click();
      await expect(row.getByText('0%')).toBeVisible();

      // Seller: two leads called (one twice), one interested, one not.
      const complete = async (leadId: string, outcome: string, durationSecs: number) => {
        const call = await ok(
          await seller.post(api('/api/v1/calls'), { data: { leadId, recipientNumber: '+971501234567' } }),
          'create call',
        );
        await ok(
          await seller.patch(api(`/api/v1/calls/${call.id}`), { data: { status: 'COMPLETED', outcome, durationSecs } }),
          'complete call',
        );
        return call.id as string;
      };
      await complete(leadIds[0]!, 'NO_ANSWER', 0);
      await complete(leadIds[0]!, 'INTERESTED', 240);
      await complete(leadIds[1]!, 'NOT_INTERESTED', 60);

      // The API counts the same day the page will.
      const board = await ok(await admin.get(api('/api/v1/targets/daily')), 'daily board');
      const mine = (board.rows as Record<string, unknown>[]).find((r) => r.userId === account.userId);
      expect(mine).toMatchObject({
        target: 4,
        leadsAssigned: 3,
        leadsCalled: 2,
        callsCompleted: 3,
        connected: 2,
        notAnswered: 1,
        cold: 1,
        interested: 1,
        pending: 2,
        completion: 50,
        totalDurationSecs: 300,
      });

      // Board: the row is behind, the name opens the day.
      await page.reload();
      await expect(row.getByText('50%')).toBeVisible();
      await expect(row).toHaveAttribute('data-behind', '');
      await row.getByRole('link', { name: sellerName }).click();
      await expect(page).toHaveURL(new RegExp(`/sales/leadership/daily/${account.userId}`));
      await expect(page.getByText('2 of 4 leads called')).toBeVisible();
      const calls = page.getByRole('table').getByRole('row');
      await expect(calls).toHaveCount(4); // header + 3 calls
      await expect(page.getByRole('cell', { name: /Interested/ }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: `Daily Lead ${run}-0` }).first()).toBeVisible();

      // Another seller's day is not the manager's to see without scope, and a stranger is a 404.
      const nobody = await admin.get(api('/api/v1/targets/daily/cxxxxxxxxxxxxxxxxxxxxxxxx'));
      expect(nobody.status()).toBe(404);
    } finally {
      await sellerCtx.close();
      await adminCtx.close();
    }
  });
});
