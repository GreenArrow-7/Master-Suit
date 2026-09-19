import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { currentTotpStep, generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { resetLoginThrottle, uniq } from './helpers';

/**
 * One email, two passwords, through the real sign-in form.
 *
 * The identity is synthetic and created as test setup; both passwords are random
 * per run and exist only in this process. The monitoring password is set through
 * the owner's own "Sign-in and passwords" screen, as a person would set it, and
 * each password is then used on the ordinary form with a live authenticator code.
 * There is no mode selector to click — the assertions are about where each
 * password lands and what that session can and cannot reach.
 *
 * The identity is an OWNER that also holds a live break-glass WRITE grant, with
 * sensitive scope, on the very workspace it monitors — so every refusal of the
 * monitoring session below is a refusal the role and the grant would otherwise
 * have allowed, and the administration session proves it (positive controls).
 */
test.describe.configure({ mode: 'serial' });

test.describe('Dual-credential sign-in', () => {
  const run = uniq();
  const email = `dual.${run}@platform.test`;
  const passwordA = `Adm-${randomBytes(9).toString('base64url')}-Aa1`;
  const passwordB = `Mon-${randomBytes(9).toString('base64url')}-Bb2`;
  const secret = generateSecret();
  const transcriptMarker = `Transcript ${run} private conversation`;
  const createdSlug = `dual-created-${run}`;
  let tenantId = '';
  let writeOnlyTenantId = '';
  let userId = '';
  let callId = '';
  let planCode = '';

  const code = () => totp(secret, currentTotpStep());
  /**
   * The next code this identity has not spent. Every accepted code spends its
   * step, so a re-authentication right after a sign-in waits for the
   * authenticator's next code — as a person would. The two credential-change
   * tests use it: the evidence that those flows stay usable with replay
   * prevention on.
   */
  let spentStep = -1;
  const nextCode = async () => {
    while (currentTotpStep() <= spentStep) await new Promise((resolve) => setTimeout(resolve, 250));
    spentStep = currentTotpStep();
    return code();
  };
  /**
   * A code for a fresh sign-in. Each test starts a new sign-in, often within the
   * same 30 seconds as the previous test's; waiting out the step every time cost
   * the suite minutes. Clearing this synthetic identity's last-used step is test
   * setup, like the fixtures above — replay refusal itself is proven in
   * tests/security/mfa-replay.spec.ts.
   */
  const signInCode = async () => {
    await prisma.platformUser.update({ where: { normalizedEmail: email }, data: { mfaLastUsedStep: null } });
    spentStep = currentTotpStep();
    return code();
  };

  async function signIn(page: Page, password: string) {
    await resetLoginThrottle();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const field = page.getByLabel('Authentication code');
    await expect(field).toBeVisible({ timeout: 60_000 });
    // The password is not kept on the page once the server has issued a challenge.
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await field.fill(await signInCode());
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
  }

  /** Same-origin requests from the signed-in page; statuses only, bodies stay in the browser. */
  const statusesFrom = (page: Page, requests: { key: string; url: string; method?: string; body?: unknown }[]) =>
    page.evaluate(async (list) => {
      const out: Record<string, number> = {};
      for (const item of list) {
        const res = await fetch(item.url, {
          method: item.method ?? 'GET',
          headers: item.body ? { 'content-type': 'application/json' } : {},
          body: item.body ? JSON.stringify(item.body) : undefined,
        });
        out[item.key] = res.status;
      }
      return out;
    }, requests);

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `dualcred-${run}`, legalName: `Dual ${run} LLC`, displayName: `Dual ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
    const writeOnly = await prisma.tenant.create({
      data: {
        slug: `dualwrite-${run}`,
        legalName: `Dual Write ${run} LLC`,
        displayName: `Dual Write ${run}`,
        status: 'ACTIVE',
      },
    });
    writeOnlyTenantId = writeOnly.id;
    await prisma.moduleEntitlement.create({ data: { tenantId: writeOnlyTenantId, module: 'SALES', state: 'ACTIVE' } });

    // Customer data the monitoring session must not reach beyond reading leads: a
    // call with a transcript (sensitive) and a lead (list, export).
    const role = await prisma.role.create({ data: { tenantId, key: `agent-${run}`, name: 'Agent', rank: 50 } });
    const agent = await prisma.user.create({
      data: { tenantId, email: `agent.${run}@dual.test`, fullName: `Agent ${run}`, roleId: role.id, status: 'ACTIVE' },
    });
    const call = await prisma.call.create({ data: { tenantId, callerId: agent.id } });
    callId = call.id;
    await prisma.transcript.create({ data: { tenantId, callId, content: transcriptMarker } });

    const user = await prisma.platformUser.create({
      data: {
        email,
        normalizedEmail: email,
        fullName: `Dual ${run}`,
        passwordHash: await hashPassword(passwordA),
        platformRole: 'OWNER',
        status: 'ACTIVE',
        passwordChangedAt: new Date(),
        mfaEnabled: true,
        mfaSecret: encryptSecret(secret),
      },
    });
    userId = user.id;
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    // One insert per grant: the tenant guard pins row-level security to one
    // workspace per statement, so a multi-workspace createMany is refused.
    for (const grant of [
      // Monitoring access, as a second owner would issue it: READ, not sensitive.
      { tenantId, kind: 'READ' as const, sensitive: false, reason: 'Browser regression: monitoring grant' },
      // A live break-glass on the same workspace, with sensitive scope.
      {
        tenantId,
        kind: 'WRITE' as const,
        sensitive: true,
        reason: 'Browser regression: live break-glass on the monitored workspace',
      },
      // And a workspace held only by break-glass.
      {
        tenantId: writeOnlyTenantId,
        kind: 'WRITE' as const,
        sensitive: true,
        reason: 'Browser regression: break-glass only',
      },
    ]) {
      await prisma.platformAccessGrant.create({ data: { platformUserId: userId, expiresAt, ...grant } });
    }
    planCode = (await prisma.subscriptionPlan.findFirstOrThrow({ where: { active: true }, select: { code: true } }))
      .code;
  });

  test.afterAll(async () => {
    for (const id of [tenantId, writeOnlyTenantId]) {
      if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }
    const created = await prisma.tenant.findUnique({ where: { slug: createdSlug }, select: { id: true } });
    if (created) await prisma.tenant.delete({ where: { id: created.id } }).catch(() => {});
    await prisma.platformUser
      .deleteMany({ where: { normalizedEmail: { in: [`admin.${run}@dual-created.test`] } } })
      .catch(() => {});
    if (userId) await prisma.platformUser.delete({ where: { id: userId } }).catch(() => {});
  });

  test('a wrong code after the administration password signs nobody in', async ({ page }) => {
    await resetLoginThrottle();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(passwordA);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const field = page.getByLabel('Authentication code');
    await expect(field).toBeVisible({ timeout: 60_000 });
    await field.fill(code() === '000000' ? '111111' : '000000');
    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'lf_session')).toBe(false);
  });

  test('password A opens the console, where the monitoring password is set', async ({ page }) => {
    await signIn(page, passwordA);
    await expect(page).toHaveURL(/\/platform/);

    await page.goto('/platform/security');
    await expect(page.getByTestId('monitoring-credential-state')).toHaveText('Not set.');
    await page.getByRole('button', { name: 'Set monitoring password' }).click();
    await page.getByLabel('Current administration password').fill(passwordA);
    await page.getByLabel('Authentication code').fill(await nextCode());
    await page.getByLabel('New monitoring password').fill(passwordB);
    await page.getByLabel('Repeat the new password').fill(passwordB);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toContainText('Monitoring password set');
    await expect(page.getByTestId('monitoring-credential-state')).toContainText('Set');
  });

  test('password A creates a workspace and, under its break-glass, reads what monitoring may not', async ({ page }) => {
    await signIn(page, passwordA);
    const created = await page.evaluate(
      async (body) => {
        const res = await fetch('/api/v1/platform/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.status;
      },
      {
        workspaceName: `Dual created ${run}`,
        slug: createdSlug,
        legalName: `Dual Created ${run} LLC`,
        displayName: `Dual Created ${run}`,
        planCode,
        primaryAdminName: `Admin ${run}`,
        primaryAdminEmail: `admin.${run}@dual-created.test`,
        primaryAdminPassword: `Created-${randomBytes(12).toString('base64url')}-Aa1`,
        enabledModules: ['SALES'],
        maxEmployees: 10,
        maxUsers: 10,
        maxStorageMb: 1024,
      },
    );
    expect(created).toBe(201);
    expect(await prisma.tenant.count({ where: { slug: createdSlug } })).toBe(1);

    // Positive control for the monitoring refusals below: the administration
    // session's break-glass admits it and serves the sensitive record and export.
    expect(
      (
        await statusesFrom(page, [
          { key: 'enter', url: `/api/v1/platform/workspaces/${tenantId}/enter`, method: 'POST' },
        ])
      ).enter,
    ).toBe(200);
    expect(
      await statusesFrom(page, [
        { key: 'transcript', url: `/api/v1/calls/${callId}/transcript` },
        { key: 'export', url: '/api/v1/leads/export' },
      ]),
    ).toEqual({ transcript: 200, export: 200 });
  });

  test('the administration password cannot be reused as the monitoring password', async ({ page }) => {
    await signIn(page, passwordA);
    await page.goto('/platform/security');
    await page.getByRole('button', { name: 'Change monitoring password' }).click();
    await page.getByLabel('Current administration password').fill(passwordA);
    await page.getByLabel('Authentication code').fill(await nextCode());
    await page.getByLabel('New monitoring password').fill(passwordA);
    await page.getByLabel('Repeat the new password').fill(passwordA);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.lf-auth-alert')).toBeVisible();
  });

  test('password B lands on read-only monitoring and reaches nothing administrative', async ({ page }) => {
    await signIn(page, passwordB);
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByTestId('monitoring-session-mode')).toContainText('read-only monitoring session');
    await expect(page.getByRole('cell', { name: `Dual ${run}`, exact: true })).toBeVisible();
    // The workspace held only by break-glass is not offered to a monitoring session.
    await expect(page.getByRole('cell', { name: `Dual Write ${run}`, exact: true })).toHaveCount(0);

    // Direct console URLs.
    for (const url of ['/platform', '/platform/security', '/platform/users']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/no-platform-access/);
    }

    // Direct administration API calls from the signed-in page, same origin, same cookie.
    expect(
      await statusesFrom(page, [
        { key: 'createWorkspace', url: '/api/v1/platform/workspaces', method: 'POST', body: { slug: 'never-created' } },
        { key: 'listWorkspaces', url: '/api/v1/platform/workspaces' },
        {
          key: 'breakGlass',
          url: `/api/v1/platform/workspaces/${tenantId}/access`,
          method: 'POST',
          body: { reason: 'Elevation attempt from a monitoring session' },
        },
        {
          key: 'issueGrant',
          url: '/api/v1/platform/monitoring/grants',
          method: 'POST',
          body: { platformUserId: userId, workspaceId: writeOnlyTenantId, reason: 'Self-grant from monitoring' },
        },
        {
          key: 'revokeGrant',
          url: '/api/v1/platform/monitoring/grants',
          method: 'DELETE',
          body: { platformUserId: userId, workspaceId: tenantId },
        },
        { key: 'credentials', url: '/api/v1/platform/credentials' },
        { key: 'enterWriteOnly', url: `/api/v1/platform/workspaces/${writeOnlyTenantId}/enter`, method: 'POST' },
      ]),
    ).toEqual({
      createWorkspace: 403,
      listWorkspaces: 403,
      breakGlass: 403,
      issueGrant: 403,
      revokeGrant: 403,
      credentials: 403,
      enterWriteOnly: 404,
    });
    expect(await prisma.platformAccessGrant.count({ where: { tenantId: writeOnlyTenantId, kind: 'READ' } })).toBe(0);

    // Into the authorised workspace: reading works, nothing else does — despite
    // the OWNER role and the live sensitive WRITE grant on this same workspace.
    await page.goto('/monitoring');
    await page.getByRole('button', { name: /Open/ }).first().click();
    await expect(page).not.toHaveURL(/\/monitoring$/, { timeout: 60_000 });
    // An OWNER in a monitoring session is told the truth: read-only, not full control.
    await expect(page.getByText('Platform support view')).toBeVisible();
    await expect(page.getByText(/Read-only/).first()).toBeVisible();
    expect(
      await statusesFrom(page, [
        { key: 'read', url: '/api/v1/leads' },
        {
          key: 'write',
          url: '/api/v1/leads',
          method: 'POST',
          body: { fullName: 'Never', phone: '+971500000009' },
        },
        { key: 'export', url: '/api/v1/leads/export' },
        { key: 'transcript', url: `/api/v1/calls/${callId}/transcript` },
      ]),
    ).toEqual({ read: 200, write: 403, export: 403, transcript: 403 });
    const transcriptBody = await page.evaluate(
      async (id) => (await fetch(`/api/v1/calls/${id}/transcript`)).text(),
      callId,
    );
    expect(transcriptBody).not.toContain(transcriptMarker);
  });

  test('two sessions in two contexts keep their own modes', async ({ browser }) => {
    const admin = await browser.newContext();
    const monitor = await browser.newContext();
    try {
      const adminPage = await admin.newPage();
      const monitorPage = await monitor.newPage();
      await signIn(monitorPage, passwordB);
      await signIn(adminPage, passwordA);

      await adminPage.goto('/platform');
      await expect(adminPage).toHaveURL(/\/platform$/);
      await monitorPage.goto('/platform');
      await expect(monitorPage).toHaveURL(/\/no-platform-access/);

      // A second tab of the monitoring session is still monitoring.
      const secondTab = await monitor.newPage();
      await secondTab.goto('/monitoring');
      await expect(secondTab.getByTestId('monitoring-session-mode')).toContainText('read-only monitoring session');
    } finally {
      await admin.close();
      await monitor.close();
    }
  });
});
