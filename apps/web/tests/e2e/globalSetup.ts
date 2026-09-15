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
import { assertDisposableEnvironment, assertRuntimeIsolation } from '../helpers/isolation';

export default async function globalSetup() {
  const targets = assertDisposableEnvironment({ suite: 'browser (e2e)', appEnvFile: '.env' });
  await assertRuntimeIsolation(targets);

  // Said out loud, because a guard that passes silently teaches nobody what it
  // checked — and because the profile changes what the suite is actually
  // proving. `local-capture` means mail really went over SMTP.
  console.log(`[e2e] isolation verified · profile=${targets.profile}`);
}
