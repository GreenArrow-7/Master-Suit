/**
 * The guard that stops the server suites reaching a real database.
 *
 * These assertions are the reason the guard is trustworthy: each one is a way
 * the old code could reach the developer's own `leadflow` database, and each is
 * now a refusal. They assert *behaviour* — that a given environment is accepted
 * or rejected, and what the operator is told — not that particular identifiers
 * exist in the source.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDisposableEnvironment, describeTarget } from '../server/environment';

const OWNER = 'postgresql://leadflow:secret@127.0.0.1:5432/master_suite_val?schema=public';
const APP = 'postgresql://master_saas_app:secret@127.0.0.1:5432/master_suite_val?schema=public';
const REDIS = 'redis://:secret@127.0.0.1:6379/14';

const KEYS = [
  'E2E_DATABASE_URL',
  'E2E_REDIS_URL',
  'E2E_ALLOW_UNMARKED_DATABASE',
  'EMAIL_PROVIDER',
  'WHATSAPP_PROVIDER',
  'ANTIVIRUS_PROVIDER',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/**
 * The suites read `.env` to learn what the server will use. Every case below
 * assumes that file names `master_suite_val` as the application database, which
 * is what the validation environment sets up. Skipped rather than failed
 * elsewhere: this is an assertion about the guard, not about anyone's `.env`.
 */
const envMatches = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const text = require('node:fs').readFileSync('.env', 'utf8') as string;
    return /^DATABASE_URL=.*\/master_suite_val\b/m.test(text);
  } catch {
    return false;
  }
};

describe('the server-suite environment guard', () => {
  it('refuses when neither target is named, and says which are missing', () => {
    expect(() => assertDisposableEnvironment()).toThrow(/E2E_DATABASE_URL and E2E_REDIS_URL are not set/);
  });

  it('refuses when only the database is named', () => {
    process.env.E2E_DATABASE_URL = OWNER;
    expect(() => assertDisposableEnvironment()).toThrow(/E2E_REDIS_URL is not set/);
  });

  it('refuses a database whose name is not marked disposable', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    expect(() => assertDisposableEnvironment()).toThrow(/not marked disposable/);
  });

  it('matches the disposable marker as a suffix, not a substring', () => {
    // The dangerous shape: "test" appears, but the database is a production mirror.
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'test_leadflow_mirror');
    process.env.E2E_REDIS_URL = REDIS;
    expect(() => assertDisposableEnvironment()).toThrow(/not marked disposable/);
  });

  it('accepts an unmarked database only when the override is explicit', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    process.env.E2E_ALLOW_UNMARKED_DATABASE = 'yes';
    // The name rule is satisfied by the override; it then fails on the *next*
    // rule (fixtures and server disagree), which is the point — the override
    // waives one check, not all of them.
    expect(() => assertDisposableEnvironment()).toThrow(/different databases/);
  });

  it('refuses when fixtures and the server point at different databases', () => {
    if (!envMatches()) return;
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'somewhere_else_test');
    process.env.E2E_REDIS_URL = REDIS;
    expect(() => assertDisposableEnvironment()).toThrow(/different databases/);
  });

  it('refuses when fixtures use the restricted application role', () => {
    if (!envMatches()) return;
    process.env.E2E_DATABASE_URL = APP;
    process.env.E2E_REDIS_URL = REDIS;
    expect(() => assertDisposableEnvironment()).toThrow(/both connecting as "master_saas_app"/);
  });

  it('refuses when a provider could reach a real recipient', () => {
    if (!envMatches()) return;
    process.env.E2E_DATABASE_URL = OWNER;
    process.env.E2E_REDIS_URL = REDIS;
    process.env.EMAIL_PROVIDER = 'smtp';
    expect(() => assertDisposableEnvironment()).toThrow(/live provider is configured: EMAIL_PROVIDER/);
  });

  it('accepts a correctly isolated environment', () => {
    if (!envMatches()) return;
    process.env.E2E_DATABASE_URL = OWNER;
    process.env.E2E_REDIS_URL = REDIS;
    const targets = assertDisposableEnvironment();
    expect(targets.databaseUrl).toBe(OWNER);
    expect(targets.redisUrl).toBe(REDIS);
  });

  it('never puts credentials in a message', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    let message = '';
    try {
      assertDisposableEnvironment();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('secret');
    expect(message).not.toContain('leadflow:');
  });

  it('reduces a connection string to host, port and database', () => {
    expect(describeTarget(OWNER)).toBe('127.0.0.1:5432/master_suite_val');
    expect(describeTarget('not a url')).toBe('<unparseable>');
  });
});
