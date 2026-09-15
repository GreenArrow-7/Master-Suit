import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  /**
   * Real environment wins over the dotenv files.
   *
   * `Object.assign(process.env, loadEnv(...))` had it the other way round, which
   * made a run's database depend on an untracked file rather than on what the
   * caller asked for: passing `DATABASE_URL` to the runner did nothing, and the
   * only way to point a containerised gate run at a different database was to
   * write `.env.test.local` on the host. Deleting that file mid-run is what
   * produced a 91-file "regression" that was nothing of the kind.
   *
   * This is the precedence dotenv itself uses, and CI is unaffected: the
   * workflow deliberately ships no `.env.test`, so the values still come from
   * `.env` there.
   */
  for (const [k, v] of Object.entries(loadEnv(mode, rootDir, ''))) process.env[k] ??= v;
  return {
    resolve: {
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    test: {
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      // Rate-limit buckets outlive a run and are shared by every spec that signs
      // in; without this a second run inside the 15-minute window fails on 429.
      globalSetup: ['tests/globalSetup.ts'],
      // tests/e2e is Playwright's; tests/server needs a running application and
      // has its own config (vitest.server.mts) that starts one.
      //
      // `.next-prod` is the local production build's output directory (see
      // scripts/start-local-prod.mjs). It vendors dependencies with their own
      // test suites — pino's Jest specs among them — and once anyone had run a
      // production build, `npm test` reported fifty-odd failing files that
      // belong to third-party packages.
      exclude: ['node_modules/**', 'dist/**', '.next/**', '.next-prod/**', 'tests/e2e/**', 'tests/server/**'],
    },
  };
});
