/**
 * The guard that stops a write-producing suite reaching anything real.
 *
 * Every assertion below is a way a suite could have reached a real database, a
 * real inbox or a real phone, and is now a refusal. They assert *behaviour* —
 * whether a given environment is accepted or rejected, and what the operator is
 * told — not that particular identifiers exist in the source.
 *
 * Both profiles are covered, positively and negatively. `local-capture` is not
 * a relaxed `mock`: it swaps in one verified allowance and keeps every other
 * refusal, and the tests say so.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDisposableEnvironment, describeTarget } from '../helpers/isolation';

const OWNER = 'postgresql://leadflow:secret@127.0.0.1:5432/master_suite_val?schema=public';
const APP = 'postgresql://master_saas_app:secret@127.0.0.1:5432/master_suite_val?schema=public';
const REDIS = 'redis://:secret@127.0.0.1:6379/13';

const KEYS = [
  'E2E_PROFILE',
  'E2E_DATABASE_URL',
  'E2E_REDIS_URL',
  'E2E_ALLOW_UNMARKED_DATABASE',
  'DATABASE_URL',
  'REDIS_URL',
  'EMAIL_PROVIDER',
  'SMTP_HOST',
  'WHATSAPP_PROVIDER',
  'ANTIVIRUS_PROVIDER',
  'S3_ENDPOINT',
  'CLAMAV_HOST',
  'FCM_PROJECT_ID',
  'APNS_KEY',
  'META_APP_ID',
  'GEMINI_API_KEY',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  // Pin the application's own configuration in the process environment, which
  // takes precedence over the env file — so these tests describe one fixed
  // world rather than whatever .env happens to say on this machine.
  process.env.DATABASE_URL = APP;
  process.env.REDIS_URL = REDIS;
  process.env.EMAIL_PROVIDER = 'mock';
  process.env.WHATSAPP_PROVIDER = 'mock';
  process.env.ANTIVIRUS_PROVIDER = 'mock';
  process.env.S3_ENDPOINT = 'http://127.0.0.1:9000';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const guard = () => assertDisposableEnvironment({ suite: 'unit-under-test' });

/** The shape of a correctly isolated mock-profile environment. */
function isolated() {
  process.env.E2E_DATABASE_URL = OWNER;
  process.env.E2E_REDIS_URL = REDIS;
}

describe('naming the target', () => {
  it('refuses when neither target is named, and says which are missing', () => {
    expect(guard).toThrow(/E2E_DATABASE_URL and E2E_REDIS_URL are not set/);
  });

  it('refuses when only the database is named', () => {
    process.env.E2E_DATABASE_URL = OWNER;
    expect(guard).toThrow(/E2E_REDIS_URL is not set/);
  });

  it('refuses a database whose name is not marked disposable', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.DATABASE_URL = APP.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    expect(guard).toThrow(/not marked disposable/);
  });

  it('matches the disposable marker as a suffix, not a substring', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'test_leadflow_mirror');
    process.env.DATABASE_URL = APP.replace('master_suite_val', 'test_leadflow_mirror');
    process.env.E2E_REDIS_URL = REDIS;
    expect(guard).toThrow(/not marked disposable/);
  });

  it('treats the override as waiving one check, not all of them', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    process.env.E2E_ALLOW_UNMARKED_DATABASE = 'yes';
    // Name accepted; it now fails on the *next* rule instead of passing.
    expect(guard).toThrow(/different databases/);
  });
});

describe('fixtures and the application must agree', () => {
  it('refuses when they point at different databases', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'somewhere_else_test');
    process.env.E2E_REDIS_URL = REDIS;
    expect(guard).toThrow(/different databases/);
  });

  it('refuses when fixtures use the restricted application role', () => {
    process.env.E2E_DATABASE_URL = APP;
    process.env.E2E_REDIS_URL = REDIS;
    expect(guard).toThrow(/both connecting as "master_saas_app"/);
  });

  it('refuses when they use different Redis logical databases', () => {
    isolated();
    process.env.E2E_REDIS_URL = REDIS.replace('/13', '/14');
    expect(guard).toThrow(/different Redis databases/);
  });

  it('refuses a non-local Redis', () => {
    isolated();
    process.env.REDIS_URL = 'redis://:secret@redis.example.com:6379/13';
    process.env.E2E_REDIS_URL = 'redis://:secret@redis.example.com:6379/13';
    expect(guard).toThrow(/not local/);
  });

  it('honours precedence: a real environment variable beats the env file', () => {
    isolated();
    // The application is pointed elsewhere by the environment. Reading only the
    // file would miss this entirely.
    process.env.DATABASE_URL = APP.replace('master_suite_val', 'elsewhere_test');
    expect(guard).toThrow(/different databases/);
  });
});

describe('the mock profile', () => {
  it('accepts a correctly isolated environment', () => {
    isolated();
    const targets = guard();
    expect(targets.profile).toBe('mock');
    expect(targets.databaseUrl).toBe(OWNER);
  });

  it('refuses a sending email provider', () => {
    isolated();
    process.env.EMAIL_PROVIDER = 'smtp';
    expect(guard).toThrow(/live provider is configured.*EMAIL_PROVIDER/s);
  });

  it('refuses a live WhatsApp provider', () => {
    isolated();
    process.env.WHATSAPP_PROVIDER = 'meta';
    expect(guard).toThrow(/live provider is configured.*WHATSAPP_PROVIDER/s);
  });

  it('refuses a live antivirus provider', () => {
    isolated();
    process.env.ANTIVIRUS_PROVIDER = 'clamav';
    expect(guard).toThrow(/live provider is configured.*ANTIVIRUS_PROVIDER/s);
  });
});

describe('the local-capture profile', () => {
  it('accepts SMTP pointed at a loopback capture service', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    const targets = guard();
    expect(targets.profile).toBe('local-capture');
  });

  it('refuses SMTP pointed anywhere but loopback', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'smtp.sendgrid.net';
    expect(guard).toThrow(/not a loopback address/);
  });

  /**
   * Production mode cannot use `mock` — the startup check refuses to boot with
   * one — so the other providers carry real names here. Each is permitted only
   * where it is provably inert, and the proof lives in the other assertions:
   * Meta credentials must be empty, and no CONNECTED integration row may exist.
   */
  it('permits `meta` WhatsApp only while no Meta credential is present', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.WHATSAPP_PROVIDER = 'meta';
    expect(guard).not.toThrow();

    process.env.META_APP_ID = 'a-real-looking-app-id';
    expect(guard).toThrow(/Meta/);
  });

  it('permits `clamav` only while the scanner is local', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.ANTIVIRUS_PROVIDER = 'clamav';
    expect(guard).not.toThrow();

    process.env.CLAMAV_HOST = 'scanner.example.com';
    expect(guard).toThrow(/not a loopback address/);
  });

  it('still refuses a provider it cannot prove inert', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.WHATSAPP_PROVIDER = 'twilio';
    expect(guard).toThrow(/live provider is configured.*WHATSAPP_PROVIDER/s);
  });

  it('refuses an email provider that is neither mock nor smtp', () => {
    isolated();
    process.env.E2E_PROFILE = 'local-capture';
    process.env.EMAIL_PROVIDER = 'ses';
    expect(guard).toThrow(/only sending provider permitted/);
  });

  it('refuses an unknown profile rather than falling back', () => {
    isolated();
    process.env.E2E_PROFILE = 'production';
    expect(guard).toThrow(/is not a profile/);
  });
});

describe('channels with no provider switch', () => {
  it.each([
    ['FCM_PROJECT_ID', 'push (FCM)'],
    ['APNS_KEY', 'push (APNs)'],
    ['META_APP_ID', 'Meta'],
    ['GEMINI_API_KEY', 'AI (Gemini)'],
  ])('refuses when %s is populated', (key, channel) => {
    isolated();
    process.env[key] = 'a-real-looking-credential';
    expect(guard).toThrow(new RegExp(channel.replace(/[()]/g, '\\$&')));
  });
});

describe('object storage', () => {
  it('refuses a non-local S3 endpoint', () => {
    isolated();
    process.env.S3_ENDPOINT = 'https://s3.eu-west-1.amazonaws.com';
    expect(guard).toThrow(/not local/);
  });
});

describe('credentials never appear in a message', () => {
  it('reduces a connection string to host, port and name', () => {
    expect(describeTarget(OWNER)).toBe('127.0.0.1:5432/master_suite_val');
    expect(describeTarget('not a url')).toBe('<unparseable>');
  });

  it('keeps the password out of every refusal', () => {
    process.env.E2E_DATABASE_URL = OWNER.replace('master_suite_val', 'leadflow');
    process.env.DATABASE_URL = APP.replace('master_suite_val', 'leadflow');
    process.env.E2E_REDIS_URL = REDIS;
    let message = '';
    try {
      guard();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('secret');
    expect(message).not.toContain('leadflow:');
  });
});
