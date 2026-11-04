import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { grantPermissions } from '../helpers/fixtures';
import { login, strongPassword, uniq } from './helpers';

/**
 * Repairing a Gemini connection from the screen that shows it.
 *
 * The reported production state: the card read Error, "No API key is saved for
 * this connection." sat under it, the API key box offered "Stored — leave empty
 * to keep", and a Remove key button was on the card — four statements that
 * cannot all be true. The Provider had been typed the way the vendor spells it,
 * "Open Router", which no reader matched, so the key was tested against Google
 * and refused; and once the row read ERROR the stored key was read through a
 * CONNECTED-only gate, so re-saving with the key box blank merged over nothing
 * and was refused as "API key is required to connect."
 *
 * The unit, tenant and route specs cover the server side. This covers the part
 * only a browser can: that the screen's promise about the stored key is true,
 * and that the repair an administrator would actually perform — open Configure,
 * set the Provider, leave the key box alone, Save — keeps the key.
 *
 * Deliberately independent of the vendor's verdict: this build environment
 * denies egress to openrouter.ai, so what is asserted is what the save does to
 * the stored connection, not whether OpenRouter liked the key.
 */
test.describe('repairing a Gemini connection from Settings → Intelligence', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(5 * 60_000);

  const run = uniq();
  const slug = `gem-${run}`.toLowerCase();
  const email = `gem-admin-${run}@masterapp.local`;
  const password = strongPassword(`gm${run}`);
  const KEY = 'sk-or-v1-e2e-stored-key';
  let tenantId = '';

  const storedKey = async () => {
    const row = await prisma.integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'gemini' } },
    });
    return {
      apiKey: decryptCredentials((row!.credentials ?? {}) as Record<string, unknown>).apiKey,
      metadata: row!.metadata as Record<string, unknown>,
    };
  };

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `Gem ${run} LLC`, displayName: `Gem Realty ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    const role = await prisma.role.create({
      data: { tenantId, key: `admin-${run}`, name: 'Administrator', rank: 10, defaultScope: 'ORGANIZATION' },
    });
    await grantPermissions(tenantId, role.id, [
      ['integrations', 'VIEW'],
      ['integrations', 'MANAGE_CONFIGURATION'],
    ]);
    const platformUser = await prisma.platformUser.create({
      data: {
        email,
        normalizedEmail: email,
        fullName: 'Gem Administrator',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email, fullName: 'Gem Administrator', roleId: role.id, status: 'ACTIVE' },
    });
    await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });

    // The reported state, exactly: ERROR, a key stored, the vendor's spelling.
    await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'gemini',
        status: 'ERROR',
        errorMessage: 'No API key is saved for this connection.',
        credentials: wrapCredentials({ apiKey: KEY }),
        metadata: { provider: 'Open Router', model: 'google/gemini-2.0-flash-001' },
      },
    });
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.platformUser.deleteMany({ where: { email } }).catch(() => {});
  });

  test('keeps the stored key when the Provider is corrected and the key box left alone', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/admin/integrations`);

    const card = page.locator('.lf-card').filter({ has: page.locator('strong', { hasText: /^Gemini$/ }) });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Configure' }).click();

    /**
     * The promise has to be true. It used to be drawn from the connection's
     * status, so a connection holding nothing still said a key would be kept —
     * beside an error saying none was saved. A key *is* stored here, so the
     * box says so.
     */
    const keyBox = card.getByLabel('API key');
    await expect(keyBox).toHaveAttribute('placeholder', 'Stored — leave empty to keep');

    // The repair, as an administrator would do it: correct the Provider, do not
    // retype a key you are not allowed to read.
    await card.getByLabel('Provider').fill('openrouter');
    await expect(keyBox).toHaveValue('');
    await card.getByRole('button', { name: 'Save and verify' }).click();

    // Wait for the save to report before reading what it wrote. The form always
    // says something — the vendor's verdict, or why it was refused.
    const said = card.locator('[role="alert"], [role="status"]');
    await expect(said.first()).toBeVisible({ timeout: 60_000 });

    // Whatever the vendor said, the save was accepted rather than refused for a
    // missing credential — which is what it used to be.
    await expect(card.getByText('API key is required to connect.')).toHaveCount(0);

    const after = await storedKey();
    expect(after.apiKey).toBe(KEY);
    expect(after.metadata.provider).toBe('openrouter');

    // And the screen still tells the truth after a reload.
    await page.reload();
    await card.getByRole('button', { name: 'Configure' }).click();
    await expect(card.getByLabel('API key')).toHaveAttribute('placeholder', 'Stored — leave empty to keep');
    await expect(card.getByLabel('Provider')).toHaveAttribute('placeholder', 'openrouter');
  });

  test('a connection holding no key does not promise to keep one', async ({ page }) => {
    // The case the screen used to get wrong in the other direction, and the one
    // that matters when a key really is missing: a blank-key save cannot repair
    // a credential that is not there, so the box must not imply it can.
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId, provider: 'gemini' } },
      data: { credentials: {}, status: 'ERROR', errorMessage: 'No API key is saved for this connection.' },
    });

    await login(page, email, password);
    await page.goto(`/${slug}/admin/integrations`);
    const card = page.locator('.lf-card').filter({ has: page.locator('strong', { hasText: /^Gemini$/ }) });
    await card.getByRole('button', { name: 'Configure' }).click();

    const keyBox = card.getByLabel('API key');
    await expect(keyBox).not.toHaveAttribute('placeholder', 'Stored — leave empty to keep');

    // And saving with it empty is refused, naming the field rather than
    // pretending something was kept.
    await card.getByRole('button', { name: 'Save and verify' }).click();
    await expect(card.getByText(/API key is required to connect/)).toBeVisible();
  });
});
