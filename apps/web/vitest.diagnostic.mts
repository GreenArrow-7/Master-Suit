import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';

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
 *
 * The base config's environment and `@` alias are reused; its `test` block is
 * replaced, not merged.
 */
export default defineConfig((env) => ({
  ...base(env),
  test: {
    globals: true,
    include: ['tests/diagnostic/**/*.diag.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
}));
