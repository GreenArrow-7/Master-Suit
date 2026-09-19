import { test, expect } from '@playwright/test';
import { resetLoginThrottle } from './helpers';

/**
 * §8/§9 the AI-assisted call as a seller starts it: Lead → "Call with AI
 * assistance" → the new-call form already holds the lead → the live workspace
 * says exactly what the connected provider can do → consent is affirmed and
 * recorded → the provider places the call (rings the seller's phone first) →
 * the screen is watching the vendor leg. A seller with no phone on file gets
 * the reason and the plain-handset fallback instead of a stranded call.
 *
 * Runs on the demo workspace with the development mock vendor (which cannot
 * stream), so what is asserted is the honest fallback wording, not guidance.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);
// Leads are unique by phone in a workspace; the rig's demo workspace keeps every run's leads.
const leadPhone = `+9715${Date.now().toString().slice(-8)}`;

async function ok(res: { ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }, what: string) {
  expect(res.ok(), `${what}: ${await res.text().catch(() => '')}`).toBeTruthy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as Record<string, any>;
}

test.describe('AI-assisted call from a lead', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(4 * 60_000);

  test('lead → assisted call → honest provider notice → consent → placed → watching; no phone → fallback', async ({
    browser,
  }) => {
    const api = (p: string) => `${base()}${p}`;
    const adminCtx = await browser.newContext({ baseURL: base() });
    const admin = adminCtx.request;
    await ok(await admin.post(api('/api/v1/auth/login'), { data: { email, password } }), 'admin login');
    const roles = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/roles/roles`)), 'roles');
    const rep = ((roles.data ?? roles) as { id: string; key: string }[]).find((r) => r.key === 'sales_rep');
    expect(rep, 'seeded sales_rep role').toBeTruthy();

    // Two sellers: one with a phone on file, one without.
    const staff = async (tag: string, phone?: string) => {
      const staffEmail = `assist-${tag}-${run}@example.com`;
      const account = await ok(
        await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
          data: {
            fullName: `Assist ${tag} ${run}`,
            employeeNumber: `AS-${tag}-${run}`,
            email: staffEmail,
            ...(phone ? { phone } : {}),
            roleId: rep!.id,
            joinedOn: new Date().toISOString().slice(0, 10),
            attendanceEligible: false,
          },
        }),
        `create ${tag}`,
      );
      const ctx = await browser.newContext({ baseURL: base() });
      await ok(
        await ctx.request.post(api('/api/v1/auth/login'), {
          data: { email: staffEmail, password: account.temporaryPassword },
        }),
        `${tag} login`,
      );
      await ok(
        await ctx.request.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
          data: { currentPassword: account.temporaryPassword, newPassword: `Assist-${run}-Aa1xxxx` },
        }),
        `${tag} password change`,
      );
      return ctx;
    };
    const withPhone = await staff('phone', '+971500002222');
    const noPhone = await staff('nophone');

    try {
      // ── Seller with a phone: the whole way through ─────────────────────
      const lead = await ok(
        await withPhone.request.post(api('/api/v1/leads'), {
          data: { fullName: `Assisted Lead ${run}`, phone: leadPhone },
        }),
        'create lead',
      );
      const page = await withPhone.newPage();
      await page.goto(`/${slug}/sales/leads/${lead.id}`);
      await page.getByRole('button', { name: 'Call with AI assistance' }).click();
      await expect(page).toHaveURL(new RegExp(`/sales/calls/new\\?leadId=${lead.id}$`));
      await expect(page.getByText(`Assisted Lead ${run}`)).toBeVisible();
      // The handset dial is still there, and says what it is.
      await page.goBack();
      await expect(page.getByRole('button', { name: 'Phone' })).toHaveAttribute('title', /no AI assistance/);
      await page.goForward();
      // The form re-mounts and fetches the lead again; wait for it before submitting.
      await expect(page.getByText(`Assisted Lead ${run}`)).toBeVisible();

      await page.getByRole('button', { name: 'Create & open live workspace' }).click();
      await expect(page).toHaveURL(/\/sales\/calls\/[a-z0-9]+\/live$/);
      const callId = page.url().match(/calls\/([a-z0-9]+)\/live$/)![1]!;

      // The notice is about this provider, before anything is placed.
      await expect(page.getByRole('note')).toContainText('The development mock cannot stream live audio');
      await expect(page.getByRole('note')).toContainText('transcript, analysis and audit follow after the call');

      page.once('dialog', (dialog) => {
        expect(dialog.message()).toContain('already agreed to a recorded, AI-assisted call');
        void dialog.accept();
      });
      await page.getByRole('button', { name: 'Place call with AI assistance' }).click();
      await expect(page.getByRole('button', { name: 'Stop watching' })).toBeVisible({ timeout: 30_000 });

      const call = await ok(await withPhone.request.get(api(`/api/v1/calls/${callId}`)), 'call');
      expect(call.status).toBe('RINGING');
      expect(call.providerName).toBe('mock');
      expect(call.externalCallId).toMatch(/^mock_call_/);
      expect(call.leadId).toBe(lead.id);
      if (call.consent) expect(call.consent.method).toBe('PRE_AUTHORIZED');

      // Reloading finds the vendor leg, not a simulation.
      await page.reload();
      await expect(page.getByRole('button', { name: 'Connect to live call' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start simulated call' })).toHaveCount(0);
      await page.close();

      // ── Seller with no phone on file: told why, offered the handset ────
      const call2 = await ok(
        await noPhone.request.post(api('/api/v1/calls'), { data: { recipientNumber: '+971501234568' } }),
        'create call without a phone on file',
      );
      const page2 = await noPhone.newPage();
      await page2.goto(`/${slug}/sales/calls/${call2.id}/live`);
      page2.once('dialog', (dialog) => void dialog.accept());
      await page2.getByRole('button', { name: 'Place call with AI assistance' }).click();
      await expect(page2.getByRole('alert').filter({ hasText: 'Add a phone number' })).toContainText(
        'Add a phone number to your profile',
      );
      await expect(
        page2.getByRole('link', { name: 'Call from this phone instead (no AI assistance)' }),
      ).toHaveAttribute('href', 'tel:+971501234568');
      // Nothing was placed.
      const stranded = await ok(await noPhone.request.get(api(`/api/v1/calls/${call2.id}`)), 'call 2');
      expect(stranded.externalCallId).toBeNull();
      await page2.close();
    } finally {
      await withPhone.close();
      await noPhone.close();
      await adminCtx.close();
    }
  });
});
