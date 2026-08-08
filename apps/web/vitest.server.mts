import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The integration specs that need the application running.
 *
 * Separate from vitest.config.mts because these own a server: `globalSetup`
 * starts one on a free port, waits for it to answer, and stops it again whether
 * the run passes or fails. The unit config excludes this directory, so
 * `npm test` stays fast and needs no infrastructure beyond Postgres and Redis.
 */
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, rootDir, ''));
  return {
    resolve: {
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    test: {
      globals: true,
      include: ['tests/server/**/*.spec.ts'],
      globalSetup: ['tests/server/globalSetup.ts'],
      // One file at a time: both specs sign in repeatedly against one server and
      // share the login rate-limit buckets.
      fileParallelism: false,
      testTimeout: 60_000,
      // Starting the application is inside the setup budget.
      hookTimeout: 240_000,
    },
  };
});
