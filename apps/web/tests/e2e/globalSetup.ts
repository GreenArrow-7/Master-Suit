/**
 * The browser suite's isolation gate.
 *
 * This suite creates workspaces, invites people, sends password resets and
 * clears rate-limit counters by pattern. It writes to the database the
 * *application* is configured with — `.env` `DATABASE_URL` — and until now
 * nothing checked what that was. `docs/TEST-ISOLATION.md` said as much:
 * "there is no equivalent guard yet, and that gap is tracked". This closes it.
 *
 * Runs before any spec, and before `globalTeardown` can delete anything: a
 * teardown that deletes by `RUN_TAG` is only safe if the database it is pointed
 * at was the intended one in the first place.
 *
 * The rules are the shared ones in `tests/helpers/isolation.ts`, so the browser
 * and server suites cannot drift apart on what "isolated" means.
 */
import { request } from '@playwright/test';
import { assertDisposableEnvironment, assertRuntimeIsolation } from '../helpers/isolation';

export default async function globalSetup() {
  const targets = assertDisposableEnvironment({ suite: 'browser (e2e)' });
  await assertRuntimeIsolation(targets);

  // Said out loud, because a guard that passes silently teaches nobody what it
  // checked — and because the profile changes what the suite is actually
  // proving. `local-capture` means mail really went over SMTP.
  console.log(`[e2e] isolation verified · profile=${targets.profile}`);

  await assertDeepRoutesServed();
}

/**
 * The server knows its deepest routes before any spec runs.
 *
 * `next dev` up to 16.3 could publish a route table taken halfway through its
 * first scan of src/app and keep it for the whole run (vercel/next.js#97897,
 * fixed in 16.4.0 by #97920). Every route 7 or more folders deep then answered
 * Next's HTML 404, and 48 specs failed on a password change instead of one
 * clear error (CI on 8 and 18 Oct). Unauthenticated GETs with a made-up slug:
 * a known route answers JSON 401; only an unmatched one answers HTML 404.
 */
async function assertDeepRoutesServed() {
  const api = await request.newContext({
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    ignoreHTTPSErrors: process.env.E2E_ALLOW_UNTRUSTED_TLS === 'yes',
  });
  try {
    for (const path of [
      '/api/v1/workspaces/route-probe/identity/account-create', // 6 folders deep
      '/api/v1/workspaces/route-probe/identity/self/password-change', // 7
      '/api/v1/workspaces/route-probe/hr/payroll/route-probe/wps', // 8
    ]) {
      const res = await api.get(path);
      if (res.status() === 404 && (res.headers()['content-type'] ?? '').includes('text/html')) {
        throw new Error(
          `The server started without its route for ${path} (Next.js dev route discovery). Re-run the job.`,
        );
      }
    }
  } finally {
    await api.dispose();
  }
}
