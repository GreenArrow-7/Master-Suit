import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { resetLoginThrottle, strongPassword } from './helpers';

/**
 * A confirmed save must hand the next screen to a full-page GET, not to the
 * App Router's client transition.
 *
 * Why, in one line: when an RSC transition cannot produce a payload, Next
 * converts it into an MPA fallback, and `app-router.js` calls
 * `location.assign()` **inside a render pass** and then
 * `throw unresolvedThenable` — which suspends the router subtree with no
 * resolution path and no error boundary, leaving a blank document at the right
 * URL. `lib/navigation/afterSave.ts` carries the quoted source.
 *
 * ── The discriminator, and why it is this one ───────────────────────────────
 *
 * Counting document navigations does **not** work. Under this very diagnosis
 * the unfixed code's MPA fallback issues a main-frame document request for the
 * same URL, so in an engine where the transition fails the unfixed code would
 * also produce one document and this spec would pass pre-fix — a false green in
 * exactly the run someone would trust before shipping to a phone.
 *
 * So the assertion is **zero `?_rsc=` requests after the save**.
 * `router.refresh()` and `router.push()` always issue one — that is how they
 * work, in every browser, before any fallback can occur — so pre-fix the count
 * is at least 1 and this fails in Chromium and WebKit alike. Post-fix it is 0,
 * because the handler no longer touches the router.
 *
 * This is a regression test, not a journey and not a simulation. The journey
 * lives in `lead-save-navigate.spec.ts`; nothing here simulates a failure.
 */
const run = randomBytes(4).toString('hex');
const slug = `postsave-${run}`;
const adminEmail = `admin.postsave.${run}@postsave.test`;
const adminPassword = strongPassword(`ps${run}`);

async function seedWorkspace(): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Post Save LLC', displayName: 'Post Save', status: 'ACTIVE' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
  await prisma.leadStage.create({
    data: { tenantId, key: `new-${run}`, name: 'New', position: 0, isDefault: true },
  });
  const role = await prisma.role.create({
    data: {
      tenantId,
      key: `postsave-admin-${run}`,
      name: 'Post Save Administrator',
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
    fullName: 'Post Save Administrator',
    password: adminPassword,
  });
  // Without this the account counts as being on an administrator-issued
  // temporary password and every navigation is sent to the password screen.
  await prisma.platformUser.update({
    where: { id: admin.platformUserId },
    data: { passwordChangedAt: new Date() },
  });
  return tenantId;
}

/** Signed in through the API; `page.request` shares this context's cookie jar. */
async function signIn(page: Page) {
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Counts RSC payload requests from the moment it is installed. */
function countRsc(page: Page): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.url().includes('_rsc=')) n += 1;
  });
  return () => n;
}

/**
 * True once this document no longer carries the pre-save marker.
 *
 * A destroyed execution context counts: that error *is* the document being
 * replaced, which is the thing being asserted. Swallowing it here is safe
 * because once the new document has settled the marker is simply absent.
 */
async function markerGone(page: Page): Promise<boolean> {
  try {
    return (await page.evaluate(() => (window as unknown as { __preSave?: true }).__preSave ?? null)) === null;
  } catch {
    return true;
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('a confirmed save navigates with a document GET, not an RSC transition', () => {
  let tenantId = '';

  test.beforeAll(async () => {
    await resetLoginThrottle();
    tenantId = await seedWorkspace();
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  test('editing a lead issues no RSC request after Save', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);

    const created = await page.request.post('/api/v1/leads', {
      data: { fullName: `Post Save ${run}`, phone: `05${String(Date.now()).slice(-8)}`, source: 'MANUAL' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const leadId: string = (await created.json()).id;
    expect(leadId).toBeTruthy();

    await page.goto(`/${slug}/sales/leads/${leadId}`);
    await page.getByRole('button', { name: /More/ }).click();
    await page.getByRole('button', { name: 'Edit details' }).click();

    // A value that appears nowhere on the page before Save, so neither a stale
    // document nor an un-updated page can satisfy the check below.
    const tag = `psv${run}`;
    await page.getByLabel('Tags, comma-separated').fill(`vip, ${tag}`);

    /**
     * A marker on *this* document. It is the only engine-independent proof
     * that a new document committed: the URL does not change on an edit, and
     * `readyState` is already 'complete' on the old one, so waiting on either
     * passes instantly and asserts nothing. (That mistake made an earlier
     * version of this spec pass before the save had even been sent.)
     */
    await page.evaluate(() => {
      (window as unknown as { __preSave?: true }).__preSave = true;
    });

    const rsc = countRsc(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // The old document is gone: a full-page GET replaced it.
    await expect.poll(() => markerGone(page), { timeout: 30_000 }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/${slug}/sales/leads/${leadId}$`));

    // The contract. Pre-fix this is >= 1 because router.refresh() issues one.
    expect(rsc(), 'a save must not depend on an RSC transition').toBe(0);

    // And the save really is saved, read back from the API, not from the page.
    const stored = await page.request.get(`/api/v1/leads/${leadId}`);
    expect((await stored.json()).tags).toContain(tag);
  });

  test('creating a lead issues no RSC request after Create', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    await page.goto(`/${slug}/sales/leads/new`);

    const name = `Created ${run}`;
    await page.getByLabel('Full name').fill(name);
    await page
      .getByLabel(/Phone/)
      .first()
      .fill(`05${String(Date.now()).slice(-8)}`);

    await page.evaluate(() => {
      (window as unknown as { __preSave?: true }).__preSave = true;
    });

    const rsc = countRsc(page);
    await page.getByRole('button', { name: 'Create lead' }).click();

    // A new document, and it is the new record's page.
    await expect.poll(() => markerGone(page), { timeout: 30_000 }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/${slug}/sales/leads/[A-Za-z0-9_-]+$`));

    expect(rsc(), 'a creation must not depend on an RSC transition').toBe(0);

    // The page we landed on is the lead that was just created.
    const id = page.url().split('/').pop()!;
    const stored = await page.request.get(`/api/v1/leads/${id}`);
    expect((await stored.json()).fullName).toBe(name);
  });
});
