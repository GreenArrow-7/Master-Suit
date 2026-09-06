/**
 * Prisma 7 rejects an empty `shadowDatabaseUrl` (P1013). Deployments set
 * SHADOW_DATABASE_URL empty rather than unset, and `migrate deploy` never
 * needs a shadow database, so the config must omit it rather than pass ''.
 * This is the regression that broke `migrate deploy` on the production host.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const original = process.env.SHADOW_DATABASE_URL;

async function shadowUrlFor(value: string) {
  vi.resetModules();
  process.env.SHADOW_DATABASE_URL = value;
  const config = (await import('../../prisma.config')).default;
  return config.datasource?.shadowDatabaseUrl;
}

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
