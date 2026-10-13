import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';

/**
 * Measurements, not tests: tests/perf, which the unit config excludes so no CI
 * run seeds 100,000 leads. Run one case at a time against a scratch database
 * (see tests/perf/lead-list-100k.spec.ts). The base config's environment and
 * `@` alias are reused; its `test` block is replaced.
 */
export default defineConfig((env) => ({
  ...base(env),
  test: {
    include: ['tests/perf/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 60_000,
  },
}));
