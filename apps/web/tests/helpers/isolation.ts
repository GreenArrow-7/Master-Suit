/**
 * The gate every write-producing suite passes before it writes anything.
 *
 * ── What this is defending against ──────────────────────────────────────────
 *
 * Three different accidents, all of which have happened here or nearly did:
 *
 *   1. A suite reaching a real database because a connection string defaulted.
 *      `tests/server/*.spec.ts` used to fall back to the developer's own
 *      `leadflow`, and during the 2026-09-10 baseline they wrote to it.
 *   2. A suite reaching a real *recipient* — an invitation to a live inbox, a
 *      WhatsApp template to a real number — because a provider was configured.
 *   3. A suite believing it is isolated because two connection strings carry
 *      different usernames, when the roles behind them have the same powers.
 *      A username is a label; `rolbypassrls` is the fact.
 *
 * ── Two profiles, named explicitly ──────────────────────────────────────────
 *
 *   mock            every provider is `mock`. Nothing leaves the process.
 *   local-capture   the application really sends, over a real protocol, to a
 *                   capture service on this machine that has nowhere to forward
 *                   to. This is what production-mode testing needs, and it is
 *                   not the same thing as a delivery provider.
 *
 * The profile is declared, never inferred. `local-capture` is not a relaxation
 * of `mock` — it swaps one specific, verified allowance in and keeps every other
 * refusal exactly as it was.
 *
 * ── Split sync/async, deliberately ──────────────────────────────────────────
 *
 * `assertDisposableEnvironment` is synchronous and does no I/O, so a spec can
 * call it at module scope before it constructs a client. `assertRuntimeIsolation`
 * needs to ask the database and Redis what they actually are, so it is async and
 * runs once from a global setup, before any spec is loaded.
 *
 * Nothing here ever prints a credential: `describeTarget` reduces a connection
 * string to `host:port/name`, and that is what every message carries.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type TestProfile = 'mock' | 'local-capture';

/** `host:port/name` — never the credentials. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '').split('?')[0];
    return `${parsed.host}${name ? `/${name}` : ''}`;
  } catch {
    return '<unparseable>';
  }
}

const part = (url: string, pick: (u: URL) => string): string => {
  try {
    return pick(new URL(url));
  } catch {
    return '';
  }
};

const databaseName = (url: string) => decodeURIComponent(part(url, (u) => u.pathname.replace(/^\//, '').split('?')[0]));
const username = (url: string) => decodeURIComponent(part(url, (u) => u.username));
const hostname = (url: string) => part(url, (u) => u.hostname);
const port = (url: string) => part(url, (u) => u.port);
/** Redis addresses the logical database in the path: redis://host:port/14 */
const redisDb = (url: string) => part(url, (u) => u.pathname.replace(/^\//, '')) || '0';

/**
 * A name that says "throwing this away is expected".
 *
 * A suffix, not a substring: `leadflow_test` is disposable and
 * `test_leadflow_mirror` is not, and a substring match cannot tell them apart.
 *
 * This is an **accidental-target safeguard, not proof of safety**. It stops a
 * mistyped or inherited connection string; it says nothing about whether the
 * database is precious. The role and provider checks below are what carry the
 * real weight.
 */
const DISPOSABLE = /[_-](test|val|ci|e2e|scratch|tmp)\d*$/i;

/** Loopback only. A capture service that is not on this machine is a network service. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const OVERRIDE = 'E2E_ALLOW_UNMARKED_DATABASE';

export class UnsafeTestEnvironment extends Error {
  constructor(message: string) {
    super(`\n\nRefusing to run: the test environment is not provably isolated.\n\n${message}\n`);
    this.name = 'UnsafeTestEnvironment';
  }
}

/** An env file as the *application* will read it. */
export function readEnvFile(file: string): Record<string, string> {
  const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!existsSync(full)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * What the application under test will actually use for a key.
 *
 * Precedence matters and is easy to get backwards. A real process environment
 * variable beats an env file, because that is what `--env-file` and a shell
 * export do: the file fills gaps, the environment overrides. Reading only the
 * file would let an exported `DATABASE_URL` point the server somewhere this
 * guard never inspected.
 */
export function effective(key: string, file: Record<string, string>): string | undefined {
  return process.env[key] ?? file[key];
}

export interface IsolationOptions {
  /**
   * The env file the application under test reads. `.env` for the server and
   * browser suites, whose server is started from it.
   */
  appEnvFile?: string;
  /** Suite name, for messages. */
  suite: string;
}

export interface Targets {
  profile: TestProfile;
  /** Privileged connection for fixtures. Must not be the application role. */
  databaseUrl: string;
  redisUrl: string;
  /** What the application itself will connect as. */
  appDatabaseUrl: string;
  appRedisUrl: string;
}

function resolveProfile(): TestProfile {
  const raw = (process.env.E2E_PROFILE ?? 'mock').toLowerCase();
  if (raw === 'mock' || raw === 'local-capture') return raw;
  throw new UnsafeTestEnvironment(
    `  E2E_PROFILE is "${raw}", which is not a profile.\n\n` +
      '    mock           every provider is `mock`; nothing leaves the process\n' +
      '    local-capture  the application really sends, to a verified capture\n' +
      '                   service on this machine with nowhere to forward to',
  );
}

/**
 * Providers, per profile.
 *
 * Under `mock` the rule is simple: everything is `mock`, in the env file *and*
 * in the process environment, because either one being live is enough to send.
 *
 * Under `local-capture` exactly one allowance is added — `EMAIL_PROVIDER=smtp`
 * pointed at a loopback host — and it is checked, not assumed. Every other
 * provider must still be `mock`. This is why the profile is a swap rather than a
 * relaxation: WhatsApp, antivirus and the rest do not become permissible just
 * because email did.
 */
function assertProviders(profile: TestProfile, file: Record<string, string>, suite: string) {
  const live = (key: string) => {
    const values = [file[key], process.env[key]].filter((v): v is string => v !== undefined);
    return values.some((v) => v.toLowerCase() !== 'mock');
  };

  const offenders: string[] = [];

  if (profile === 'mock') {
    offenders.push(...['WHATSAPP_PROVIDER', 'ANTIVIRUS_PROVIDER'].filter(live));
    if (live('EMAIL_PROVIDER')) offenders.unshift('EMAIL_PROVIDER');
  } else {
    /**
     * Production mode cannot use `mock` — `lib/startup-check.ts` refuses to boot
     * with one, correctly. So under this profile the other providers may carry a
     * real name, and each is permitted only where it is *provably* inert:
     *
     *   WhatsApp   `meta` needs META_APP_ID/META_APP_SECRET, which
     *              assertNoExternalCredentials requires to be empty, and a
     *              CONNECTED IntegrationConnection row, which
     *              assertRuntimeIsolation requires not to exist. With neither,
     *              the provider cannot resolve a destination.
     *   Antivirus  `clamav` scans a buffer against a daemon; it sends nothing.
     *              It still has to be local, or uploads leave the machine.
     *
     * Anything else keeps the mock requirement. This is the narrow, checked
     * allowance the profile exists for — not a blanket waiver.
     */
    const whatsapp = (effective('WHATSAPP_PROVIDER', file) ?? 'mock').toLowerCase();
    if (whatsapp !== 'mock' && whatsapp !== 'meta') offenders.push('WHATSAPP_PROVIDER');

    const antivirus = (effective('ANTIVIRUS_PROVIDER', file) ?? 'mock').toLowerCase();
    if (antivirus !== 'mock' && antivirus !== 'clamav') offenders.push('ANTIVIRUS_PROVIDER');
    if (antivirus === 'clamav') {
      const host = (effective('CLAMAV_HOST', file) ?? '127.0.0.1').trim();
      if (!LOOPBACK.has(host)) {
        throw new UnsafeTestEnvironment(
          `  CLAMAV_HOST is "${host}", which is not a loopback address.\n\n` +
            '  Uploads in these suites would be streamed to a scanner elsewhere.',
        );
      }
    }

    const provider = (effective('EMAIL_PROVIDER', file) ?? 'mock').toLowerCase();
    if (provider !== 'mock' && provider !== 'smtp') {
      throw new UnsafeTestEnvironment(
        `  EMAIL_PROVIDER is "${provider}".\n\n` +
          '  Under E2E_PROFILE=local-capture the only sending provider permitted\n' +
          '  is `smtp` pointed at a loopback capture service.',
      );
    }
    if (provider === 'smtp') {
      const host = (effective('SMTP_HOST', file) ?? '').trim();
      if (!LOOPBACK.has(host)) {
        throw new UnsafeTestEnvironment(
          `  SMTP_HOST is "${host || '(empty)'}", which is not a loopback address.\n\n` +
            '  A capture service on this machine cannot reach a real recipient. A\n' +
            '  relay somewhere else can, and that is a delivery provider however it\n' +
            '  is described. Permitted: 127.0.0.1, ::1, localhost.',
        );
      }
    }
  }

  if (offenders.length > 0) {
    throw new UnsafeTestEnvironment(
      `  A live provider is configured for the ${suite} suite: ${offenders.join(', ')}.\n\n` +
        '  These suites send invitations, resets and notifications. With a real\n' +
        '  provider those reach real inboxes and real phones.\n\n' +
        '  Checked in the env file *and* the process environment: a `mock` in the\n' +
        '  file cannot mask a provider inherited from the shell.',
    );
  }
}

/**
 * Credentials for the channels that have no `*_PROVIDER` switch.
 *
 * Telephony, push, Meta and the AI provider are enabled by *having credentials*,
 * not by a provider name, so checking provider names would miss them entirely.
 * Each of these, if populated, is a live outbound path.
 */
function assertNoExternalCredentials(file: Record<string, string>, suite: string) {
  const channels: Record<string, string[]> = {
    'push (FCM)': ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'],
    'push (APNs)': ['APNS_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID'],
    Meta: ['META_APP_ID', 'META_APP_SECRET'],
    'AI (Gemini)': ['GEMINI_API_KEY'],
  };

  const populated: string[] = [];
  for (const [channel, keys] of Object.entries(channels)) {
    const set = keys.filter((k) => (effective(k, file) ?? '').trim() !== '');
    if (set.length > 0) populated.push(`${channel}: ${set.join(', ')}`);
  }

  if (populated.length > 0) {
    throw new UnsafeTestEnvironment(
      `  Credentials for a live outbound channel are set for the ${suite} suite:\n\n` +
        populated.map((p) => `    ${p}`).join('\n') +
        '\n\n  These channels have no provider switch — holding a credential is what\n' +
        '  enables them. Clear them for the environment under test.',
    );
  }
}

/**
 * Object storage must be local too.
 *
 * An S3 endpoint pointing at a real bucket makes every upload in the suite a
 * write to real storage, and unlike a database that is not covered by any name
 * convention.
 */
function assertLocalStorage(file: Record<string, string>, suite: string) {
  const endpoint = effective('S3_ENDPOINT', file) ?? '';
  if (!endpoint) return;
  const host = hostname(endpoint);
  if (!LOOPBACK.has(host)) {
    throw new UnsafeTestEnvironment(
      `  S3_ENDPOINT for the ${suite} suite is ${describeTarget(endpoint)}, which is not local.\n\n` +
        '  Uploads in these suites would be written to real object storage.',
    );
  }
}

/**
 * Config-shape checks. Synchronous and I/O-free, so a spec can call this at
 * module scope before constructing any client.
 */
export function assertDisposableEnvironment(opts: IsolationOptions): Targets {
  const profile = resolveProfile();
  /**
   * Which env file the application under test actually reads.
   *
   * `.env` for an ordinary run. A production-mode run starts the standalone
   * server from a different file, and inspecting `.env` then would be checking
   * a configuration nothing is using — the guard would pass while the server ran
   * on something else entirely. `E2E_APP_ENV_FILE` names the real one.
   */
  const file = readEnvFile(process.env.E2E_APP_ENV_FILE ?? opts.appEnvFile ?? '.env');

  const databaseUrl = process.env.E2E_DATABASE_URL;
  const redisUrl = process.env.E2E_REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    const absent = [!databaseUrl && 'E2E_DATABASE_URL', !redisUrl && 'E2E_REDIS_URL'].filter(Boolean);
    throw new UnsafeTestEnvironment(
      `  ${absent.join(' and ')} ${absent.length > 1 ? 'are' : 'is'} not set for the ${opts.suite} suite.\n\n` +
        '  These suites write real rows, so the target is named explicitly rather\n' +
        '  than defaulted. There is no fallback: a default here once pointed at\n' +
        "  the developer's own database.\n\n" +
        '    E2E_DATABASE_URL   a disposable database, as the migration/owner role\n' +
        '    E2E_REDIS_URL      a Redis logical database reserved for tests\n\n' +
        '  See docs/TEST-ISOLATION.md.',
    );
  }

  const name = databaseName(databaseUrl);
  if (!DISPOSABLE.test(name) && process.env[OVERRIDE] !== 'yes') {
    throw new UnsafeTestEnvironment(
      `  E2E_DATABASE_URL names "${name}", which is not marked disposable.\n\n` +
        '  The name must end in _test, _val, _ci, _e2e, _scratch or _tmp. This is\n' +
        '  an accidental-target safeguard, not proof of safety — it stops a\n' +
        '  mistyped or inherited connection string and nothing more.\n\n' +
        `  If this database really is disposable, say so explicitly:\n    ${OVERRIDE}=yes`,
    );
  }

  // What the application will use, honouring precedence.
  const appDatabaseUrl = effective('DATABASE_URL', file) ?? '';
  const appRedisUrl = effective('REDIS_URL', file) ?? '';

  if (appDatabaseUrl) {
    if (describeTarget(databaseUrl) !== describeTarget(appDatabaseUrl)) {
      throw new UnsafeTestEnvironment(
        '  The fixtures and the application under test point at different databases.\n\n' +
          `    fixtures (E2E_DATABASE_URL)     ${describeTarget(databaseUrl)}\n` +
          `    application (effective)         ${describeTarget(appDatabaseUrl)}\n\n` +
          '  Every account these suites create would be invisible to the server,\n' +
          '  which shows up as a 401 on a login for an account created a moment\n' +
          '  earlier. Point both at the same disposable database.',
      );
    }
    if (username(databaseUrl) && username(databaseUrl) === username(appDatabaseUrl)) {
      throw new UnsafeTestEnvironment(
        `  Fixtures and the application are both connecting as "${username(databaseUrl)}".\n\n` +
          '  Fixtures write across tenants before any tenant context exists, which\n' +
          '  needs the BYPASSRLS migration role. The application role is\n' +
          '  NOBYPASSRLS by design, and under it row-level security matches nothing\n' +
          '  and reports success — so fixtures appear to be written and are not.',
      );
    }
  }

  if (appRedisUrl) {
    const mismatch =
      hostname(redisUrl) !== hostname(appRedisUrl) ||
      port(redisUrl) !== port(appRedisUrl) ||
      redisDb(redisUrl) !== redisDb(appRedisUrl);
    if (mismatch) {
      throw new UnsafeTestEnvironment(
        '  The fixtures and the application use different Redis databases.\n\n' +
          `    fixtures     ${hostname(redisUrl)}:${port(redisUrl)} db ${redisDb(redisUrl)}\n` +
          `    application  ${hostname(appRedisUrl)}:${port(appRedisUrl)} db ${redisDb(appRedisUrl)}\n\n` +
          '  Rate-limit counters and queues live here. Clearing one while the\n' +
          '  application reads the other makes throttling tests pass or fail at\n' +
          '  random, and makes a queue assertion meaningless.',
      );
    }
    if (!LOOPBACK.has(hostname(appRedisUrl))) {
      throw new UnsafeTestEnvironment(
        `  REDIS_URL points at ${hostname(appRedisUrl)}, which is not local.\n\n` +
          '  These suites delete keys by pattern.',
      );
    }
  }

  assertProviders(profile, file, opts.suite);
  assertNoExternalCredentials(file, opts.suite);
  assertLocalStorage(file, opts.suite);

  return { profile, databaseUrl, redisUrl, appDatabaseUrl, appRedisUrl };
}

/**
 * The checks that need to ask the running services what they actually are.
 *
 * Async, and called once from a global setup before any spec loads.
 *
 * The role check is the important one. Two different usernames prove nothing —
 * both could be superusers, or both could carry BYPASSRLS, in which case the
 * application is not restricted at all and every tenant-isolation assertion in
 * the suite is vacuous. `pg_roles` is the fact.
 */
export async function assertRuntimeIsolation(targets: Targets): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: targets.databaseUrl });
  await client.connect();
  try {
    const appRole = username(targets.appDatabaseUrl);
    const fixtureRole = username(targets.databaseUrl);
    if (!appRole) return;

    const { rows } = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1)', [[appRole, fixtureRole]]);

    const app = rows.find((r) => r.rolname === appRole);
    if (!app) {
      throw new UnsafeTestEnvironment(
        `  The application role "${appRole}" does not exist in ${describeTarget(targets.databaseUrl)}.`,
      );
    }
    if (app.rolsuper || app.rolbypassrls) {
      throw new UnsafeTestEnvironment(
        `  The application role "${appRole}" is ${app.rolsuper ? 'a SUPERUSER' : 'BYPASSRLS'}.\n\n` +
          '  Row-level security does not apply to it, so every tenant-isolation\n' +
          '  assertion in this suite would pass without proving anything. A\n' +
          '  different username from the fixture role is not enough — this is the\n' +
          '  property that matters.',
      );
    }

    // Integration connections are credentials held in the database rather than
    // the environment, so no amount of env inspection would find them. A
    // connected telephony or Meta row makes outbound calls reachable.
    const { rows: live } = await client.query<{ provider: string; n: string }>(
      // `mock` is the development vendor: it dials nothing and posts nowhere, and the
      // journey suite needs it connected to exercise the calling path.
      `SELECT provider, count(*)::text AS n FROM "IntegrationConnection"
        WHERE status = 'CONNECTED' AND provider <> 'mock' GROUP BY provider`,
    );
    if (live.length > 0) {
      throw new UnsafeTestEnvironment(
        '  The database under test holds connected integrations:\n\n' +
          live.map((r) => `    ${r.provider} × ${r.n}`).join('\n') +
          '\n\n  These are credentials stored as rows, not environment variables, so\n' +
          '  clearing the environment does not disable them. A dialer or WhatsApp\n' +
          '  action in a suite would use them.',
      );
    }
  } finally {
    await client.end();
  }
}
