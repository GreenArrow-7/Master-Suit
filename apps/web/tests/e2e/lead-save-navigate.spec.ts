import { test, expect, type Page, type Request } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { resetLoginThrottle, strongPassword } from './helpers';

/**
 * The reported journey, with the navigation happening while the save is still
 * in flight.
 *
 *   create a lead → edit it → Save → navigate at once → the destination loads
 *   → reopen the lead → what was typed is what is stored
 *
 * The part that matters is "at once". A settled journey — tap Save, wait, then
 * move — has never reproduced the fault, on any engine. The reporter's thumb
 * does not wait, and `docs/qa/BLANK-SCREEN-WEBKIT.md` recorded the one
 * behavioural difference the two timings produce: the immediate variant sends
 * the tag save **twice**, which that document left unattributed between two
 * possibilities with different fixes.
 *
 * This settles it by reading the request key rather than counting requests.
 * `sendOrQueue` (lib/offline.ts) mints one id per write and sends it as
 * `idempotency-key`; a request the navigation cancels is kept and goes again
 * under that same id, and the server replays it. So:
 *
 *   * two PATCHes, **one** key  → the outbox retrying, converging, one write
 *   * two PATCHes, **two** keys → a genuine double submit
 *
 * Counting requests cannot tell those apart, which is why the earlier round
 * could not attribute it. This asserts on distinct keys.
 *
 * Browser evidence, not device evidence. The `webkit-journey` project runs it
 * in Safari's engine at iPhone dimensions, which is the closest a desk gets;
 * the phone still has to repeat it.
 */
const run = randomBytes(4).toString('hex');
const slug = `journey-${run}`;
const adminEmail = `admin.journey.${run}@journey.test`;
const adminPassword = strongPassword(`jn${run}`);

/**
 * Built directly rather than through the workspace wizard.
 *
 * The wizard needs a platform-owner sign-in, and that sign-in's second factor
 * does not complete in WebKit under this harness — which would make an iPhone
 * journey test fail in setup, for a reason that has nothing to do with the
 * journey. The fixture is not what is under test here.
 */
async function seedWorkspace() {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Journey LLC', displayName: 'Journey', status: 'ACTIVE' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
  await prisma.leadStage.create({
    data: { tenantId, key: `new-${run}`, name: 'New', position: 0, isDefault: true },
  });

  const role = await prisma.role.create({
    data: {
      tenantId,
      key: `journey-admin-${run}`,
      name: 'Journey Administrator',
      rank: 1,
      defaultScope: 'ORGANIZATION',
    },
  });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'CREATE'],
      ['leads', 'EDIT'],
      ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ],
    'ORGANIZATION',
  );

  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: adminEmail,
    fullName: 'Journey Administrator',
    password: adminPassword,
  });
  // Without this the account counts as being on an administrator-issued
  // temporary password, and every navigation is redirected to the password
  // screen — which is not the journey under test.
  await prisma.platformUser.update({
    where: { id: admin.platformUserId },
    data: { passwordChangedAt: new Date() },
  });
  return tenantId;
}

/** Enough repeats to catch a race that does not fire every time. */
const ROUNDS = Number(process.env.JOURNEY_ROUNDS ?? 5);

interface Write {
  method: string;
  key: string | null;
  status?: number;
  replay?: boolean;
}

/** Every write to this lead, with the key that decides whether it is a twin. */
function recordWrites(page: Page, leadId: string): Write[] {
  const writes: Write[] = [];
  const mine = (r: Request) => r.url().includes(`/api/v1/leads/${leadId}`) && r.method() !== 'GET';

  page.on('request', (r) => {
    if (mine(r)) writes.push({ method: r.method(), key: r.headers()['idempotency-key'] ?? null });
  });
  page.on('response', async (res) => {
    if (!mine(res.request())) return;
    const entry = writes.find((w) => w.status === undefined && w.method === res.request().method());
    if (entry) {
      entry.status = res.status();
      entry.replay = res.headers()['idempotent-replay'] === 'true';
    }
  });
  return writes;
}

/** The page region, measured the way the shipped detector measures it. */
const regionText = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-content-root]');
    if (!root) return null;
    if (root.querySelector('[aria-busy="true"]')) return 'LOADING';
    return (root.innerText ?? '').trim();
  });

test.describe.configure({ mode: 'serial' });

test.describe('save, then navigate before it returns', () => {
  let tenantId = '';

  test.beforeAll(async () => {
    await resetLoginThrottle();
    tenantId = await seedWorkspace();
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  test('the destination loads, the data is right, and the save is not a twin', async ({ page }) => {
    test.setTimeout(60_000 + ROUNDS * 60_000);
    /**
     * Signed in through the API, not the form.
     *
     * `page.request` shares this context's cookie jar, so the browser is
     * signed in exactly as a form submission would leave it. The form is not
     * used because `fill` does not land in the email field under WebKit with
     * iPhone emulation — it posts an empty string and the server returns 422 —
     * while the same credentials return 200 on the API and the form works in
     * Chromium. That looks like a harness interaction rather than a product
     * fault (nobody could sign in on a real iPhone otherwise), and chasing it
     * here would replace the journey under test with a sign-in investigation.
     */
    const signedIn = await page.request.post('/api/v1/auth/login', {
      data: { email: adminEmail, password: adminPassword },
    });
    expect(signedIn.ok(), await signedIn.text()).toBeTruthy();

    const failures: string[] = [];

    for (let round = 1; round <= ROUNDS; round++) {
      const stamp = `${run}r${round}`;

      const created = await page.request.post('/api/v1/leads', {
        data: { fullName: `Journey ${stamp}`, phone: `05${String(Date.now()).slice(-8)}`, source: 'MANUAL' },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const lead = await created.json();
      const leadId: string = lead.id ?? lead.data?.id;
      expect(leadId, 'the lead came back without an id').toBeTruthy();

      const writes = recordWrites(page, leadId);
      const detail = `/${slug}/sales/leads/${leadId}`;

      await page.goto(detail);
      // Edit lives behind More, as crm-lifecycle.spec.ts also drives it.
      await page.getByRole('button', { name: /More/ }).click();
      await page.getByRole('button', { name: 'Edit details' }).click();
      await page.getByLabel('Tags, comma-separated').fill(`vip, ${stamp}`);

      // Save and go, with nothing awaited in between. This is the whole point:
      // `click()` resolves on the click, not on the request it starts, so the
      // navigation below begins while the PATCH is still open.
      await page.getByRole('button', { name: 'Save', exact: true }).click({ noWaitAfter: true });
      // The visible one. A phone collapses the sidebar and shows a bottom bar,
      // so several links carry this name and most of them cannot be tapped —
      // and a hard `goto` instead would navigate the wrong way, missing the
      // soft navigation this journey is about.
      /**
       * The back link on the record itself — what a person taps after saving.
       *
       * Not the sidebar's "Leads": on a phone the sidebar is off-canvas, and
       * it reports as visible while refusing the tap. Not a `goto` either,
       * which would be a full page load and skip the soft navigation this
       * journey is about.
       */
      await page.getByRole('link', { name: /^←\s*Leads$/ }).click({ noWaitAfter: true });

      // 1. the destination loads
      await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(new RegExp(`/${slug}/sales/leads(\\?|$)`));
      await expect.poll(() => regionText(page), { timeout: 25_000 }).not.toBe('LOADING');
      const arrived = await regionText(page);
      if (!arrived) failures.push(`round ${round}: the destination rendered nothing (${JSON.stringify(arrived)})`);

      // 2. reopen it, and what was typed is what is stored
      await page.goto(detail);
      await expect.poll(() => regionText(page), { timeout: 25_000 }).not.toBe('LOADING');
      const stored = await page.request.get(`/api/v1/leads/${leadId}`);
      const body = await stored.json();
      const tags: string[] = body.tags ?? body.data?.tags ?? [];
      if (!tags.includes(stamp)) failures.push(`round ${round}: tags are ${JSON.stringify(tags)}, expected ${stamp}`);

      // 3. one save, however many requests carried it
      const patches = writes.filter((w) => w.method === 'PATCH');
      // Printed, not merely asserted: "two requests, one key" is the evidence
      // that attributes the duplicate, and it belongs in the run log.
      console.log(
        `round ${round}: ${patches.length} PATCH request(s), ` +
          `${new Set(patches.map((w) => w.key)).size} distinct key(s), ` +
          `${patches.filter((w) => w.replay).length} replayed, statuses ${patches.map((w) => w.status).join('/')}`,
      );
      const keys = new Set(patches.map((w) => w.key ?? `unkeyed-${Math.random()}`));
      if (keys.size > 1) {
        failures.push(
          `round ${round}: ${patches.length} PATCHes under ${keys.size} different keys — a double submit, not a replay: ` +
            JSON.stringify(patches),
        );
      }
      if (patches.some((w) => w.key === null)) {
        failures.push(`round ${round}: a PATCH went out with no idempotency key: ${JSON.stringify(patches)}`);
      }

      page.removeAllListeners('request');
      page.removeAllListeners('response');
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
