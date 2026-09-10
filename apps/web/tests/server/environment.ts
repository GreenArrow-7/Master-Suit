/**
 * The gate the server suites pass before they are allowed to write anything.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * `session-lifecycle.spec.ts` and `unified-saas.spec.ts` used to open their own
 * Prisma client like this:
 *
 *     process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:…@localhost/leadflow'
 *
 * That default is the database a developer runs the product against. With the
 * variable unset — which is the normal case, because nothing asked for it — the
 * specs created and deleted rows in it. During the 2026-09-10 baseline they did
 * exactly that; the specs' own `afterAll` cleaned up and no residue was left, but
 * "the cleanup happened to work" is not a control. A test suite must not be able
 * to reach a real database at all, and a silent fallback is how it does.
 *
 * So there is no fallback here. An unset variable is a refusal.
 *
 * ── What it checks, and why each one ────────────────────────────────────────
 *
 *  1. Both targets are named explicitly. No default, no guess.
 *  2. The database name is marked disposable. A suite that truncates tables
 *     should not be one typo away from a database called `leadflow`.
 *  3. The fixture connection and the running server point at the *same*
 *     database. They must, or fixtures land in one place and the server reads
 *     another — which surfaces as "wrong password" on an account that was
 *     created a moment earlier, and cost the best part of a day to diagnose.
 *  4. The fixture role is *not* the application role. Fixtures create rows
 *     across tenants before any tenant context exists, which needs BYPASSRLS;
 *     the application role is NOBYPASSRLS on purpose. Using the application
 *     role here does not error — row-level security simply matches nothing and
 *     reports success, so `findFirst` returns null and the suite fails somewhere
 *     unrelated.
 *  5. No provider can reach a real recipient. Mail, WhatsApp and antivirus must
 *     all be `mock` before a suite is allowed to send anything.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * Nothing here prints a connection string. `describe()` reduces a URL to
 * `host:port/database`, which is what every message below carries, because a
 * failing test's output is pasted into issues and chat windows.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** `host:port/database` — never the credentials. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '').split('?')[0];
    return `${parsed.host}${database ? `/${database}` : ''}`;
  } catch {
    return '<unparseable>';
  }
}

function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '');
  } catch {
    return '';
  }
}

function username(url: string): string {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return '';
  }
}

/**
 * A name that says "throwing this away is expected".
 *
 * Deliberately a suffix rather than a substring: `leadflow_test` is disposable,
 * `test_leadflow_production_mirror` is not, and a substring match cannot tell
 * them apart.
 */
const DISPOSABLE = /[_-](test|val|ci|e2e|scratch|tmp)\d*$/i;

/**
 * The escape hatch, and it is deliberately awkward.
 *
 * Somebody will one day have a disposable database with a name this rule does
 * not like. Setting this says so out loud, in the command that runs the suite,
 * where a reviewer can see it — rather than the rule being loosened for
 * everyone.
 */
const OVERRIDE = 'E2E_ALLOW_UNMARKED_DATABASE';

class UnsafeTestEnvironment extends Error {
  constructor(message: string) {
    super(`\n\nRefusing to run the server suites.\n\n${message}\n`);
    this.name = 'UnsafeTestEnvironment';
  }
}

/** `.env` as the *server* will read it — see globalSetup's `serverEnv()`. */
function serverEnvFile(): Record<string, string> {
  const file = path.join(process.cwd(), '.env');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
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

export interface TestTargets {
  /** Privileged connection for fixtures. BYPASSRLS; never the application role. */
  databaseUrl: string;
  redisUrl: string;
}

/**
 * Throws unless every condition above holds. Call it before opening a client,
 * not after — the point is that nothing is created anywhere first.
 */
export function assertDisposableEnvironment(): TestTargets {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  const redisUrl = process.env.E2E_REDIS_URL;

  if (!databaseUrl || !redisUrl) {
    const absent = [!databaseUrl && 'E2E_DATABASE_URL', !redisUrl && 'E2E_REDIS_URL'].filter(Boolean);
    throw new UnsafeTestEnvironment(
      `  ${absent.join(' and ')} ${absent.length > 1 ? 'are' : 'is'} not set.\n\n` +
        '  These suites drive a real server and write real rows, so the target is\n' +
        '  named explicitly rather than defaulted. There is no fallback: a default\n' +
        "  here once pointed at the developer's own database.\n\n" +
        '    E2E_DATABASE_URL   a disposable database, as the migration/owner role\n' +
        '    E2E_REDIS_URL      a Redis database reserved for tests\n\n' +
        '  See docs/TEST-ISOLATION.md.',
    );
  }

  const name = databaseName(databaseUrl);
  if (!DISPOSABLE.test(name) && process.env[OVERRIDE] !== 'yes') {
    throw new UnsafeTestEnvironment(
      `  E2E_DATABASE_URL names "${name}", which is not marked disposable.\n\n` +
        '  These suites create and delete rows. The name must end in one of\n' +
        '  _test, _val, _ci, _e2e, _scratch or _tmp so that a mistyped or\n' +
        '  inherited connection string cannot quietly point at a real database.\n\n' +
        `  If this database really is disposable, say so explicitly:\n    ${OVERRIDE}=yes`,
    );
  }

  const server = serverEnvFile();
  const serverDatabaseUrl = server.DATABASE_URL;
  if (serverDatabaseUrl) {
    const fixture = describeTarget(databaseUrl);
    const running = describeTarget(serverDatabaseUrl);
    if (fixture !== running) {
      throw new UnsafeTestEnvironment(
        '  The fixtures and the server under test point at different databases.\n\n' +
          `    fixtures (E2E_DATABASE_URL)  ${fixture}\n` +
          `    server   (.env DATABASE_URL) ${running}\n\n` +
          '  Every account these suites create would be invisible to the server,\n' +
          '  which shows up as a 401 on a login for an account created a moment\n' +
          '  earlier. Point both at the same disposable database.',
      );
    }

    // Same database, and that is required — but not the same role.
    if (username(databaseUrl) && username(databaseUrl) === username(serverDatabaseUrl)) {
      throw new UnsafeTestEnvironment(
        `  Fixtures and the application are both connecting as "${username(databaseUrl)}".\n\n` +
          '  Fixtures write across tenants before any tenant context exists, which\n' +
          '  needs the BYPASSRLS migration role. The application role is\n' +
          '  NOBYPASSRLS by design, and under it row-level security matches nothing\n' +
          '  and reports success — so fixtures appear to be written and are not.\n\n' +
          '  Use the migration/owner role for E2E_DATABASE_URL.',
      );
    }
  }

  /**
   * Either source being live is enough to refuse.
   *
   * `.env` is what the server reads and `process.env` is what this process
   * reads, and both can send: the server mails an invitation, a spec could
   * construct a transport of its own. Taking the *riskier* of the two is the
   * safe direction to be wrong in — the alternative lets a mock in `.env` mask
   * a real provider inherited from the shell.
   */
  const live = (['EMAIL_PROVIDER', 'WHATSAPP_PROVIDER', 'ANTIVIRUS_PROVIDER'] as const).filter((key) =>
    [server[key], process.env[key]].some((value) => value !== undefined && value.toLowerCase() !== 'mock'),
  );
  if (live.length > 0) {
    throw new UnsafeTestEnvironment(
      `  A live provider is configured: ${live.join(', ')}.\n\n` +
        '  These suites send invitations and password resets. With a real provider\n' +
        '  those reach real inboxes and real phones. Set each to `mock` for the\n' +
        '  environment under test.',
    );
  }

  return { databaseUrl, redisUrl };
}
