import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Baseline-validation diagnostics. NOT part of any CI gate.
 *
 * These files are named `*.diag.ts` rather than `*.spec.ts` precisely so the
 * default vitest include (`**\/*.{test,spec}.*`) cannot pick them up: the
 * baseline `npm test` result must stay exactly what it was before this branch
 * existed. Run them on their own:
 *
 *   npx vitest run --config vitest.diagnostic.mts
 *
 * Each assertion states the behaviour a reviewer would expect. A FAILING
 * assertion here is the evidence for a finding, not a broken test.
 */
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, rootDir, ''));
  return {
    resolve: { alias: { '@': path.resolve(rootDir, 'src') } },
    test: {
      globals: true,
      include: ['tests/diagnostic/**/*.diag.ts'],
      testTimeout: 60_000,
      hookTimeout: 120_000,
      fileParallelism: false,
    },
  };
});
