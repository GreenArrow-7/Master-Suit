import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, rootDir, ''));
  return {
    resolve: {
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    test: {
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      // tests/e2e is Playwright's; tests/server needs a running application and
      // has its own config (vitest.server.mts) that starts one.
      exclude: ['node_modules/**', 'dist/**', '.next/**', 'tests/e2e/**', 'tests/server/**'],
    },
  };
});
