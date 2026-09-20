// Sets this process's execution switch; see enable-deletion-execution.ts.
import './enable-deletion-execution';
import { randomBytes } from 'node:crypto';
import { test, expect, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Queue, QueueEvents, Worker } from 'bullmq';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { currentTotpStep, generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { createWorkspaceUser } from '../helpers/fixtures';
import { readEnvFile } from '../helpers/isolation';
import { login, resetLoginThrottle, uniq } from './helpers';

/**
 * Account deletion, the way a person meets it: through the sign-in form, the
 * Security screen, and the real maintenance worker.
 *
 * The server side (`tests/identity/`) proves what the executor erases and keeps.
 * This proves the journey around it, with disposable synthetic accounts:
 *
 *   - a wrong password records nothing; a right one records a request, and the
 *     card says whether processing is switched on — the copy has to agree with
 *     the server, so it is asserted against the server's switch, not this
 *     process's;
 *   - withdrawing works while the request is queued, and only then: a request
 *     being processed offers no Withdraw;
 *   - a workspace's primary administrator is told it is blocked and why, and
 *     once that is transferred the request goes through;
 *   - an account with an authenticator must give a fresh code;
 *   - the real BullMQ worker erases a requested account, after which the
 *     session that asked is gone and the password no longer signs in.
 *
 * The same journey runs once on a desktop viewport and once under a phone
 * viewport with the mobile shell's user agent: the web layer the Android/iOS
 * app renders. That is browser evidence for the mobile journey, not device
 * evidence — a phone still has to install the shell and repeat it.
 */
type Variant = { name: string; options: Parameters<Browser['newContext']>[0] };
const variants: Variant[] = [
  { name: 'desktop', options: {} },
  {
    name: 'phone (mobile shell web layer)',
    options: { ...devices['Pixel 7'], userAgent: `${devices['Pixel 7'].userAgent} YouhanOneApp/0.1.0-dev-poc` },
  },
];

/**
 * What the server was started with; the copy on the card describes that switch.
 * Read from the file the application reads, so a developer's `.env` and the CI
 * server agree with the assertion. `E2E_DELETION_SERVER_EXECUTION` overrides it
 * for a server attached through `APP_URL` that was started from somewhere else.
 */
const serverExecutionEnabled =
  (process.env.E2E_DELETION_SERVER_EXECUTION ??
    readEnvFile(process.env.E2E_APP_ENV_FILE ?? '.env').ACCOUNT_DELETION_EXECUTION_ENABLED) === 'true';
const HELD = 'Account deletion processing is not yet switched on';
const SHORTLY = 'We aim to complete eligible requests within 24 hours';
const REFUSED = 'That email and password combination did not work.';

test.describe.configure({ mode: 'serial' });

for (const variant of variants) {
  test.describe(`Account deletion journey — ${variant.name}`, () => {
    const run = uniq();
    const slug = `del-${run}`;
    const password = `Del-${randomBytes(9).toString('base64url')}-Aa1`;
    const owned = new Set<string>();
    let tenantId = '';
    let memberRoleId = '';
    let adminRoleId = '';
    let worker: Worker | undefined;
    let queue: Queue | undefined;
    let events: QueueEvents | undefined;

    const at = (path: string) => `/${slug}${path}`;
    const securityPage = at('/profile/security');
    const email = (label: string) => `${label}.${run}@deletion.test`;

    /** A synthetic member with a real password, ready to sign in. */
    async function member(label: string, opts: { admin?: boolean; primaryAdmin?: boolean; mfaSecret?: string } = {}) {
      const address = email(label);
      const user = await createWorkspaceUser({
        tenantId,
        roleId: opts.admin ? adminRoleId : memberRoleId,
        email: address,
        fullName: `${label} ${run}`,
      });
      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { salesUserId: user.id },
        select: { id: true, platformUserId: true },
      });
      owned.add(membership.platformUserId);
      await prisma.platformUser.update({
        where: { id: membership.platformUserId },
        data: {
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
          ...(opts.mfaSecret ? { mfaEnabled: true, mfaSecret: encryptSecret(opts.mfaSecret) } : {}),
        },
      });
      if (opts.primaryAdmin) {
        await prisma.workspaceMembership.update({ where: { id: membership.id }, data: { isPrimaryAdmin: true } });
      }
      return { email: address, platformUserId: membership.platformUserId, membershipId: membership.id };
    }

    async function open(browser: Browser, address: string): Promise<{ context: BrowserContext; page: Page }> {
      const context = await browser.newContext(variant.options);
      const page = await context.newPage();
      await login(page, address, password);
      await page.goto(securityPage);
      await expect(page.getByRole('heading', { name: 'Delete my account' })).toBeVisible({ timeout: 60_000 });
      return { context, page };
    }

    const deleteForm = (page: Page) => ({
      password: page.getByLabel('Your password', { exact: true }),
      code: page.getByLabel('Authenticator code', { exact: true }),
      reason: page.getByLabel('Reason (optional)', { exact: true }),
      confirm: page.getByLabel('Type DELETE to confirm', { exact: true }),
      submit: page.getByRole('button', { name: 'Delete my account' }),
      withdraw: page.getByRole('button', { name: 'Withdraw my request' }),
      badNote: page.locator('.lf-security__note[data-bad="true"]'),
      note: page.locator('.lf-security__note'),
    });

    async function submitDeletion(page: Page, pw: string, opts: { code?: string; reason?: string } = {}) {
      const form = deleteForm(page);
      await form.password.fill(pw);
      if (opts.code !== undefined) await form.code.fill(opts.code);
      if (opts.reason !== undefined) await form.reason.fill(opts.reason);
      await form.confirm.fill('DELETE');
      await form.submit.click();
    }

    const requestFor = (platformUserId: string) =>
      prisma.accountDeletionRequest.findMany({ where: { platformUserId }, orderBy: { requestedAt: 'desc' } });

    /** The job the scheduler would add, scoped to one account, consumed by the real worker. */
    async function erase(platformUserId: string) {
      const job = await queue!.add(
        'account-deletions',
        { platformUserIds: [platformUserId] },
        { removeOnComplete: true, removeOnFail: true },
      );
      const result = (await job.waitUntilFinished(events!, 120_000)) as { completed: number; disabled: boolean };
      expect(
        result.disabled,
        'the job was consumed by a worker with execution off — stop `npm run worker` and rerun',
      ).toBe(false);
      return result;
    }

    async function signInRefused(browser: Browser, address: string) {
      const context = await browser.newContext(variant.options);
      const page = await context.newPage();
      await resetLoginThrottle();
      await page.goto('/login');
      await page.getByLabel('Email').fill(address);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      // The generic refusal: nothing says the account was erased.
      // Filtered by text: Next's route announcer is a second, empty role="alert".
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: 60_000 });
      await expect(page).toHaveURL(/\/login/);
      await context.close();
    }

    test.beforeAll(async () => {
      const tenant = await prisma.tenant.create({
        data: { slug, legalName: `Deletion ${run} LLC`, displayName: `Deletion ${run}`, status: 'ACTIVE' },
      });
      tenantId = tenant.id;
      await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
      memberRoleId = (await prisma.role.create({ data: { tenantId, key: `member-${run}`, name: 'Member', rank: 60 } }))
        .id;
      adminRoleId = (await prisma.role.create({ data: { tenantId, key: `admin-${run}`, name: 'Admin', rank: 10 } })).id;

      // The real consumer, on the queue the scheduler feeds. Unlike the vitest twin,
      // this cannot move to a Redis index of its own — the server shares the index and
      // its rate limits live there — so it refuses to run where schedulers are armed:
      // their retention and unscoped deletion jobs would run in this process, with
      // execution on. A stray consumer (`npm run worker`) cannot be told apart from the
      // server's own producer connections by name; it shows up instead as the job
      // coming back `disabled`, which `erase` reports.
      //
      // CI runs `npm run worker` for the whole suite (with execution on) and says so
      // with E2E_DELETION_WORKER=external: then that worker is the consumer, none is
      // started here, and the schedulers it armed are its own to run.
      const { Queue: QueueCtor, QueueEvents: QueueEventsCtor } = await import('bullmq');
      const { redis } = await import('@/lib/redis');
      queue = new QueueCtor('maintenance', { connection: redis });
      const qe = new QueueEventsCtor('maintenance', { connection: redis });
      await qe.waitUntilReady();
      events = qe;
      if (process.env.E2E_DELETION_WORKER === 'external') return;
      expect(
        await queue.getJobSchedulers(),
        'job schedulers are armed on this Redis index; the in-process worker would run them with execution on',
      ).toEqual([]);
      const { startMaintenanceWorker } = await import('@/workers/maintenance');
      const w = startMaintenanceWorker();
      await w.waitUntilReady();
      worker = w;
    });

    test.afterAll(async () => {
      await worker?.close();
      await queue?.close();
      await events?.close();
      const ids = [...owned];
      await prisma.accountDeletionRequest.deleteMany({ where: { platformUserId: { in: ids } } }).catch(() => {});
      if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      // Erased identities have their email cleared, so the tagged teardown cannot find
      // them by address — removed by id here, with the erasure audit rows that name them.
      for (const id of ids) {
        await prisma.platformAuditEvent
          .deleteMany({ where: { event: 'ACCOUNT_ERASED', metadata: { path: ['platformUserId'], equals: id } } })
          .catch(() => {});
      }
      await prisma.platformUser.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    });

    test('a wrong password records nothing; the right one records a held request that can be withdrawn', async ({
      browser,
    }) => {
      const person = await member('member');
      const { context, page } = await open(browser, person.email);
      const form = deleteForm(page);

      if (variant.name.startsWith('phone')) {
        // The screen the shell renders has to fit the phone it renders on.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
      }
      // Said before the form, not after: what goes, what stays.
      await expect(page.getByText('Some things are kept and are not removed by this request')).toBeVisible();
      await expect(page.getByText(serverExecutionEnabled ? SHORTLY : HELD)).toBeVisible();

      // The button is inert until the confirmation word is typed.
      await form.password.fill(password);
      await expect(form.submit).toBeDisabled();

      await submitDeletion(page, `${password}-wrong`);
      await expect(form.badNote).toContainText('not your current password');
      await expect(form.submit).toBeVisible();
      expect(await requestFor(person.platformUserId)).toHaveLength(0);

      await submitDeletion(page, password);
      await expect(page.getByText('Your request is recorded and is queued for processing.')).toBeVisible();
      await expect(
        form.note.filter({ hasText: serverExecutionEnabled ? 'deleted shortly' : 'Recorded and held' }),
      ).toBeVisible();
      await expect(form.submit).toHaveCount(0);
      let rows = await requestFor(person.platformUserId);
      expect(rows.map((r) => r.status)).toEqual(['REQUESTED']);

      // Survives a reload: the card is read from the server, not from client state.
      await page.reload();
      await expect(form.withdraw).toBeVisible({ timeout: 60_000 });

      await form.withdraw.click();
      await expect(form.note.filter({ hasText: 'Withdrawn. Nothing has been deleted.' })).toBeVisible();
      await expect(form.submit).toBeVisible();
      rows = await requestFor(person.platformUserId);
      expect(rows.map((r) => r.status)).toEqual(['CANCELLED']);
      // Nothing was touched: the same password still signs in.
      await context.clearCookies();
      await login(page, person.email, password);
      await context.close();
    });

    test('a request being processed cannot be withdrawn', async ({ browser }) => {
      const person = await member('processing');
      const { context, page } = await open(browser, person.email);
      await submitDeletion(page, password);
      await expect(deleteForm(page).withdraw).toBeVisible();
      // What the worker's claim writes, without racing a real erasure for the screen.
      await prisma.accountDeletionRequest.updateMany({
        where: { platformUserId: person.platformUserId, status: 'REQUESTED' },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await page.reload();
      await expect(page.getByText('Your request is being processed now. It can no longer be withdrawn.')).toBeVisible({
        timeout: 60_000,
      });
      await expect(deleteForm(page).withdraw).toHaveCount(0);
      await expect(deleteForm(page).submit).toHaveCount(0);
      await context.close();
    });

    test('the primary administrator is told the request is blocked, and why; after the transfer it goes through', async ({
      browser,
    }) => {
      const admin = await member('primary', { admin: true, primaryAdmin: true });
      const { context, page } = await open(browser, admin.email);
      const form = deleteForm(page);
      await submitDeletion(page, password);
      await expect(page.getByText('Your request is recorded but cannot go ahead yet.')).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'you are the primary administrator' })).toBeVisible();
      await expect(form.note.filter({ hasText: 'cannot go ahead yet' })).toBeVisible();
      expect((await requestFor(admin.platformUserId)).map((r) => r.status)).toEqual(['BLOCKED']);

      // Blocked is not a dead end. The card says: resolve it, withdraw, ask again. The
      // transfer itself is the administrator screen's job; its effect is what matters here.
      // Handing over primary administration is not enough on its own: with nobody else
      // administering the workspace, the second rule holds the request, and says so.
      await form.withdraw.click();
      await expect(form.submit).toBeVisible();
      await prisma.workspaceMembership.update({ where: { id: admin.membershipId }, data: { isPrimaryAdmin: false } });
      await submitDeletion(page, password);
      await expect(page.getByRole('status').filter({ hasText: 'you are the last active administrator' })).toBeVisible();
      expect((await requestFor(admin.platformUserId)).map((r) => r.status)).toEqual(['BLOCKED', 'CANCELLED']);

      // Promote somebody else, withdraw, ask again — with a reason this time.
      await member('second-admin', { admin: true });
      await form.withdraw.click();
      await expect(form.submit).toBeVisible();
      await submitDeletion(page, password, { reason: `Leaving the company (${run})` });
      await expect(form.withdraw).toBeVisible();
      const rows = await requestFor(admin.platformUserId);
      expect(rows.map((r) => r.status)).toEqual(['REQUESTED', 'CANCELLED', 'CANCELLED']);
      expect(rows[0]!.reason).toBe(`Leaving the company (${run})`);

      const result = await erase(admin.platformUserId);
      expect(result).toMatchObject({ disabled: false, completed: 1 });
      expect((await requestFor(admin.platformUserId))[0]!.status).toBe('COMPLETED');
      await context.close();
      await signInRefused(browser, admin.email);
    });

    test('an account with an authenticator must give a fresh code', async ({ browser }) => {
      const secret = generateSecret();
      const person = await member('mfa', { mfaSecret: secret });
      const context = await browser.newContext(variant.options);
      const page = await context.newPage();
      await resetLoginThrottle();
      await page.goto('/login');
      await page.getByLabel('Email').fill(person.email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      const codeField = page.getByLabel('Authentication code');
      await expect(codeField).toBeVisible({ timeout: 60_000 });
      const signInStep = currentTotpStep();
      await codeField.fill(totp(secret, signInStep));
      await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });

      await page.goto(securityPage);
      const form = deleteForm(page);
      await expect(form.code).toBeVisible({ timeout: 60_000 });
      await submitDeletion(page, password, { code: '000000' });
      await expect(form.badNote).toContainText('did not match');
      expect(await requestFor(person.platformUserId)).toHaveLength(0);

      // The sign-in spent this step; replay prevention makes the person wait for the
      // next one, as their authenticator would show it.
      while (currentTotpStep() <= signInStep) await new Promise((resolve) => setTimeout(resolve, 250));
      await submitDeletion(page, password, { code: totp(secret, currentTotpStep()) });
      await expect(form.withdraw).toBeVisible();
      expect((await requestFor(person.platformUserId)).map((r) => r.status)).toEqual(['REQUESTED']);
      await context.close();
    });

    test('the real worker erases a requested account; the session ends and the password no longer signs in', async ({
      browser,
    }) => {
      const person = await member('erased');
      const { context, page } = await open(browser, person.email);
      await submitDeletion(page, password);
      await expect(deleteForm(page).withdraw).toBeVisible();

      const result = await erase(person.platformUserId);
      expect(result).toMatchObject({ disabled: false, completed: 1 });

      const [row] = await requestFor(person.platformUserId);
      expect(row?.status).toBe('COMPLETED');
      // The session this page holds was one of them: a positive control for the count below.
      expect((row?.outcome as { sessionsRevoked?: number } | null)?.sessionsRevoked).toBeGreaterThanOrEqual(1);
      const identity = await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } });
      expect(identity.deletedAt).not.toBeNull();
      expect(identity.passwordHash).toBeNull();
      expect(await prisma.platformSession.count({ where: { platformUserId: person.platformUserId } })).toBe(0);

      // The session that asked is gone: the next navigation lands on sign-in.
      await page.goto(securityPage);
      await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
      await context.close();

      await signInRefused(browser, person.email);
    });
  });
}
