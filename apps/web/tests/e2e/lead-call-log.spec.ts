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
 * from a `tel:` call, the dialog opens for that lead by itself. The lead page
 * then shows the follow-up, the call on its timeline, and the follow-up once
 * done (M4-47).
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
    await test.step('a Lead-Eagle-only workspace with three leads', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
      const stamp = String(Date.now()).slice(-6);
      for (const [index, fullName] of [DESK, PHONE, BACK].entries()) {
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
      await dialog.getByLabel('Connected', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Log call', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await logged(BACK)).activities).toEqual([{ outcome: 'Connected' }]);
    });

    await test.step('the lead page shows the follow-up, the call on its timeline, and the follow-up once done', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { leadId } = await logged(DESK);
      await page.goto(at(`/lead-eagle/leads/${leadId}`));
      await page.getByRole('tab', { name: /Timeline/ }).click();
      await expect(page.getByText('Outbound call').first()).toBeVisible();
      await expect(page.getByText('No answer', { exact: true }).first()).toBeVisible();

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
