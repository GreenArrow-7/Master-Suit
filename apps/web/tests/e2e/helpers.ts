import Redis from 'ioredis';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { totp } from '@/lib/auth/mfa';
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
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://:leadflow@localhost:6379/0', { maxRetriesPerRequest: 2 });
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
  // Self-sufficient rather than per-spec: with no trusted proxy configured the
  // whole suite shares one 'unknown' per-IP bucket (10 sign-ins / 15 min), so
  // whichever spec ran deepest in the order was the one that starved. Clearing
  // here removes the ordering coupling entirely.
  await resetLoginThrottle();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
  } catch (err) {
    // Rethrown with what the page was showing. See signInState below.
    throw new Error(`login(${email}) never left /login.\n${await signInState(page)}\n\n${(err as Error).message}`);
  }
}

/**
 * What the sign-in page was showing when the wait ran out.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `expect(page).not.toHaveURL(/\/login$/)` reports a URL and nothing else, and
 * a URL cannot distinguish the three ways this fails. That mattered: this
 * assertion failed in CI on a run whose trace could not be retrieved, and the
 * whole message was "expected not /login, received /login" — true, and no help
 * at all in deciding whether the server had refused the sign-in or simply not
 * answered yet.
 *
 * LoginForm renders a refusal into `role="alert"` (carrying the API's own
 * `detail` when there is one) and swaps its submit button between "Sign in",
 * "Signing in…" and "Verify and sign in". Between them those two say which
 * failure it was:
 *
 *   alert present            → the server answered and refused, and says why
 *   button "Signing in…"     → the POST never came back inside the timeout
 *   button "Verify and sign" → MFA was demanded for an account not expecting it
 *   neither                  → it succeeded and the client-side push did not run
 *
 * Every read is guarded. A diagnostic that throws replaces the failure it was
 * written to explain, which is worse than not having one.
 */
async function signInState(page: Page): Promise<string> {
  const safely = async (read: () => Promise<string>): Promise<string> => {
    try {
      return (await read()).trim() || '(empty)';
    } catch (err) {
      return `(could not read: ${(err as Error).message.split('\n')[0]})`;
    }
  };

  const alert = await safely(async () => {
    const found = page.getByRole('alert');
    return (await found.count()) === 0 ? '(none)' : await found.first().innerText();
  });
  const button = await safely(() => page.locator('button[type="submit"]').first().innerText());
  const url = await safely(async () => page.url());

  return `  url:    ${url}\n  alert:  ${alert}\n  button: ${button}`;
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
  await resetLoginThrottle(); // see login()
  const { email, password } = platformOwner();
  const secret = await ensureOwnerAuthenticator(email);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const code = page.getByLabel('Authentication code');
  await expect(code).toBeVisible({ timeout: 60_000 });
  // The code field auto-submits on its sixth digit; clicking "Verify and sign
  // in" afterwards raced the navigation and sometimes found the button already
  // gone. The outcome is the assertion, not the click.
  await code.fill(totp(secret, Math.floor(Date.now() / 1000 / 30)));

  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

/** Gives the owner a known authenticator, returning its base32 secret. */
async function ensureOwnerAuthenticator(email: string): Promise<string> {
  // Deterministic, not generated: spec files run in parallel workers and
  // each beforeAll passes through here. A random secret per caller rotates
  // the shared owner's authenticator underneath whichever worker is
  // mid-sign-in, and its freshly computed code stops matching. Every worker
  // writing the same value makes the update idempotent and the race harmless.
  const secret = 'E2EOWNERAUTHENTICATORSECRET23456';
  await prisma.platformUser.update({
    where: { email },
    data: {
      mfaSecret: encryptSecret(secret),
      mfaEnabled: true,
      failedLoginCount: 0,
      lockedUntil: null,
      // bootstrap-owner.mjs leaves passwordChangedAt null on purpose, and the
      // must-change gate then refuses every platform page in CI, where the
      // owner is always freshly bootstrapped. The suite's owner treats the
      // password in .env as its chosen credential, so the fixture records
      // the choice.
      passwordChangedAt: new Date(),
    },
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
  // `-tmp0`: the settling step below replaces this with spec.adminPassword.
  await field('primaryAdminPassword').fill(`${spec.adminPassword}-tmp0`);
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

  /**
   * Settle the administrator's password before handing the workspace to a spec.
   *
   * A wizard-issued credential is administrator-known, so the product forces a
   * change at first sign-in (`passwordChangedAt: null` → /profile/security).
   * That gate is correct, and the specs must model it once, here, through the
   * real endpoints — otherwise every "admin signs in and reaches the dashboard"
   * assertion lands on the change screen instead. The wizard typed
   * `<password>-tmp0`; this first sign-in replaces it with the password the
   * spec will use, in an isolated request context so the platform owner's
   * session on `page` is untouched.
   */
  const api = await page.context().browser()!.newContext();
  try {
    await resetLoginThrottle(); // this settling login spends the shared bucket too
    const login = await api.request.post('/api/v1/auth/login', {
      data: { email: spec.adminEmail, password: `${spec.adminPassword}-tmp0` },
    });
    expect(login.ok(), `settling login failed: ${login.status()}`).toBe(true);
    const change = await api.request.post(`/api/v1/workspaces/${spec.slug}/identity/self/password-change`, {
      data: { currentPassword: `${spec.adminPassword}-tmp0`, newPassword: spec.adminPassword },
    });
    expect(change.ok(), `password settle failed: ${change.status()} ${await change.text()}`).toBe(true);
  } finally {
    await api.close();
  }
  return workspaceId.trim();
}
