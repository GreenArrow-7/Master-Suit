import { env, mockProviders } from './env';
import { parseCidrList } from './security/cidr';

/**
 * Node-only startup gate, in its own module so the Edge bundle never parses it.
 *
 * `instrumentation.ts` is compiled for every runtime Next supports, and a static
 * reference to `process.stderr`/`process.exit` there is flagged as unsupported
 * in Edge even when it is guarded at runtime. Reaching it through a dynamic
 * import keeps the check where it belongs and the build warning-free.
 */
export async function assertProductionConfiguration() {
  assertEnvironmentSeparation();
  if (env.NODE_ENV !== 'production') return;

  const mocked = mockProviders(process.env as Record<string, string>);
  if (mocked.length > 0) {
    fatal(
      'Refusing to start in production with mock providers configured:\n' +
        mocked.map((key) => `  ${key}=mock`).join('\n') +
        '\nA mock provider accepts what the real one would reject. Configure real ' +
        'credentials, or run this build with NODE_ENV=development.',
    );
  }

  assertProxyConfiguration();
  await assertRowLevelSecurityApplies();
}

/**
 * The demo/staging/production axis, cross-checked against the database.
 *
 * APP_ENV declares which environment this deployment IS; the database name is
 * physical evidence of which environment it is wired TO. When they disagree,
 * someone has pasted the wrong connection string, and the cheapest possible
 * moment to say so is before the process serves a request — after that, the
 * mistake looks like customer data in the demo or demo personas in production.
 *
 * The convention checked is a suffix marker in the database name
 * (`master_suite_demo`, `leadflow_staging`, …). A name carrying no marker is
 * allowed anywhere except production, where an unmarked name is only accepted
 * alongside an explicit APP_ENV=production — production is declared, never
 * inferred.
 */
function assertEnvironmentSeparation() {
  const dbName = databaseName(env.DATABASE_URL);
  const markers: Record<string, RegExp> = {
    test: /[_-]test\d*$/i,
    demo: /[_-]demo\d*$/i,
    staging: /[_-](staging|stage)\d*$/i,
    production: /[_-](prod|production)\d*$/i,
  };

  // A production build must say which environment it is. The default exists so
  // a laptop needs no ceremony; a deployment gets no such pass.
  if (env.NODE_ENV === 'production' && process.env.APP_ENV === undefined) {
    fatal(
      'Refusing to start: this is a production build but APP_ENV is not set.\n' +
        '  Declare which environment this deployment is:\n' +
        '    APP_ENV=production | staging | demo\n' +
        '  Environment separation (demo data never in production, separate secrets per\n' +
        '  environment) hangs off this declaration. See docs/ENVIRONMENTS.md.',
    );
  }

  // The database wired to this process must not belong to a different
  // environment. Both directions matter: production pointed at the demo
  // database serves fake customers, and demo pointed at production leaks and
  // mutates real ones.
  for (const [environment, marker] of Object.entries(markers)) {
    if (marker.test(dbName) && env.APP_ENV !== environment) {
      fatal(
        `Refusing to start: APP_ENV is "${env.APP_ENV}" but DATABASE_URL points at "${dbName}",\n` +
          `  which is named as a ${environment} database. One of the two is wrong.\n` +
          '  Fix the connection string or the declaration — never run one environment\n' +
          "  against another's database. See docs/ENVIRONMENTS.md.",
      );
    }
  }
}

/** The database name out of a postgres URL, without believing the URL parses. */
function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '');
  } catch {
    return '';
  }
}

/**
 * A rate limiter that cannot identify the client is not a rate limiter.
 *
 * With no trusted proxies configured, every request behind a load balancer
 * resolved to the same address, so the whole platform shared one login bucket —
 * ten attempts per five minutes, for everyone — and every audit row recorded
 * the same useless source. It looked configured, which is worse than absent.
 */
function assertProxyConfiguration() {
  const raw = env.TRUSTED_PROXY_CIDRS.trim();
  if (!raw) {
    fatal(
      'Refusing to start: TRUSTED_PROXY_CIDRS is empty.\n' +
        '  Set it to the CIDRs of the proxies in front of this server, e.g.\n' +
        '    TRUSTED_PROXY_CIDRS=10.0.0.0/8,172.16.0.0/12\n' +
        '  If nothing sits in front of it, say so explicitly with "none".',
    );
  }
  if (raw.toLowerCase() === 'none') {
    /**
     * "none" is a legitimate answer in development, and an unshippable one.
     *
     * Nothing in a Next route handler exposes the peer address, so with no
     * declared proxy `clientIp` has no trustworthy source and returns null.
     * Every sign-in then shares one rate-limit bucket keyed `unknown`, which an
     * attacker can exhaust to lock out the entire platform, and every audit row
     * records `unknown` as the source.
     *
     * Believing `x-real-ip` instead — what this used to do — is worse: the
     * client picks its own identity and rotates it at will.
     *
     * So a production deployment must sit behind a proxy it can name.
     */
    fatal(
      'Refusing to start: TRUSTED_PROXY_CIDRS is "none" in production.\n' +
        '  Nothing exposes the peer address to the application, so with no proxy declared\n' +
        '  no request can be attributed to a client: per-IP rate limiting collapses into a\n' +
        '  single shared bucket and every audit row records "unknown".\n' +
        '  Put a reverse proxy in front of this server, ensure it sets X-Forwarded-For, and\n' +
        '  name its addresses, e.g.\n' +
        '    TRUSTED_PROXY_CIDRS=10.0.0.0/8,172.16.0.0/12\n' +
        '  The application must not be reachable except through that proxy — a direct route\n' +
        '  to it lets a caller forge the header.',
    );
  }

  try {
    parseCidrList(raw);
  } catch (error) {
    fatal(`Refusing to start: TRUSTED_PROXY_CIDRS is not parseable — ${(error as Error).message}`);
  }
}

/**
 * Row-level security is only a control if the connecting role is subject to it.
 *
 * Two ways it silently is not, both of which were true of this application
 * before 20260806000000:
 *
 *   - the role has BYPASSRLS, so policies never run;
 *   - the role owns the tables, and the tables are not FORCE ROW LEVEL SECURITY,
 *     which grants the owner the same bypass without any role attribute saying so.
 *
 * Either produces a server that looks isolated and is not. Checked at boot
 * rather than documented, because the failure is invisible in normal operation
 * and only shows up as one customer reading another's data.
 */
async function assertRowLevelSecurityApplies() {
  // The migration role owns the tables and can drop a policy. If the runtime is
  // handed the same string, every check below passes for the wrong reason.
  if (env.MIGRATION_DATABASE_URL && env.MIGRATION_DATABASE_URL === env.DATABASE_URL) {
    fatal(
      'Refusing to start: DATABASE_URL and MIGRATION_DATABASE_URL are the same connection.\n' +
        '  The application must connect as the NOBYPASSRLS role; the owning role is for migrations only.',
    );
  }

  const { prisma } = await import('./db');

  const [role] = await prisma.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
    SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
  `;
  if (!role) fatal(`Refusing to start: current_user is not a role this database knows.`);
  if (role.rolsuper) {
    fatal('Refusing to start: the database role is a superuser, which bypasses row-level security.');
  }
  if (role.rolbypassrls) {
    fatal(
      'Refusing to start: the database role has BYPASSRLS, so tenant isolation policies never run.\n' +
        '  Point DATABASE_URL at the application role (master_saas_app) and keep the owning role\n' +
        '  for MIGRATION_DATABASE_URL only.',
    );
  }

  // Tables this role owns that are not forced. Ownership is the quiet bypass:
  // no role attribute reveals it, and `\d` shows the policy as if it applied.
  const unforced = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
      AND pg_get_userbyid(c.relowner) = current_user
    LIMIT 5
  `;
  if (unforced.length > 0) {
    fatal(
      'Refusing to start: this role owns tables with row-level security enabled but not FORCED,\n' +
        "  so it reads and writes every tenant's rows regardless of policy. Affected (first 5):\n" +
        unforced.map((row) => `    ${row.tablename}`).join('\n'),
    );
  }
}

/**
 * Exit rather than throw.
 *
 * Next catches a rejection from the instrumentation hook, logs it as an
 * unhandledRejection, and leaves the process running with the port already
 * bound — so a misconfigured server keeps answering, and an orchestrator's
 * restart-on-crash never triggers. A refusal has to actually stop the process.
 */
function fatal(message: string): never {
  process.stderr.write(`\n[startup] ${message}\n\n`);
  process.exit(1);
}
