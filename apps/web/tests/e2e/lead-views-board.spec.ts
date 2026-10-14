/**
 * The lead grid's board, saved views, ⌘K phone search and the calendar, in a
 * Lead Eagle workspace from the wizard (M4-19, M4-21, M4-22, OWN-01.2):
 *
 * - dragging a card into Meeting Scheduled opens the stage mini-form, which
 *   will not move it without the meeting's date and time, and the move books the
 *   meeting; a card's Move menu (the keyboard's and the phone's way) moves it
 *   into Dropped only with a reason, and into Pending with no dialog, at 390 px
 *   with no sideways page scroll; the arrow keys on the menu move nothing;
 * - filters applied from the Filters panel are the URL; Save view keeps them
 *   under a name that reopens them, and Delete view removes it; four chips in
 *   force at 390 px leave the page 390 px wide;
 * - at 1280 and 1440 px the grid's pinned Call cell has its header pinned with
 *   it and a shadow edge over the columns passing under it at rest, and
 *   scrolled to the end the last column stands whole beside it;
 * - the shortcut reads Ctrl K off a Mac and ⌘K on one, with no hydration warning;
 * - ⌘K (Ctrl+K) on any screen searches the leads by a number typed in any
 *   format, found through one of the lead's other numbers;
 * - the calendar opens under /lead-eagle/ and shows the meeting the move booked.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
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

test.describe('Lead Eagle lead views', () => {
  const run = uniq();
  const eagle = {
    displayName: `Lead Views ${run}`,
    slug: `leadviews-${run}`,
    adminName: 'Lead Views Administrator',
    adminEmail: `admin.leadviews.${run}@masterapp.local`,
    adminPassword: strongPassword(`lv${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  // Ten days ahead, as the date field takes it.
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const typed = day.split('-').reverse().join('/');
  const name = `Board Lead ${run}`;
  // Seven digits from the clock: leads are unique by phone in a workspace.
  const digits = String(Date.now()).slice(-7);
  const other = `050 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  let tenantId = '';
  let leadId = '';

  const stageOf = async () =>
    (await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, include: { stage: true } })).stage.key;
  const signIn = async (page: Page) => login(page, eagle.adminEmail, eagle.adminPassword);
  /**
   * A drag as a hand makes one: press, move a little, travel, release. Held by
   * the card's text line (its middle is the Move menu). One jump to the target,
   * as `dragTo` makes it, never starts the browser's drag.
   */
  const drag = async (page: Page, from: Locator, to: Locator) => {
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + 10, { steps: 5 });
    await page.mouse.move(b.x + 40, b.y + 40, { steps: 20 });
    await page.mouse.up();
  };

  test.beforeAll(resetLoginThrottle);

  test('a card dragged into Meeting Scheduled opens the mini-form and books the meeting', async ({ browser }) => {
    const owner = await browser.newPage();
    await loginPlatformOwner(owner);
    await createWorkspaceViaWizard(owner, eagle);
    await owner.close();
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await signIn(page);
    const created = await page.request.post('/api/v1/leads', {
      data: { fullName: name, phone: `+97155${digits}` },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    leadId = (await created.json()).id;
    const phone = await page.request.post(`/api/v1/leads/${leadId}/phones`, { data: { phone: other } });
    expect(phone.status(), await phone.text()).toBeLessThan(300);

    await page.goto(at('/lead-eagle/leads?layout=board'));
    const card = page.locator('.lf-board__card', { hasText: name });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('group', { name: 'Exits' }).getByRole('region', { name: 'Dropped' })).toHaveCount(1);

    const dialog = page.getByRole('dialog', { name: 'Move to Meeting Scheduled' });
    const move = dialog.getByRole('button', { name: 'Move to Meeting Scheduled' });
    // A drag before the board hydrates drops nothing; the drop that lands opens the dialog.
    await expect(async () => {
      await drag(page, card.locator('.lf-board__meta'), page.getByRole('region', { name: 'Meeting Scheduled' }));
      await expect(dialog).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    // Without the meeting's date and time the form does not submit.
    await move.click();
    await expect(dialog).toBeVisible();
    expect(await stageOf()).toBe('new');

    await dialog.getByLabel('Meeting date and time, date', { exact: true }).fill(typed);
    await dialog.getByLabel('Meeting date and time, time', { exact: true }).fill('10:00');
    await move.click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.getByRole('region', { name: 'Meeting Scheduled' }).locator('.lf-board__card', { hasText: name }),
    ).toBeVisible({ timeout: 30_000 });
    expect(await stageOf()).toBe('meeting_scheduled');
    const tasks = await prisma.task.findMany({ where: { tenantId, leadId } });
    expect(tasks.map((task) => task.title)).toEqual([`Meeting with ${name}`]);
    // 10:00 in Dubai, the workspace's zone, is 06:00 UTC.
    expect(tasks[0]!.dueAt.toISOString()).toBe(`${day}T06:00:00.000Z`);
    await context.close();
  });

  test('at phone width, the Move menu moves a card: Dropped asks why, Pending does not', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(at('/lead-eagle/leads?layout=board'));
    const card = page.locator('.lf-board__card', { hasText: name });
    const menu = page.getByLabel(`Move ${name}`);
    await expect(menu).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Looking through the menu with the arrow keys moves nothing.
    const patches: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH') patches.push(request.url());
    });
    await menu.focus();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp']) await page.keyboard.press(key);
    await page.waitForTimeout(1_000);
    expect(patches).toEqual([]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await stageOf()).toBe('meeting_scheduled');

    // Enter opens it; each stage is a button, and Enter on one moves the card.
    await page.keyboard.press('Enter');
    await card.getByRole('button', { name: 'Dropped', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Move to Dropped' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Move to Dropped' }).click();
    await expect(dialog).toBeVisible();
    expect(await stageOf()).toBe('meeting_scheduled');
    await dialog.getByLabel('Why is it moving?').fill('Bought elsewhere');
    await dialog.getByRole('button', { name: 'Move to Dropped' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(stageOf).toBe('dropped');

    await page.getByRole('group', { name: 'Exits' }).getByLabel(`Move ${name}`).click({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Pending', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(stageOf).toBe('pending');
    await context.close();
  });

  test('filters are the URL; a saved view reopens them and can be deleted', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(at('/lead-eagle/leads'));
    await page.locator('summary', { hasText: 'Filters' }).click({ timeout: 60_000 });
    await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Pending' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/stage=/);
    await expect(page.getByRole('link', { name: /Stage: Pending/ })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

    await page.getByRole('button', { name: 'Save view' }).click();
    await page.getByLabel('Name this view').fill('Pending leads');
    await page.getByRole('button', { name: 'Save view' }).last().click();
    await expect(page).toHaveURL(/saved=/, { timeout: 30_000 });
    const chip = page.getByRole('navigation', { name: 'My views' }).getByRole('link', { name: 'Pending leads' });
    await expect(chip).toHaveAttribute('aria-current', 'page');

    await page.goto(at('/lead-eagle/leads'));
    await page.getByRole('navigation', { name: 'My views' }).getByRole('link', { name: 'Pending leads' }).click();
    await expect(page).toHaveURL(/stage=.*saved=/);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await page.getByRole('button', { name: 'Delete view' }).click();
    await expect(page.getByRole('navigation', { name: 'My views' }).getByRole('link')).toHaveCount(0, {
      timeout: 30_000,
    });
    await context.close();
  });

  test('four filter chips at phone width keep the page 390 px wide', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page);
    const stage = await prisma.leadStage.findFirstOrThrow({ where: { tenantId, key: 'pending' } });
    const source = await prisma.leadSource.findFirstOrThrow({ where: { tenantId }, orderBy: { name: 'asc' } });
    const today = new Date().toISOString().slice(0, 10);
    await page.goto(at(`/lead-eagle/leads?stage=${stage.id}&owner=none&source=${source.id}&from=${today}`));
    const chips = page.getByRole('navigation', { name: 'Filters in force' }).getByRole('link');
    await expect(chips).toHaveCount(4, { timeout: 60_000 });
    for (const [i, label] of ['Stage: Pending', 'Owner: Unassigned', 'Source: ', 'Created: '].entries()) {
      await expect(chips.nth(i)).toContainText(label);
    }
    // Each chip's "(remove)" is hidden text; it may not stretch the page past the chips' own scroller.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });

  test('at 1280 and 1440 px the pinned Call cell and its header sit beside the last column', async ({ browser }) => {
    for (const width of [1280, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await signIn(page);
      await page.goto(at('/lead-eagle/leads'));
      const row = page.getByRole('row', { name: new RegExp(name) });
      await expect(row.getByRole('button', { name: `Log call for ${name}` })).toBeVisible({ timeout: 60_000 });
      const frame = page.locator('.lf-grid-wrap');
      const heads = page.locator('.lf-grid thead th');
      const box = async (locator: Locator) => (await locator.boundingBox())!;
      // The default columns are wider than the frame: the case where a pinned cell covers columns.
      expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      // At rest, the pinned header stands over the pinned cell, at the frame's right edge.
      const head = await box(heads.last());
      const cell = await box(row.locator('td.lf-grid__actions'));
      const edge = await box(frame);
      expect(Math.abs(head.x - cell.x), `${width}: header at ${head.x}, cell at ${cell.x}`).toBeLessThanOrEqual(1);
      expect(head.x + head.width).toBeLessThanOrEqual(edge.x + edge.width + 1);
      // And the columns running on past the frame pass under it, so both carry a
      // shadow edge (a blurred shadow, not the hairline alone): the cut column
      // reads as running under the pinned one, not as the table's end. Its colour
      // is the theme's.
      const shadow = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).boxShadow);
      for (const pinned of [heads.last(), row.locator('td.lf-grid__actions')]) {
        expect(await shadow(pinned), `${width}: no shadow edge`).toMatch(/rgba\(17, 24, 39, 0\.16\) -\d+px 0px [1-9]/);
      }
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      expect(await shadow(heads.last()), `${width}: dark`).toMatch(/rgba\(0, 0, 0, 0\.6\) -\d+px 0px [1-9]/);
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      // Scrolled to the end, the last column's header is whole, beside the pinned one and not under it.
      await frame.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      const last = await box(heads.nth((await heads.count()) - 2));
      expect(last.x).toBeGreaterThanOrEqual(edge.x);
      expect(last.x + last.width, `${width}: last header ends at ${last.x + last.width}`).toBeLessThanOrEqual(
        (await box(heads.last())).x + 1,
      );
      // The pinned headers (Reference on the left, Call on the right) paint over the ones scrolling under them.
      const onTop = (th: Locator) =>
        th.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return document.elementFromPoint(r.x + 4, r.y + r.height / 2)?.closest('th') === el;
        });
      expect(await onTop(heads.nth(1)), `${width}: the Reference header is under another`).toBe(true);
      expect(await onTop(heads.last()), `${width}: the Call header is under another`).toBe(true);
      // And the pinned Reference cell has a ground: the columns passing under it do not show through.
      const ground = await row.locator('td.lf-sticky').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(ground, `${width}: the Reference cell is clear`).not.toBe('rgba(0, 0, 0, 0)');
      await context.close();
    }
  });

  test('the shortcut reads Ctrl K off a Mac and ⌘K on one', async ({ browser }) => {
    const agents = {
      'Ctrl K':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      '⌘K': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    };
    for (const [key, userAgent] of Object.entries(agents)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent });
      const page = await context.newPage();
      // The server renders one label for every platform; a mismatch on hydration would say so here.
      const hydration: string[] = [];
      page.on('console', (message) => {
        if (/hydrat/i.test(message.text())) hydration.push(message.text());
      });
      await signIn(page);
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page.locator('.lf-cmdk-trigger kbd')).toHaveText(key, { timeout: 60_000 });
      expect(hydration, `${key}: hydration`).toEqual([]);
      const palette = page.getByRole('dialog', { name: 'Search and commands' });
      await expect(async () => {
        if (!(await palette.isVisible())) await page.locator('.lf-cmdk-trigger').click();
        await expect(palette).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      await expect(palette.locator('.lf-cmdk__foot')).toContainText(`${key} toggle`);
      await context.close();
    }
  });

  test('⌘K finds the lead by its other number, typed in another format', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(at('/lead-eagle/dashboard'));
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    // The shortcut listens once the page has hydrated.
    await expect(async () => {
      if (!(await palette.isVisible())) await page.keyboard.press('Control+k');
      await expect(palette).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await palette.getByRole('combobox').fill(`+971 50 ${digits.slice(0, 3)} ${digits.slice(3)}`);
    await expect(palette.getByRole('option').first()).toContainText('Search leads for');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/lead-eagle/leads\\?q=`), { timeout: 30_000 });
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test('the calendar under /lead-eagle/ shows the meeting the move booked', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(at(`/lead-eagle/calendar?month=${day.slice(0, 7)}`));
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({ timeout: 60_000 });
    // The day's cell: named by its number (and any entry titles after it).
    await page.getByRole('button', { name: new RegExp(`^${Number(day.slice(8))}(\\s|$)`) }).click();
    await expect(page.getByRole('link', { name: new RegExp(`Meeting with ${name}`) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });
});
