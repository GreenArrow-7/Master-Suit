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

  /**
   * A budget for compilation, not for the application.
   *
   * These specs run against `next dev`, where a route is compiled on its first
   * request. That cost roughly doubled — 13-22s per route, measured — when every
   * tenant-scoped model gained its `tenant` relation: the generated Prisma
   * client grew and every route that touches it takes longer to compile.
   *
   * The whole-suite specs are single serial tests that walk a dozen pages, so
   * they were the first to run out of budget: `acceptance` and `hr-modules`
   * began failing at whatever step the clock happened to reach, which reads like
   * a broken page rather than a spent timer.
   *
   * Raised rather than retried. Nothing here is expected to be slow once warm,
   * and a production build compiles ahead of time — this is the dev harness
   * paying for type surface, not the product being slower.
   */
  timeout: 420_000,
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
    // Gate on the server the suite will actually talk to. With APP_URL set
    // (a developer pointing the suite at a production build on another port)
    // the gate attaches to that server and never spawns a dev server of its
    // own — a run must not depend on whatever happens to occupy port 3000.
    url: `${process.env.APP_URL ?? 'http://localhost:3000'}/login`,
    // Locally, attach to the server the developer already has running. In CI
    // there is never one, and silently reusing a stale process would test the
    // wrong build.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
