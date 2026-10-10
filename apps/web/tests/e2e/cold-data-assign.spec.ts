import { test, expect } from '@playwright/test';
import { login, ok, resetLoginThrottle, uniq } from './helpers';

/**
 * Cold data: two promises of phase 3 the screen did not keep.
 *
 * A single record could be handed to an agent only through the API — the
 * screen offered a whole list, never a row. And Make lead on a number that
 * already belongs to another agent's lead attached the touch (correctly) and
 * then opened that lead, which the seller cannot see: a 404, with the record
 * already marked converted and its row link pointing at the same 404.
 *
 * The administrator (organisation-wide) and a seller at OWN scope share one
 * list; the seller's own records are untouched by the fix.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = uniq();

test.describe('cold data: a record to an agent, and Make lead on somebody else’s lead', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(5 * 60_000);

  test('a row is handed over, and Make lead never opens a lead the seller cannot see', async ({ browser }) => {
    const api = (p: string) => `${base()}${p}`;
    const at = (path: string) => `/${slug}${path}`;
    const adminCtx = await browser.newContext({ baseURL: base() });
    const admin = adminCtx.request;
    await ok(await admin.post(api('/api/v1/auth/login'), { data: { email, password } }), 'admin login');

    // A seller at OWN scope, built through the matrix as record-scope.spec.ts does.
    const created = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/roles/create`), {
        data: { key: `cold_${run}`, name: `Cold seller ${run}`, rank: 60 },
      }),
      'create role',
    );
    const matrix = await ok(
      await admin.get(api(`/api/v1/workspaces/${slug}/roles/matrix?roleId=${created.id}`)),
      'matrix',
    );
    const actions = new Set(['VIEW', 'CREATE', 'EDIT']);
    await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/roles/matrix-update`), {
        data: {
          roleId: created.id,
          changes: (matrix.permissions as { permissionId: string; module: string; action: string }[])
            .filter((perm) => perm.module === 'leads' && actions.has(perm.action))
            .map((perm) => ({ permissionId: perm.permissionId, granted: true, scope: 'OWN' })),
        },
      }),
      'grant at OWN scope',
    );
    const seller = {
      name: `Cold Seller ${run}`,
      email: `cold-seller-${run}@example.com`,
      password: `Cold-${run}-Aa1xxxx`,
      id: '',
    };
    const account = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
        data: {
          fullName: seller.name,
          employeeNumber: `CS-${run}`,
          email: seller.email,
          roleId: created.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: false,
        },
      }),
      'create seller',
    );
    seller.id = account.userId;
    const sellerApi = await browser.newContext({ baseURL: base() });
    await ok(
      await sellerApi.request.post(api('/api/v1/auth/login'), {
        data: { email: seller.email, password: account.temporaryPassword },
      }),
      'seller first login',
    );
    await ok(
      await sellerApi.request.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
        data: { currentPassword: account.temporaryPassword, newPassword: seller.password },
      }),
      'seller password',
    );
    await sellerApi.close();

    // The administrator's lead, and a list holding its number plus a fresh contact.
    const stamp = Date.now().toString().slice(-8);
    const phone = `+9715${stamp}`;
    const lead = await ok(
      await admin.post(api('/api/v1/leads'), { data: { fullName: `Cold Match ${run}`, phone } }),
      'admin lead',
    );
    const list = `Cold ${run}`;
    const imported = await ok(
      await admin.post(api('/api/v1/cold-data/import'), {
        data: {
          fileName: `${list}.xlsx`,
          rows: [
            { line: 2, values: { fullName: `Cold A ${run}`, phone } },
            {
              line: 3,
              values: {
                fullName: `Cold B ${run}`,
                phone: `+9715${(Number(stamp) + 1).toString().padStart(8, '0')}`,
                notes: `Called twice ${run}`,
              },
            },
          ],
        },
      }),
      'import',
    );
    expect(imported.created, 'both rows landed').toBe(2);
    const listUrl = (status?: string) =>
      at(`/sales/cold-data?list=${encodeURIComponent(list)}${status ? `&status=${status}` : ''}`);

    const adminUi = await browser.newContext({ baseURL: base() });
    const sellerUi = await browser.newContext({ baseURL: base() });
    const adminPage = await adminUi.newPage();
    const sellerPage = await sellerUi.newPage();
    try {
      await test.step('the administrator hands one record to the seller from its row', async () => {
        await login(adminPage, email, password);
        await adminPage.goto(listUrl());
        const row = adminPage.getByRole('row', { name: `Cold B ${run}` });
        await expect(row.getByText(`Called twice ${run}`)).toBeHidden();
        await row.getByText('Notes', { exact: true }).click();
        await expect(row.getByText(`Called twice ${run}`)).toBeVisible();
        await row.getByRole('combobox', { name: 'Agent' }).selectOption({ label: seller.name });
        await expect(row.getByRole('status')).toHaveText(`Handed to ${seller.name}.`);
        await adminPage.reload();
        const again = adminPage.getByRole('row', { name: `Cold B ${run}` });
        await expect(again.getByRole('combobox', { name: 'Agent' })).toHaveValue(seller.id);
        await expect(again.getByRole('alert')).toHaveCount(0);
      });

      await test.step('Make lead on a number that is another agent’s lead stays on the page and says so', async () => {
        await ok(
          await admin.post(api('/api/v1/cold-data/assign'), { data: { batch: list, ownerId: seller.id } }),
          'assign',
        );
        await login(sellerPage, seller.email, seller.password);
        await sellerPage.goto(listUrl());
        const row = sellerPage.getByRole('row', { name: `Cold A ${run}` });
        await row.getByRole('button', { name: 'Make lead' }).click();
        await expect(row.getByRole('status')).toHaveText(
          'Already a lead you cannot open; the enquiry was added to it.',
        );
        await expect(sellerPage).toHaveURL(/\/sales\/cold-data/);

        await sellerPage.goto(listUrl('CONVERTED'));
        const converted = sellerPage.getByRole('row', { name: `Cold A ${run}` });
        await expect(converted).toContainText('Converted — the lead is not yours to open');
        await expect(converted.getByRole('link', { name: /open the lead/ })).toHaveCount(0);
      });

      await test.step('the lead is not found for the seller by URL or API, and the administrator’s to open', async () => {
        // The page streams, so its status is 200 either way; what matters is what is shown.
        await sellerPage.goto(at(`/sales/leads/${lead.id}`));
        await expect(sellerPage.getByRole('heading', { name: 'We couldn’t find that' })).toBeVisible();
        await expect(sellerPage.getByText(`Cold Match ${run}`)).toHaveCount(0);
        expect((await sellerPage.request.get(api(`/api/v1/leads/${lead.id}`))).status()).toBe(404);
        expect((await adminPage.goto(at(`/sales/leads/${lead.id}`)))!.status()).toBe(200);
        await expect(adminPage.getByText(`Cold Match ${run}`).first()).toBeVisible();
        // And the administrator keeps the link on the converted row.
        await adminPage.goto(listUrl('CONVERTED'));
        await expect(
          adminPage.getByRole('row', { name: `Cold A ${run}` }).getByRole('link', { name: /open the lead/ }),
        ).toBeVisible();
      });
    } finally {
      await adminUi.close();
      await sellerUi.close();
      await adminCtx.close();
    }
  });
});
