import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login, resetLoginThrottle } from './helpers';

/**
 * The YOUHAN ONE business journey, end to end, on the demo workspace with the
 * development mock telephony/transcription providers and a running worker:
 *
 *   admin creates a role and an employee with a work location
 *   → supervised biometric consent → face enrolment attempted (needs a real face)
 *   → leads imported from a spreadsheet and assigned to the rep
 *   → rep sees the work-gated check-out count → places calls → transcript
 *   → analysis → audit → lead touched → productivity and value views show it
 *   → deal won → check-out count falls.
 *
 * Skipped unless E2E_DEMO_SLUG/EMAIL/PASSWORD name a seeded workspace admin.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);

async function ok(res: { ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }, what: string) {
  expect(res.ok(), `${what}: ${await res.text().catch(() => '')}`).toBeTruthy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as Record<string, any>;
}

async function poll<T>(fn: () => Promise<T | null>, label: string, timeoutMs = 90_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${label} did not complete within ${timeoutMs / 1000}s`);
}

test.describe('YOUHAN ONE business journey', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(10 * 60_000);

  test('admin → role → employee → consent → leads → calls → AI → productivity → gate → deal → value', async ({
    page,
    browser,
  }) => {
    // ── Company Admin ──────────────────────────────────────────────────────
    await login(page, email, password);
    const admin = page.request;
    const api = (p: string) => `${base()}${p}`;

    // Clone the seeded sales rep role: it already holds the working permissions.
    const roles = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/roles/roles`)), 'roles');
    const source = ((roles.data ?? roles) as { id: string; key: string }[]).find((r) => r.key === 'sales_rep');
    expect(source, 'seeded sales_rep role').toBeTruthy();
    const role = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/roles/clone`), {
        data: { sourceRoleId: source!.id, key: `journey_rep_${run}`, name: `Journey Rep ${run}`, rank: 60 },
      }),
      'clone role',
    );

    const location = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/hr/work-locations`), {
        data: { name: `Journey HQ ${run}`, latitude: 25.2048, longitude: 55.2708, radiusMeters: 200 },
      }),
      'work location',
    );

    const repEmail = `journey-rep-${run}@example.com`;
    const account = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
        data: {
          fullName: `Journey Rep ${run}`,
          employeeNumber: `JR-${run}`,
          email: repEmail,
          phone: '+971500009999',
          roleId: role.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: true,
          workLocationId: location.id,
        },
      }),
      'create staff account',
    );
    expect(account.temporaryPassword).toBeTruthy();

    const employees = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/hr/employees`)), 'employees');
    const employee = (
      (employees.data ?? employees.items ?? employees) as { id: string; employeeNumber: string }[]
    ).find((e: { employeeNumber: string }) => e.employeeNumber === `JR-${run}`);
    expect(employee, 'employee record exists').toBeTruthy();

    // ── §3 supervised consent, then enrolment is attempted ────────────────
    const consent = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/hr/actions/consent-grant-supervised`), {
        data: { employeeId: employee!.id, signature: `Journey Rep ${run}` },
      }),
      'supervised consent',
    );
    expect(consent.recordedById).toBeTruthy();
    // A frame with no face is refused by the engine, not silently enrolled.
    const noFace = await admin.post(api(`/api/v1/workspaces/${slug}/hr/actions/face-enrol`), {
      data: {
        employeeId: employee!.id,
        frames: [
          'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        ],
      },
    });
    expect([409, 422, 503]).toContain(noFace.status());

    // ── §6 import and assign ───────────────────────────────────────────────
    await page.goto(`/${slug}/sales/leads`);
    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByLabel('Spreadsheet file').setInputFiles(path.join(__dirname, 'fixtures', 'leads-sample.xlsx'));
    await expect(page.getByLabel('Import "Name" as')).toHaveValue('fullName');
    await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();
    await expect(page.getByText(/^\d+ leads? created\.$/)).toBeVisible({ timeout: 60_000 });

    const imported = await ok(
      await admin.get(api('/api/v1/leads?q=Omar%20Farouk&includeClosedOut=true')),
      'imported leads',
    );
    const leadIds: string[] = (imported.data as { id: string }[]).map((l) => l.id).slice(0, 5);
    const more = await ok(await admin.get(api('/api/v1/leads?limit=10')), 'more leads');
    for (const l of more.data as { id: string }[])
      if (!leadIds.includes(l.id) && leadIds.length < 5) leadIds.push(l.id);
    expect(leadIds.length).toBeGreaterThanOrEqual(3);
    await ok(
      await admin.post(api('/api/v1/leads/assign'), { data: { leadIds, ownerId: account.userId } }),
      'assign leads',
    );

    // ── Employee ───────────────────────────────────────────────────────────
    const repCtx = await browser.newContext({ baseURL: base() });
    const rep = repCtx.request;
    await ok(
      await rep.post(api('/api/v1/auth/login'), { data: { email: repEmail, password: account.temporaryPassword } }),
      'rep login',
    );
    const newPassword = `Journey-${run}-Aa1xxxx`;
    await ok(
      await rep.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
        data: { currentPassword: account.temporaryPassword, newPassword },
      }),
      'rep password change',
    );

    // §5: the gate counts the untouched leads before any work.
    const pre1 = await ok(
      await rep.post(api(`/api/v1/workspaces/${slug}/hr/self/attendance-preflight`), {
        data: { action: 'CHECK_OUT', latitude: 25.2048, longitude: 55.2708, gpsAccuracyM: 8 },
      }),
      'preflight before work',
    );
    expect(pre1.pendingWork).toBe(leadIds.length);

    // §10: a call against the first lead through the mock vendor.
    const call = await ok(
      await rep.post(api('/api/v1/calls'), { data: { leadId: leadIds[0], recipientNumber: '+971501234567' } }),
      'create call',
    );
    const dial = await rep.post(api(`/api/v1/calls/${call.id}/dial`), { data: { agentNumber: '+971500009999' } });
    expect(dial.status(), await dial.text()).toBe(200);
    await ok(
      await rep.post(api(`/api/v1/calls/${call.id}/consent`), { data: { consentGiven: true, method: 'VERBAL' } }),
      'consent',
    );
    await ok(
      await rep.post(api(`/api/v1/calls/${call.id}/transcript`), {
        data: {
          content:
            'Agent: Good morning, is now a good time? Customer: A few minutes. Agent: What are you looking for and what budget? Customer: A two bedroom near the schools, but honestly it sounds too expensive for us. Agent: I understand — there is a payment plan on the off-plan tower. Customer: Is there? What is the booking amount? Agent: Shall we book a viewing this week, Thursday or Saturday?',
        },
      }),
      'transcript',
    );
    await ok(
      await rep.patch(api(`/api/v1/calls/${call.id}`), { data: { status: 'COMPLETED', outcome: 'INTERESTED' } }),
      'complete call',
    );

    // §11: analysis and audit run on the worker; neither may pretend to be a model.
    const analysis = await poll(async () => {
      const r = await rep.get(api(`/api/v1/calls/${call.id}/analysis`));
      if (!r.ok()) return null;
      const a = (await r.json()) as {
        status: string;
        modelId: string | null;
        objections: string[];
        sentiment: string | null;
      };
      return a.status === 'COMPLETED' ? a : null;
    }, 'analysis');
    expect(analysis.modelId).toBeTruthy();
    expect(Array.isArray(analysis.objections)).toBeTruthy();
    const audit = await poll(
      async () => {
        const r = await rep.get(api(`/api/v1/calls/${call.id}/audit`));
        if (!r.ok()) return null;
        const a = (await r.json()) as { data?: { status?: string; modelId?: string | null }[] | null };
        const latest = a.data?.[0];
        return latest && latest.status === 'COMPLETED' ? latest : null;
      },
      'audit',
      120_000,
    ).catch(() => null);

    // §5 again: one lead worked, the count falls by one.
    const pre2 = await ok(
      await rep.post(api(`/api/v1/workspaces/${slug}/hr/self/attendance-preflight`), {
        data: { action: 'CHECK_OUT', latitude: 25.2048, longitude: 55.2708, gpsAccuracyM: 8 },
      }),
      'preflight after one call',
    );
    expect(pre2.pendingWork).toBe(leadIds.length - 1);

    // §7: the rep cannot delete, but can close out.
    const del = await rep.delete(api(`/api/v1/leads/${leadIds[1]}`));
    expect(del.status()).toBe(403);
    await ok(
      await rep.post(api(`/api/v1/leads/${leadIds[1]}/close-out`), { data: { status: 'INVALID' } }),
      'close out',
    );

    // ── Management sees it ────────────────────────────────────────────────
    await page.goto(`/${slug}/sales/leadership?view=productivity&period=30d&rep=${account.userId}`);
    const row = page.locator('table.lf-grid tbody tr', { hasText: `Journey Rep ${run}` });
    await expect(row).toBeVisible();
    await expect(row.locator('td[data-label="Calls"]')).toHaveText('1');
    await expect(row.locator('td[data-label="Contacted"]')).toHaveText('1');

    // Deal: an opportunity from the worked lead, won.
    const opp = await ok(
      await admin.post(api('/api/v1/opportunities'), {
        data: { name: `Journey deal ${run}`, leadId: leadIds[0], amount: 1200000, ownerId: account.userId },
      }),
      'opportunity',
    );
    await ok(await admin.patch(api(`/api/v1/opportunities/${opp.id}`), { data: { status: 'WON' } }), 'win');

    await page.goto(`/${slug}/sales/leadership?view=value&period=30d`);
    await expect(
      page.locator('.lf-kpi', { has: page.locator('.lf-kpi__label', { hasText: /^Deals won$/ }) }),
    ).toContainText(/[1-9]/);
    await expect(
      page.locator('.lf-kpi', { has: page.locator('.lf-kpi__label', { hasText: /^Leads imported$/ }) }),
    ).toContainText(/[1-9]/);

    await repCtx.close();
    // §11/§15: an audit says what scored it — a keyword pass is never presented as a model.
    expect(audit!.modelId).toBeTruthy();
    test.info().annotations.push({ type: 'audit', description: `audit scored by ${audit!.modelId}` });
  });
});
