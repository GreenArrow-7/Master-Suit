/**
 * Prisma 7 rejects an empty `shadowDatabaseUrl` (P1013). Deployments set
 * SHADOW_DATABASE_URL empty rather than unset, and `migrate deploy` never
 * needs a shadow database, so the config must omit it rather than pass ''.
 * This is the regression that broke `migrate deploy` on the production host.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const original = process.env.SHADOW_DATABASE_URL;

async function shadowUrlFor(value: string) {
  vi.resetModules();
  process.env.SHADOW_DATABASE_URL = value;
  const config = (await import('../../prisma.config')).default;
  return config.datasource?.shadowDatabaseUrl;
}

/**
 * Resolve `prisma.config` — and through it the `prisma/config` package — once,
 * here, before anything is timed.
 *
 * ── Why (SPEC-0006, BUG-005) ─────────────────────────────────────────────────
 *
 * The first case timed out at 30s during a full-suite run. It was not asserting
 * slowly: `vi.resetModules()` plus a dynamic import made *it* pay the cold
 * resolution of a dependency, and with 152 files running in parallel that cost
 * alone exceeded the test budget. It never reproduced in isolation, because in
 * isolation nothing else is competing for the machine.
 *
 * One-time setup belongs in setup. `hookTimeout` is already 60s in
 * `vitest.config.mts` and is not raised here, no timeout is changed, and both
 * assertions below are untouched — they still call `shadowUrlFor`, which still
 * resets modules and re-imports, so each case still reads a freshly evaluated
 * config.
 */
beforeAll(async () => {
  await import('../../prisma.config');
});

afterAll(() => {
  if (original === undefined) delete process.env.SHADOW_DATABASE_URL;
  else process.env.SHADOW_DATABASE_URL = original;
});

describe('prisma.config shadowDatabaseUrl', () => {
  it('omits an empty SHADOW_DATABASE_URL instead of passing an empty string', async () => {
    expect(await shadowUrlFor('')).toBeUndefined();
  });

  it('passes a configured SHADOW_DATABASE_URL through unchanged', async () => {
    expect(await shadowUrlFor('postgresql://shadow:shadow@127.0.0.1:5432/shadow')).toBe(
      'postgresql://shadow:shadow@127.0.0.1:5432/shadow',
    );
  });
});
