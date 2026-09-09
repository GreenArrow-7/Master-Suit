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

/**
 * One reading of `APP_URL`, used by both places that care.
 *
 * `baseURL` below tests it with `??`, which accepts an empty string as a URL;
 * the `webServer` block at the foot tests it for truthiness. With
 * `APP_URL=` set to empty those two disagree — a server starts on 3000 while
 * every request is made against `''`. Normalising once here means the config
 * cannot hold two opinions about whether an external server exists, and it
 * makes `APP_URL=` mean "there isn't one", which is the only sensible reading.
 */
const APP_URL = process.env.APP_URL || undefined;

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
  /**
   * `html` in CI, and it is the reporter that makes a CI failure diagnosable.
   *
   * `github` writes inline annotations and `list` writes the log, and neither
   * survives contact with a runner whose log cannot be read back — which is the
   * position anyone debugging this suite from outside GitHub's web UI is in.
   * The HTML reporter writes a self-contained `playwright-report/` with the
   * traces and screenshots `use` already retains on failure copied into it, and
   * ci.yml uploads that directory as an artifact when the E2E step fails.
   *
   * `open: 'never'` because the reporter otherwise tries to spawn a browser at
   * the end of a failing run. It does not in CI, but a developer who exports
   * CI=1 to reproduce a CI-only failure would get one.
   */
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: APP_URL ?? 'http://localhost:3000',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * CONV-009. The gate watches the server this config actually starts.
   *
   * It used to gate on `APP_URL ?? localhost:3000` while unconditionally
   * running `npm run dev`, which binds 3000. With `APP_URL` set to another
   * port — as `.env` does — the gate waited 180 seconds for a server the
   * command it had just run was never going to bind, then failed with a
   * message naming neither port.
   *
   * The comment here already described the right behaviour: with `APP_URL`
   * set, attach to that server rather than spawning one. Only the code did
   * not. So `webServer` is now omitted entirely in that case, which is what
   * "attach" means to Playwright, and the gate and the command can no longer
   * disagree about a port because there is only one of them.
   *
   * CI sets no `APP_URL`, so it still starts its own server and gates on it.
   */
  ...(APP_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          // Gate on the server this block starts, and nothing else.
          url: 'http://localhost:3000/login',
          // Locally, attach to the server the developer already has running. In
          // CI there is never one, and silently reusing a stale process would
          // test the wrong build.
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      }),
});
