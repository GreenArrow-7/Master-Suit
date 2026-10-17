import { test, expect, type Locator, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The one-step call log (Lead Eagle audit rows PROP-02.2 and M4-27), in a
 * Lead-Eagle-only workspace: from the lead list, a logged call with a due
 * follow-up takes at most three clicks — Log call on the row, the outcome,
 * Log call in the dialog — at desktop width and on a 390 px phone card. Back
 * from a `tel:` call, the dialog opens for that lead by itself, the minutes
 * estimated from the time away and, back within 8 seconds, No answer picked
 * (M20-06). Pressing Log call
 * again after an error logs the call once. The lead page opens the dialog from
 * its own button and back from dialling another of its numbers, pages its
 * timeline, and shows the follow-up and the follow-up once done (M4-47).
 */
test.describe.configure({ mode: 'serial' });

test.describe('Logging a call from the lead list', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Calls ${run}`,
    slug: `eagle-calls-${run}`,
    adminName: 'Calls Administrator',
    adminEmail: `admin.calls.${run}@masterapp.local`,
    adminPassword: strongPassword(`cl${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const DESK = `Desk Caller ${run}`;
  const PHONE = `Phone Caller ${run}`;
  const BACK = `Back Caller ${run}`;
  const RETRY = `Retry Caller ${run}`;

  /** Tomorrow at 10:00 in Dubai, as an instant: the dialog's default follow-up. */
  function tomorrowAtTen() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + 1, 6)).toISOString();
  }

  /** Each click counted: the acceptance is a number of them. */
  function counter() {
    let clicks = 0;
    return {
      click: async (target: Locator) => {
        clicks += 1;
        await target.click();
      },
      get count() {
        return clicks;
      },
    };
  }

  let tenantId = '';
  async function logged(leadName: string) {
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName: leadName }, select: { id: true } });
    const [activities, followUps] = await Promise.all([
      prisma.activity.findMany({ where: { tenantId, leadId: lead.id }, select: { outcome: true } }),
      prisma.followUpTask.findMany({ where: { tenantId, leadId: lead.id }, select: { dueAt: true, status: true } }),
    ]);
    return { leadId: lead.id, activities, followUps };
  }

  async function logFromList(page: Page, leadName: string, outcome: string) {
    await page.goto(at('/lead-eagle/leads'));
    const clicks = counter();
    await clicks.click(page.getByRole('button', { name: `Log call for ${leadName}` }));
    const dialog = page.getByRole('dialog', { name: `Log call · ${leadName}` });
    await expect(dialog).toBeVisible();
    await clicks.click(dialog.getByLabel(outcome, { exact: true }));
    await clicks.click(dialog.getByRole('button', { name: 'Log call', exact: true }));
    await expect(dialog).toBeHidden();
    expect(clicks.count).toBeLessThanOrEqual(3);
    await expect.poll(async () => (await logged(leadName)).activities).toEqual([{ outcome }]);
    const { followUps } = await logged(leadName);
    expect(followUps).toEqual([{ dueAt: new Date(tomorrowAtTen()), status: 'OPEN' }]);
  }

  test.beforeAll(resetLoginThrottle);

  test('three clicks from the list to a logged call with a due follow-up, at desktop and phone width', async ({
    page,
  }) => {
    await test.step('a Lead-Eagle-only workspace with four leads', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
      const stamp = String(Date.now()).slice(-6);
      for (const [index, fullName] of [DESK, PHONE, BACK, RETRY].entries()) {
        const res = await page.request.post('/api/v1/leads', {
          data: { fullName, phone: `+9715${index}${stamp}0` },
        });
        expect(res.status(), await res.text()).toBeLessThan(300);
      }
    });

    await test.step('desktop: Log call, the outcome, Log call', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await logFromList(page, DESK, 'No answer');
    });

    await test.step('390 px: the same three clicks on the phone card', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await logFromList(page, PHONE, 'Interested');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    await test.step('back from a tel: call, the dialog opens for that lead', async () => {
      await page.goto(at('/lead-eagle/leads'));
      // A real dial leaves the page for the phone app and comes back; here the
      // dial is the tel: link, and the return is the page becoming visible again.
      const dial = page.getByRole('link', { name: `Call ${BACK}` });
      await expect(dial).toHaveAttribute('href', /^tel:\+9715/);
      await dial.evaluate((link) => link.addEventListener('click', (event) => event.preventDefault()));
      await dial.click();
      await page.evaluate(() => {
        const set = (state: string) => {
          Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        set('hidden');
        set('visible');
      });
      const dialog = page.getByRole('dialog', { name: `Log call · ${BACK}` });
      await expect(dialog).toBeVisible();
      // Back within 8 seconds: nobody answered (M20-06), and the agent can say otherwise.
      await expect(dialog.getByLabel('No answer', { exact: true })).toBeChecked();
      await expect(dialog.getByLabel('Minutes on the call')).toHaveValue('0');
      await dialog.getByLabel('Connected', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Log call', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await logged(BACK)).activities).toEqual([{ outcome: 'Connected' }]);
    });

    await test.step('Log call again after an error that came after the save: one call, one follow-up', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(at('/lead-eagle/leads'));
      // The server logs the first send; its answer is lost on the way back.
      let first = true;
      await page.route('**/api/v1/leads/*/call-log', async (route) => {
        if (!first) return route.continue();
        first = false;
        await route.fetch();
        await route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 500, detail: 'The answer was lost' }),
        });
      });
      await page.getByRole('button', { name: `Log call for ${RETRY}` }).click();
      const dialog = page.getByRole('dialog', { name: `Log call · ${RETRY}` });
      await dialog.getByLabel('Busy', { exact: true }).click();
      const send = dialog.getByRole('button', { name: 'Log call', exact: true });
      await send.click();
      await expect(dialog.getByText('The answer was lost')).toBeVisible();
      await send.click();
      await expect(dialog).toBeHidden();
      await page.unroute('**/api/v1/leads/*/call-log');
      const { activities, followUps } = await logged(RETRY);
      expect(activities).toEqual([{ outcome: 'Busy' }]);
      expect(followUps).toHaveLength(1);
    });

    await test.step('the lead page shows the follow-up, the call on its timeline, and the follow-up once done', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { leadId } = await logged(DESK);
      // Another number, and more history than a page holds: 35 older edits.
      const other = await page.request.post(`/api/v1/leads/${leadId}/phones`, {
        data: { phone: `+97155${String(Date.now()).slice(-7)}`, label: 'Office' },
      });
      expect(other.status(), await other.text()).toBeLessThan(300);
      await prisma.auditLog.createMany({
        data: Array.from({ length: 35 }, (_, i) => ({
          tenantId,
          event: 'RECORD_UPDATED' as const,
          objectType: 'lead',
          recordId: leadId,
          fieldKey: 'city',
          previousValue: `Old city ${i}`,
          newValue: `New city ${i}`,
          occurredAt: new Date(Date.UTC(2026, 0, 1, 9, i)),
        })),
      });
      await page.goto(at(`/lead-eagle/leads/${leadId}`));

      // Its own Log call, and back from dialling its other number.
      const dialog = page.getByRole('dialog', { name: `Log call · ${DESK}` });
      await page.getByRole('button', { name: 'Log call', exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      const dial = page.locator('a[href^="tel:+97155"]');
      await dial.evaluate((link) => link.addEventListener('click', (event) => event.preventDefault()));
      await dial.click();
      await page.evaluate(() => {
        const set = (state: string) => {
          Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        set('hidden');
        // Two minutes and five seconds in the phone app.
        const real = Date.now;
        Date.now = () => real() + 125_000;
        set('visible');
        Date.now = real;
      });
      await expect(dialog).toBeVisible();
      // The minutes come from the time away, to be corrected; the outcome is the agent's (M20-06).
      await expect(dialog.getByLabel('Minutes on the call')).toHaveValue('2');
      await expect(dialog.getByText('Estimated from your time in the phone app')).toBeVisible();
      await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();

      await page.getByRole('tab', { name: /Timeline/ }).click();
      await expect(page.getByText('Outbound call').first()).toBeVisible();
      await expect(page.getByText('No answer', { exact: true }).first()).toBeVisible();
      // The oldest edit is on the second page, once.
      await expect(page.getByText('Old city 34 → New city 34', { exact: true })).toBeVisible();
      await expect(page.getByText('Old city 0 → New city 0', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Show older' }).click();
      await expect(page.getByText('Old city 0 → New city 0', { exact: true })).toHaveCount(1);
      await expect(page.getByText('Old city 34 → New city 34', { exact: true })).toHaveCount(1);

      await page.getByRole('tab', { name: /Tasks/ }).click();
      const followUp = page.getByRole('listitem').filter({ hasText: 'Follow-up call' });
      await expect(followUp).toBeVisible();
      await followUp.getByRole('button', { name: 'Complete' }).click();
      const done = page.getByRole('region', { name: 'Done' });
      await expect(done.getByText('Follow-up call')).toBeVisible();
      await page.reload();
      await page.getByRole('tab', { name: /Tasks/ }).click();
      await expect(page.getByRole('region', { name: 'Done' }).getByText('Follow-up call')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});
