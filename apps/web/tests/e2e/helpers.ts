import Redis from 'ioredis';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { RUN_TAG } from './run-tag';

/**
 * Clears the login rate-limit counters.
 *
 * Every request in this suite comes from one address, and the limiter allows ten
 * sign-ins per address per fifteen minutes — a deliberate figure that must not be
 * raised to accommodate a test. The scenarios legitimately sign in many times, so
 * the counters are reset between spec files exactly as the database rows are: the
 * limiter itself is untouched, and tests/security/ratelimit.spec.ts is what
 * proves it still refuses.
 *
 * Call from `test.beforeAll` in each spec file.
 */
export async function resetLoginThrottle() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { maxRetriesPerRequest: 2 });
  try {
    /**
     * `rl:` is the prefix lib/security/ratelimit.ts puts on every bucket.
     *
     * Password reset is cleared alongside login because the suite legitimately
     * exhausts it: the limit is 20 per IP per hour, every spec runs from
     * localhost, and password-reset.spec spends two of them per run. Roughly ten
     * runs into an hour the reset was silently throttled — the endpoint answers
     * the same either way, deliberately — and the spec failed with "no email
     * captured", which reads like a mailer fault rather than a spent budget.
     *
     * The limiter itself is untouched. tests/security/ratelimit.spec.ts is what
     * proves it still refuses.
     */
    const keys = await redis.keys('rl:login:*');
    const resets = await redis.keys('rl:pwreset:*');
    const all = [...keys, ...resets];
    if (all.length > 0) await redis.del(...all);
  } finally {
    redis.disconnect();
  }
}

/**
 * A short suffix unique to this run.
 *
 * Specs create workspaces, users and employees in a database they share with
 * development data and with each other. Every name and slug they invent carries
 * this, so a second run never collides with the first and a failed run leaves
 * evidence that can be told apart from the next one's.
 */
export const uniq = () => `${Math.random().toString(36).slice(2, 8)}${RUN_TAG}`;

/** Long enough for the workspace password policy (12+, upper, lower, number). */
export const strongPassword = (seed: string) => `E2e-${seed}-Aa1${'x'.repeat(4)}`;

export function platformOwner() {
  const email = process.env.PLATFORM_OWNER_EMAIL;
  const password = process.env.PLATFORM_OWNER_PASSWORD;
  if (!email || !password) {
    // Loud, not skipped: a suite that quietly does nothing is worse than a
    // suite that fails.
    throw new Error(
      'PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD must be set for the end-to-end suite.\n' +
        'They live in apps/web/.env — run `npm run secrets` to create it from .env.example.',
    );
  }
  return { email, password };
}

/**
 * Signs in through the real form.
 *
 * Deliberately not an API call with a cookie injected: the login form is itself
 * under test in every spec that calls this, and a helper that bypassed it would
 * hide a broken sign-in behind twenty passing assertions.
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/**
 * Signs in as the platform owner, second factor included.
 *
 * Platform staff now require MFA — they read across every customer workspace, so
 * a password alone no longer resolves a platform context. The seeded owner has
 * no authenticator, so this gives it one (a real secret, encrypted with the
 * application's own helper, written straight to the database as test setup) and
 * then signs in with a live TOTP code.
 *
 * Nothing here relaxes the check: the sign-in goes through the ordinary form and
 * the ordinary endpoint, and the code is verified server-side like any other.
 */
export async function loginPlatformOwner(page: Page) {
  const { email, password } = platformOwner();
  const secret = await ensureOwnerAuthenticator(email);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const code = page.getByLabel('Authentication code');
  await expect(code).toBeVisible({ timeout: 60_000 });
  await code.fill(totp(secret, Math.floor(Date.now() / 1000 / 30)));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();

  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

/** Gives the owner a known authenticator, returning its base32 secret. */
async function ensureOwnerAuthenticator(email: string): Promise<string> {
  const secret = generateSecret();
  await prisma.platformUser.update({
    where: { email },
    data: { mfaSecret: encryptSecret(secret), mfaEnabled: true, failedLoginCount: 0, lockedUntil: null },
  });
  return secret;
}

/** Reads the mock mailer's outbox. See src/app/api/v1/dev/outbox/route.ts. */
export async function lastMailTo(request: APIRequestContext, to: string) {
  const res = await request.get(`/api/v1/dev/outbox?to=${encodeURIComponent(to)}`);
  expect(res.status(), `no email captured for ${to}`).toBe(200);
  return (await res.json()) as { to: string; subject: string; body: string };
}

/** Pulls the single-use link out of an email body. */
export function linkFrom(body: string, path: string): string {
  const match = new RegExp(`https?://\\S*${path}\\?token=[^\\s<>"']+`).exec(body);
  if (!match) throw new Error(`No ${path} link in the email body:\n${body}`);
  return match[0];
}

export interface NewWorkspace {
  displayName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  modules: ('SALES' | 'HRMS')[];
}

/**
 * Drives the five-step platform wizard and returns the workspace id it reports.
 *
 * That id is the whole point of the acceptance scenario: the same value has to
 * appear on the HR side of the workspace afterwards, which is what proves HR and
 * Sales are two modules of one tenant rather than two systems side by side.
 */
export async function createWorkspaceViaWizard(page: Page, spec: NewWorkspace): Promise<string> {
  await page.goto('/platform/workspaces/new');

  /**
   * Located by `name`, not by label.
   *
   * The wizard's Field component renders its hint inside the <label>, so the
   * accessible name of the slug input is "Workspace slug Lowercase letters,
   * numbers and hyphens." — an exact label match never finds it, and a loose one
   * is ambiguous between "Workspace name" and "Workspace slug". This is setup
   * code for the specs, not the thing under test, so it takes the stable route.
   */
  const field = (name: string) => page.locator(`[name="${name}"]`);

  // Step 1 — company details
  await field('workspaceName').fill(spec.displayName);
  await field('displayName').fill(spec.displayName);
  await field('legalName').fill(`${spec.displayName} LLC`);
  await field('slug').fill(spec.slug);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2 — administrator
  await field('primaryAdminName').fill(spec.adminName);
  await field('primaryAdminEmail').fill(spec.adminEmail);
  await field('primaryAdminPassword').fill(spec.adminPassword);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3 — subscription and limits (defaults are valid)
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 4 — modules. Both boxes start checked; uncheck what this spec excludes.
  for (const value of ['SALES', 'HRMS'] as const) {
    const box = page.locator(`input[name="enabledModules"][value="${value}"]`);
    if (spec.modules.includes(value)) await box.check();
    else await box.uncheck();
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 5 — review and create
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Workspace created' })).toBeVisible({ timeout: 60_000 });
  const workspaceId = await page
    .getByRole('row', { name: /Workspace ID/ })
    .locator('td')
    .innerText();
  expect(workspaceId.trim()).not.toBe('');
  return workspaceId.trim();
}
