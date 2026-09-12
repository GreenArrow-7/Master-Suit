/**
 * Booking confirmation against the release artifact, through its HTTP API.
 *
 * There is no booking page, so this is not a browser journey and does not
 * pretend to be one. It is the thing the service tests cannot say: that the
 * *built* application — `NODE_ENV=production`, behind TLS, with a real
 * session — refuses the double-sale, refuses a unitless confirmation, and
 * moves inventory with the sale. Runs against whatever `APP_URL` points at.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const workspace = {
  displayName: `Booking API ${run}`,
  slug: `bka-${run}`.toLowerCase(),
  adminName: `Booking Admin ${run}`,
  adminEmail: `bka-admin-${run}@masterapp.local`,
  adminPassword: strongPassword(`bka${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};

let projectId = '';
let unitA = '';
let unitB = '';
let leadId = '';

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const response = await request.post(`/api/v1/${path}`, { data });
  expect(response.status(), `${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}
const confirm = (request: APIRequestContext, bookingId: string) =>
  request.patch('/api/v1/bookings', { data: { action: 'CONFIRM', bookingId } });

async function unitStatus(request: APIRequestContext, unitId: string) {
  const res = await request.get(`/api/v1/projects/${projectId}/units?limit=50`);
  expect(res.ok()).toBeTruthy();
  const row = ((await res.json()).data as { id: string; status: string }[]).find((u) => u.id === unitId);
  expect(row, `unit ${unitId} is listed`).toBeTruthy();
  return row!.status;
}

test.describe('Booking confirmation on the release artifact', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace, a project with two units, and a buyer exist', async ({ page }) => {
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);

    const project = await post(page.request, 'projects', { name: `Tower ${run}`, code: `T-${run}`.slice(0, 40) });
    projectId = project.id ?? project.data?.id;
    expect(projectId).toBeTruthy();

    await post(page.request, `projects/${projectId}/units`, {
      fromFloor: 1,
      toFloor: 1,
      unitsPerFloor: 2,
      price: 1_000_000,
    });
    const listed = await page.request.get(`/api/v1/projects/${projectId}/units?limit=50`);
    const units = (await listed.json()).data as { id: string; status: string }[];
    expect(units).toHaveLength(2);
    [unitA, unitB] = units.map((u) => u.id);
    expect(units.every((u) => u.status === 'AVAILABLE')).toBe(true);

    const lead = await post(page.request, 'leads', {
      fullName: `Buyer ${run}`,
      phone: `+9715${Date.now().toString().slice(-8)}`,
    });
    leadId = lead.id ?? lead.data?.id;
    expect(leadId).toBeTruthy();
  });

  test('two drafts on one unit, confirmed together: exactly one sale, one refusal, the flat booked', async ({
    page,
  }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const body = (v: number) => ({
      leadId,
      projectId,
      unitInventoryId: unitA,
      saleValue: v,
      bookingDate: new Date().toISOString(),
    });
    const first = (await post(page.request, 'bookings', body(1_000_000))).id as string;
    const second = (await post(page.request, 'bookings', body(1_000_001))).id as string;

    // Two HTTP requests in flight at once against the built server — two
    // connections, two transactions, one unit.
    const [a, b] = await Promise.all([confirm(page.request, first), confirm(page.request, second)]);
    const statuses = [a.status(), b.status()];
    expect(
      statuses.filter((s) => s < 300),
      `statuses ${statuses}`,
    ).toHaveLength(1);
    const loser = [a, b].find((r) => r.status() >= 300)!;
    expect(loser.status(), await loser.text()).toBeGreaterThanOrEqual(400);
    expect(loser.status(), await loser.text()).toBeLessThan(500);
    expect((await loser.json()).detail ?? (await loser.json()).title).toMatch(/booked|unit|confirmed/i);

    expect(await unitStatus(page.request, unitA)).toBe('BOOKED');
  });

  test('a draft that names no unit cannot be confirmed', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const draft = (
      await post(page.request, 'bookings', {
        leadId,
        projectId,
        saleValue: 500_000,
        bookingDate: new Date().toISOString(),
      })
    ).id as string;

    const res = await confirm(page.request, draft);
    expect(res.status(), await res.text()).toBe(422);
    expect(await res.text()).toMatch(/unit/i);
  });

  test('confirming against a sold flat is refused and moves nothing', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);

    // Sell unit B the proper way, then try to sell it again.
    const sale = (
      await post(page.request, 'bookings', {
        leadId,
        projectId,
        unitInventoryId: unitB,
        saleValue: 900_000,
        bookingDate: new Date().toISOString(),
      })
    ).id as string;
    expect((await confirm(page.request, sale)).status()).toBeLessThan(300);
    expect(await unitStatus(page.request, unitB)).toBe('BOOKED');

    const again = (
      await post(page.request, 'bookings', {
        leadId,
        projectId,
        unitInventoryId: unitB,
        saleValue: 950_000,
        bookingDate: new Date().toISOString(),
      })
    ).id as string;
    const res = await confirm(page.request, again);
    expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(await unitStatus(page.request, unitB)).toBe('BOOKED');

    // And cancelling the real sale puts the flat back.
    const cancelled = await page.request.patch('/api/v1/bookings', {
      data: { action: 'CANCEL', bookingId: sale, reason: 'Client withdrew' },
    });
    expect(cancelled.status(), await cancelled.text()).toBeLessThan(300);
    expect(await unitStatus(page.request, unitB)).toBe('AVAILABLE');
  });
});
