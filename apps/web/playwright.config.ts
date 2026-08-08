import { defineConfig, devices } from '@playwright/test';

// The suite signs in as the platform owner, whose credentials live in .env
// alongside DATABASE_URL. Playwright is launched by npx, not by `node
// --env-file`, so nothing else loads them.
try {
  process.loadEnvFile('.env');
} catch {
  // Absent in a fresh checkout. globalSetup throws a readable error instead.
}

/**
 * One marker for the whole run, set before any worker starts.
 *
 * Every workspace and account the suite creates carries it, and globalTeardown
 * deletes exactly those. Without it the suite left ~6 workspaces behind per run.
 */
process.env.E2E_RUN_TAG ??= `e2e${Date.now().toString(36)}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/globalTeardown.ts',

  /**
   * One worker, no parallelism.
   *
   * Every spec drives the same Postgres database. Two workers creating
   * workspaces concurrently would interleave inside the platform-owner audit
   * trail and the shared rate-limit buckets, and a failure would be
   * unreproducible. The suite is minutes long, not hours; serial is the honest
   * trade.
   */
  workers: 1,
  fullyParallel: false,

  /**
   * No retries, in CI either.
   *
   * A retry turns an intermittent failure into a green run with a note nobody
   * reads. If a spec here is flaky, that is a defect in the spec or in the app,
   * and it should stay visible until one of them is fixed.
   */
  retries: 0,

  // Against the dev server a cold route compiles on first request, which can
  // take ten seconds or more. These are generous for that reason, not because
  // anything is expected to be slow once warm.
  timeout: 180_000,
  expect: { timeout: 20_000 },

  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    // Locally, attach to the server the developer already has running. In CI
    // there is never one, and silently reusing a stale process would test the
    // wrong build.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
