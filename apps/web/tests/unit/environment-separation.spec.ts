/**
 * The demo seed must be unable to touch a shared environment, and a deployment
 * must be unable to run against another environment's database.
 *
 * The seed guards are tested by running the real script in a subprocess: the
 * gates are top-level throws, and asserting on the child's exit keeps the test
 * honest about what an operator's shell would actually see. `ALLOW_DEMO_SEED`
 * is never set here, so even a bug in every guard cannot make these runs write
 * anything — the final gate still refuses.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const appRoot = path.resolve(__dirname, '..', '..');

async function seedWith(extraEnv: Record<string, string>): Promise<string> {
  try {
    await run('npx', ['tsx', 'prisma/seed/index.ts'], {
      cwd: appRoot,
      shell: true,
      timeout: 120_000,
      env: {
        ...process.env,
        ALLOW_DEMO_SEED: '', // never let a test actually seed
        npm_lifecycle_event: '', // bypass the predb:seed preflight wrapper
        ...extraEnv,
      },
    });
    return '';
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
}

/**
 * Longer than the default because these tests shell out, and the previous
 * 30-second default was shorter than the 120 seconds `seedWith` itself allows
 * each child — so vitest could kill a test that was still legitimately waiting
 * on a subprocess it had authorised to keep running. Measured 2026-08-17: the
 * whole file takes 9.9s in isolation, roughly 2.5s per spawn, and only ever
 * failed inside a fully loaded 85-file parallel run. Contention, not a hang.
 */
describe('demo seed guards', { timeout: 150_000 }, () => {
  it('refuses when NODE_ENV is production', async () => {
    const stderr = await seedWith({ NODE_ENV: 'production' });
    expect(stderr).toContain('NODE_ENV is production');
  });

  it('refuses when APP_ENV is production or staging, whatever NODE_ENV says', async () => {
    for (const appEnv of ['production', 'staging']) {
      const stderr = await seedWith({ NODE_ENV: 'development', APP_ENV: appEnv });
      expect(stderr, appEnv).toContain(`APP_ENV is ${appEnv}`);
    }
  });

  it('refuses a database whose *name* marks it production, whatever the declarations say', async () => {
    const stderr = await seedWith({
      NODE_ENV: 'development',
      APP_ENV: 'development',
      DATABASE_URL: 'postgresql://app:x@localhost:5432/master_suite_prod',
      MIGRATION_DATABASE_URL: 'postgresql://owner:x@localhost:5432/master_suite_prod',
    });
    expect(stderr).toContain('master_suite_prod');
  });

  it('still demands explicit consent when every environment gate passes', async () => {
    const stderr = await seedWith({ NODE_ENV: 'development', APP_ENV: 'demo' });
    expect(stderr).toContain('ALLOW_DEMO_SEED=yes');
  });
});

// APP_ENV's value set is enforced by the zod enum in lib/env.ts at import time;
// that is zod's contract, not logic of ours, so it is not re-tested here. The
// boot-time cross-check of APP_ENV against the database *name* lives in
// lib/startup-check.ts and runs only under NODE_ENV=production, which a vitest
// worker is never in — it is exercised by the production-build smoke run
// documented in docs/ENVIRONMENTS.md instead.
