/**
 * The lead grid's bulk bar under /lead-eagle/leads, at 1280 px and at 390 px
 * (Lead Eagle audit, M4-35, M4-36, M4-39):
 *
 * - Delete puts up a toast with Undo, focused; Undo brings each selected lead
 *   back to the list, even when the delete had emptied it; 10 seconds after
 *   focus leaves it the toast has gone and the lead stays deleted;
 * - Add tag adds to each lead's own tags;
 * - Move to Data takes the leads off the list and onto the day's
 *   "From pipeline <date>" list in Cold Data.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Lead grid bulk actions', () => {
  const run = uniq();
  const eagle = {
    displayName: `Bulk Eagle ${run}`,
    slug: `bulkeagle-${run}`,
    adminName: 'Bulk Eagle Administrator',
    adminEmail: `admin.bulkeagle.${run}@masterapp.local`,
    adminPassword: strongPassword(`be${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  let tenantId = '';
  let made = 0;

  async function signedIn(browser: Browser, width: number) {
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 } });
    const page = await context.newPage();
    await login(page, eagle.adminEmail, eagle.adminPassword);
    return { context, page };
  }
  /** Leads named for this case alone, so `?q=` lists only them. Numbers from the clock: unique by phone. */
  async function leads(page: Page, tag: string, count: number) {
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const fullName = `Bulk ${tag} ${run} ${i}`;
      const res = await page.request.post('/api/v1/leads', {
        data: { fullName, phone: `+97152${String(Date.now() + ++made).slice(-7)}` },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      names.push(fullName);
    }
    return names;
  }
  async function select(page: Page, names: string[]) {
    for (const name of names) await page.getByRole('checkbox', { name: `Select ${name}` }).check();
  }
  const noSidewaysScroll = async (page: Page, width: number) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  /** The screen as it stands, in the light theme and then the dark one (tokens only). */
  async function shots(page: Page, path: string) {
    await page.screenshot({ path: `${path}-light.png` });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    await page.screenshot({ path: `${path}-dark.png` });
    await page.evaluate(() => delete document.documentElement.dataset.theme);
  }

  test.beforeAll(resetLoginThrottle);

  test('a Lead Eagle workspace', async ({ browser }) => {
    const owner = await browser.newPage();
    await loginPlatformOwner(owner);
    await createWorkspaceViaWizard(owner, eagle);
    await owner.close();
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
  });

  for (const width of [1280, 390]) {
    test(`Delete, then Undo, brings the leads back (${width} px)`, async ({ browser }, testInfo) => {
      const { context, page } = await signedIn(browser, width);
      const tag = `undo${width}`;
      // At 1280 px a third lead is listed and not selected: only the selected rows go.
      const all = await leads(page, tag, width < 768 ? 2 : 3);
      const [names, kept] = [all.slice(0, 2), all[2]];
      await page.goto(at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk ${tag} ${run}`)}`));
      await select(page, names);
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      // The bulk bar is a status too; the toast is the one that says what was deleted.
      const toast = page.getByRole('status').filter({ hasText: 'deleted' });
      await expect(toast).toContainText('2 leads deleted.', { timeout: 30_000 });
      if (kept) {
        await expect(page.getByRole('checkbox', { name: `Select ${kept}` })).toBeVisible({ timeout: 30_000 });
      } else {
        // The delete emptied the list: the page's empty state, and the Undo still there.
        await expect(page.getByText('Nothing matches this view')).toBeVisible({ timeout: 30_000 });
      }
      for (const name of names) await expect(page.getByText(name)).toHaveCount(0);
      const undo = toast.getByRole('button', { name: 'Undo' });
      await expect(undo).toBeVisible();
      await noSidewaysScroll(page, width);
      await shots(page, testInfo.outputPath(`undo-toast-${width}`));
      // Reachable by keyboard: the delete puts focus on Undo, and Enter presses it.
      await expect(undo).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toContainText('Restored 2 leads.');
      for (const name of names) await expect(page.getByRole('checkbox', { name: `Select ${name}` })).toBeVisible();
      const rows = await prisma.lead.findMany({
        where: { tenantId, fullName: { in: names } },
        select: { id: true, deletedAt: true },
      });
      expect(rows.map((row) => row.deletedAt)).toEqual([null, null]);
      // The unselected one was never deleted (reads leave deleted rows out).
      if (kept) expect(await prisma.lead.count({ where: { tenantId, fullName: kept } })).toBe(1);
      const events = await prisma.auditLog.findMany({
        where: {
          tenantId,
          recordId: { in: rows.map((row) => row.id) },
          event: { in: ['RECORD_DELETED', 'RECORD_RESTORED'] },
        },
        select: { event: true },
      });
      expect(events.map((e) => e.event).sort()).toEqual([
        'RECORD_DELETED',
        'RECORD_DELETED',
        'RECORD_RESTORED',
        'RECORD_RESTORED',
      ]);
      await context.close();
    });

    test(`Add tag, then Move to Data, puts the leads on the day's list in Cold Data (${width} px)`, async ({
      browser,
    }, testInfo) => {
      const { context, page } = await signedIn(browser, width);
      const tag = `move${width}`;
      const names = await leads(page, tag, 2);
      const list = at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk ${tag} ${run}`)}`);
      await page.goto(list);

      await select(page, names);
      await page.getByRole('button', { name: 'Add tag' }).click();
      await page.getByLabel('Tags to add').fill('recycled, expo');
      await noSidewaysScroll(page, width);
      await shots(page, testInfo.outputPath(`add-tag-${width}`));
      await page.getByRole('button', { name: 'Add to 2' }).click();
      await expect(page.getByRole('checkbox', { name: `Select ${names[0]}` })).not.toBeChecked({ timeout: 30_000 });
      const tags = await prisma.lead.findMany({ where: { tenantId, fullName: { in: names } }, select: { tags: true } });
      expect(tags.map((row) => row.tags)).toEqual([
        ['recycled', 'expo'],
        ['recycled', 'expo'],
      ]);

      await select(page, names);
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Move to Data' }).click();
      await expect(page.getByText('Nothing matches this view')).toBeVisible({ timeout: 30_000 });

      const { timezone } = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'Asia/Dubai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const batch = `From pipeline ${day}`;
      await page.goto(at(`/lead-eagle/cold-data?list=${encodeURIComponent(batch)}`));
      for (const name of names) await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('link', { name: batch })).toBeVisible();
      await noSidewaysScroll(page, width);
      const leadsNow = await prisma.lead.findMany({
        where: { tenantId, fullName: { in: names } },
        select: { status: true },
      });
      expect(leadsNow.map((row) => row.status)).toEqual(['ARCHIVED', 'ARCHIVED']);
      await context.close();
    });
  }

  test('the Undo waits while it has focus, then goes 10 seconds after, and the lead stays deleted', async ({
    browser,
  }) => {
    const { context, page } = await signedIn(browser, 1280);
    const tag = 'expire';
    const names = await leads(page, tag, 1);
    await page.goto(at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk ${tag} ${run}`)}`));
    await select(page, names);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'deleted' });
    await expect(toast).toContainText('1 lead deleted.', { timeout: 30_000 });
    const undo = toast.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeFocused();
    await page.waitForTimeout(11_000);
    await expect(undo).toBeVisible();
    await undo.blur();
    await expect(toast).toHaveCount(0, { timeout: 12_000 });
    expect(await prisma.lead.count({ where: { tenantId, fullName: names[0], deletedAt: { not: null } } })).toBe(1);
    await context.close();
  });

  test('a restore the server refuses is counted in the toast, and that lead stays deleted', async ({ browser }) => {
    const { context, page } = await signedIn(browser, 1280);
    const names = await leads(page, 'refused', 2);
    await page.goto(at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk refused ${run}`)}`));
    await select(page, names);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'deleted' });
    await expect(toast).toContainText('2 leads deleted.', { timeout: 30_000 });
    // The first restore answers 404, as one outside the caller's delete scope does.
    let refused = false;
    await page.route('**/api/v1/leads/*/restore', (route) => {
      if (refused) return route.continue();
      refused = true;
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Lead not found."}' });
    });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'could not' })).toContainText(
      '1 of 2 could not be restored.',
    );
    expect(await prisma.lead.count({ where: { tenantId, fullName: { in: names }, deletedAt: { not: null } } })).toBe(1);
    await context.close();
  });

  /** A box's edge against the page: its border's width and colour, beside the page's and its own fill. */
  const edgeOf = (el: Element) => {
    const style = getComputedStyle(el);
    return {
      width: parseFloat(style.borderTopWidth),
      edge: style.borderTopColor,
      fill: style.backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    };
  };
  const visibleEdge = (box: ReturnType<typeof edgeOf>) => {
    expect.soft(box.width, JSON.stringify(box)).toBeGreaterThanOrEqual(1);
    expect.soft(box.edge).not.toBe(box.page);
    expect.soft(box.edge).not.toBe(box.fill);
  };

  test('at 1440 px the Undo toast clears the assistant, both bars show an edge in the dark theme, Undo stands off its text', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await signedIn(browser, 1440);
    const names = await leads(page, 'edge', 1);
    await page.goto(at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk edge ${run}`)}`));
    await select(page, names);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    const bar = page.locator('.lf-toast').filter({ hasText: 'selected' });
    visibleEdge(await bar.evaluate(edgeOf));
    await page.evaluate(() => delete document.documentElement.dataset.theme);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const toast = page.locator('.lf-toast').filter({ hasText: 'deleted' });
    await expect(toast).toContainText('1 lead deleted.', { timeout: 30_000 });

    // Beside the assistant's button, not over it.
    const [note, assistant] = [await toast.boundingBox(), await page.locator('.lf-ai-fab').boundingBox()];
    expect(note && assistant).toBeTruthy();
    const apart =
      note!.x + note!.width <= assistant!.x ||
      assistant!.x + assistant!.width <= note!.x ||
      note!.y + note!.height <= assistant!.y ||
      assistant!.y + assistant!.height <= note!.y;
    expect.soft(apart, JSON.stringify({ note, assistant })).toBe(true);

    // The focus ring (4 px) around Undo has room before the text it follows.
    const gap = await toast.evaluate((el) => {
      const button = el.querySelector('button')!;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (let node = walker.nextNode(); node && !button.contains(node); node = walker.nextNode()) {
        if (node.textContent!.trim()) last = node as Text;
      }
      const range = document.createRange();
      const end = last!.textContent!.trimEnd().length;
      range.setStart(last!, end - 1);
      range.setEnd(last!, end);
      return button.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });
    expect.soft(gap, 'px between the text and Undo').toBeGreaterThanOrEqual(8);

    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    visibleEdge(await toast.evaluate(edgeOf));
    await page.evaluate(() => delete document.documentElement.dataset.theme);
    await shots(page, testInfo.outputPath('undo-toast-1440'));
    await context.close();
  });

  test('Cold Data at 390 px labels each value on a card and marks the list it was opened on', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await signedIn(browser, 390);
    const [name] = await leads(page, 'cold', 1);
    const { id } = await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName: name }, select: { id: true } });
    const moved = await page.request.post(`/api/v1/leads/${id}/move-to-data`);
    expect(moved.status(), await moved.text()).toBe(200);
    const { batch } = (await moved.json()) as { batch: string };

    await page.goto(at(`/lead-eagle/cold-data?list=${encodeURIComponent(batch)}`));
    // Rows as cards (display: flex) may leave the table's roles behind: found by element.
    const card = page.locator('tbody tr').filter({ hasText: name! });
    await expect(card).toBeVisible({ timeout: 30_000 });
    const cells = await card.locator('td').evaluateAll((tds) =>
      tds.map((td) => {
        const label = getComputedStyle(td, '::before');
        return { shown: label.display !== 'none', label: label.content };
      }),
    );
    // The name is the card's title; every other value has its label, and no cell an empty label column.
    expect
      .soft(cells.filter((cell) => cell.shown).map((cell) => cell.label))
      .toEqual(['"Phone"', '"Company"', '"List"', '"Agent"', '"Outcome"']);

    const chosen = page.locator('tbody tr').filter({ has: page.getByRole('link', { name: batch, exact: true }) });
    await expect(chosen).toHaveAttribute('aria-current', 'true');
    /** The chosen list's row is marked, a record's row is not: a tint and a keyline. */
    const marked = async (width: number) => {
      const [mark, plain] = await Promise.all([
        chosen.evaluate((row) => ({
          fill: getComputedStyle(row).backgroundColor,
          rule: getComputedStyle(row).boxShadow,
        })),
        card.evaluate((row) => getComputedStyle(row).backgroundColor),
      ]);
      expect.soft(mark.fill, `the chosen list's row against a plain one (${width} px)`).not.toBe(plain);
      expect.soft(mark.rule).toContain('inset');
    };
    await marked(390);
    await noSidewaysScroll(page, 390);
    await shots(page, testInfo.outputPath('cold-data-390'));
    // And on a desktop, where the lists are a table.
    await page.setViewportSize({ width: 1440, height: 900 });
    await marked(1440);
    await shots(page, testInfo.outputPath('cold-data-1440'));
    await context.close();
  });

  test('Next and Previous page through the list by keyset (M4-20)', async ({ browser }) => {
    const { context, page } = await signedIn(browser, 390);
    const names = await leads(page, 'pages', 53);
    await page.goto(at(`/lead-eagle/leads?q=${encodeURIComponent(`Bulk pages ${run}`)}`));
    const boxes = page.getByRole('checkbox', { name: /^Select Bulk pages/ });
    await expect(boxes).toHaveCount(50, { timeout: 30_000 });
    const firstPage = await boxes.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/[?&]after=/);
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(boxes).toHaveCount(3);
    const secondPage = await boxes.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(new Set([...firstPage, ...secondPage]).size).toBe(names.length);
    await noSidewaysScroll(page, 390);

    await page.getByRole('link', { name: /Previous/ }).click();
    await expect(boxes).toHaveCount(50);
    expect(await boxes.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(firstPage);
    await context.close();
  });
});
