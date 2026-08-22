/**
 * Asserts that row-level security still covers every tenant-owned table.
 *
 * ── Why this is a CI gate and not a code review item ────────────────────────
 *
 * Several migrations end by re-running the catalog-driven RLS sweep from
 * 20260803230000_rls_full_coverage, each carrying its own inline copy of the
 * bootstrap exclusion array and the policy body. Both have moved since:
 * 20260806000000 added FORCE ROW LEVEL SECURITY and the app.platform_admin
 * branch, and 20260807020000 moved WorkspaceInvitation into the bootstrap set.
 *
 * A migration that pastes an older copy therefore *downgrades* security across
 * every tenant table at once — dropping FORCE, so the owning role reads and
 * writes every tenant's rows again — and does it silently, because the policies
 * are still there and `\\d` still shows them. The first draft of
 * 20260808140000_hr_overtime did exactly this. It was caught only because two
 * unrelated suites happened to fail together.
 *
 * Three things had to stay in step by hand: the bootstrap array in each
 * migration, GLOBAL_UNIQUE_FIELDS in src/lib/db.ts, and the expected list in
 * tests/tenant/rls.spec.ts. This checks the database itself, which is the only
 * one of the three that cannot drift from reality.
 *
 *   node scripts/check-rls.mjs
 *
 * Exits non-zero, naming every table, if any tenant-owned table has lost its
 * policy, its RLS flag, or its FORCE flag.
 */
import { Client } from 'pg';

/**
 * Tables carrying `tenantId` that are deliberately outside RLS.
 *
 * Each is a genuine bootstrap case — the tenant is resolved *from* a hashed
 * bearer secret, so a policy would have nothing to match against — or a
 * control-plane table that is cross-tenant by design and gated by
 * requirePlatformOwner instead.
 *
 * This must match the *effective* `bootstrap` array in the RLS migrations —
 * effective because that sweep selects only tables carrying a `tenantId`, so an
 * entry naming a table without one excludes nothing and never did. It is
 * deliberately spelled out rather than derived: adding a table here is a
 * security decision, and it should be a diff somebody reviews.
 *
 * Every entry is checked against the catalog below. Four used to be inert —
 * `Session`, which is not a table at all (identity moved to PlatformSession),
 * and `PlatformUser`, `AuthenticationFactor` and `PlatformSession`, which carry
 * no `tenantId` and so were never candidates for the sweep. They are gone.
 *
 * A dead name in this list is not harmless. It is a dormant exemption: the day
 * somebody adds a model called `Session` with a `tenantId`, it is excluded from
 * row-level security by a decision nobody made, in a review nobody had. The
 * stale-entry check below is what stops that.
 */
const BOOTSTRAP = new Set([
  'APIKey',
  'IntegrationConnection',
  'PasswordResetToken',
  'RateLimitCounter',
  'WorkspaceInvitation',
  'WorkspaceMembership',
  'PlatformAuditEvent',
  // Control-plane data about platform *staff*, resolved before any tenant
  // context exists: the lookup that decides whether the actor may write is the
  // one that would have to set app.tenant_id, so a policy here would make it
  // match nothing. Reached only through requirePlatformOwner.
  'PlatformAccessGrant',
]);

const url = process.env.RLS_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('[check-rls] Set DATABASE_URL (or RLS_DATABASE_URL) to the database to check.');
  process.exit(2);
}

const client = new Client({ connectionString: url });
await client.connect();

/**
 * Every table with a `tenantId` column, and what protects it.
 *
 * Driven from the catalog rather than from a list in this file, so a table added
 * since the last release is covered the moment it exists — which is the whole
 * property the hand-kept lists could not offer.
 */
const { rows } = await client.query(`
  SELECT c.relname                                    AS table,
         c.relrowsecurity                             AS enabled,
         c.relforcerowsecurity                        AS forced,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
         -- The policy body itself, not merely its existence. A policy copied
         -- from an older migration exists, reads correctly in \\d, and is wrong.
         (SELECT string_agg(pg_get_expr(p.polqual, p.polrelid), ' | ')
            FROM pg_policy p WHERE p.polrelid = c.oid)               AS using_expr,
         (SELECT string_agg(pg_get_expr(p.polwithcheck, p.polrelid), ' | ')
            FROM pg_policy p WHERE p.polrelid = c.oid)               AS check_expr,
         -- A policy scoped TO one role does not apply to any other, which is the
         -- opposite of what tenant isolation is for.
         (SELECT bool_or(p.polroles <> '{0}')
            FROM pg_policy p WHERE p.polrelid = c.oid)               AS role_scoped
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname
     AND col.table_name = c.relname
     AND col.column_name = 'tenantId'
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
   ORDER BY c.relname
`);

const problems = [];
let covered = 0;

for (const row of rows) {
  if (BOOTSTRAP.has(row.table)) {
    // The inverse mistake, and just as bad: enabling RLS on a bootstrap table
    // breaks the lookup that resolves the tenant in the first place. An RLS'd
    // WorkspaceInvitation means every invitation link 404s.
    if (row.enabled) {
      problems.push(`${row.table}: RLS is ENABLED on a bootstrap table — the pre-tenant lookup will match nothing`);
    }
    continue;
  }

  covered += 1;
  if (!row.enabled) problems.push(`${row.table}: row-level security is not enabled`);
  else if (!row.forced) {
    problems.push(`${row.table}: RLS is enabled but not FORCED — the owning role bypasses every policy on it`);
  }
  if (Number(row.policies) === 0) {
    problems.push(`${row.table}: no policy is attached`);
    continue;
  }

  // The two clauses every tenant_isolation policy must carry. Checked as text
  // because that is what the catalog stores, and because the failure this
  // catches is literally a stale copy of the text.
  for (const [label, expression] of [
    ['USING', row.using_expr],
    ['WITH CHECK', row.check_expr],
  ]) {
    if (!expression) {
      problems.push(`${row.table}: policy has no ${label} clause`);
      continue;
    }
    if (!expression.includes('app.tenant_id')) {
      problems.push(`${row.table}: ${label} does not test app.tenant_id`);
    }
    // Without this branch withPlatformTx matches nothing on the table, so every
    // cross-tenant operation — the platform console, the retention sweep — is
    // silently blind to it. That is how HrOvertimeRequest was found.
    if (!expression.includes('app.platform_admin')) {
      problems.push(
        `${row.table}: ${label} is missing the app.platform_admin branch — withPlatformTx cannot see this table`,
      );
    }
  }

  if (row.role_scoped) {
    problems.push(`${row.table}: policy is scoped TO a role, so it does not apply to any other role`);
  }
}

/**
 * Every exemption must still be load-bearing.
 *
 * The check above validates the catalog against this list. Nothing validated
 * the list against the catalog, so an entry could name a table that had been
 * renamed, dropped, or that never carried a `tenantId` — and it would sit there
 * looking like a considered security decision. Four did.
 *
 * `rows` is already every tenantId-bearing table in the schema, which is
 * exactly the set an exemption can meaningfully apply to. Anything named here
 * and absent from it exempts nothing today and is a trap tomorrow.
 */
const present = new Set(rows.map((row) => row.table));
for (const table of BOOTSTRAP) {
  if (!present.has(table)) {
    problems.push(
      `${table}: listed as a bootstrap exemption, but no table of that name carries a tenantId. ` +
        `Either it was renamed or dropped, or it never needed exempting — remove it. ` +
        `A dormant exemption becomes a live one the day something reuses the name.`,
    );
  }
}

/** A sweep that matched nothing would otherwise pass this check silently. */
if (covered === 0) {
  problems.push('no tenant-owned tables were found at all — is this the right database, and have migrations run?');
}

await client.end();

if (problems.length > 0) {
  console.error(`\n[check-rls] Tenant isolation is not intact. ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\n  The usual cause is a migration that re-ran the catalog RLS sweep with an\n' +
      '  outdated copy of the policy body or the bootstrap list. A migration that adds\n' +
      '  tables should write a policy for those tables only — see docs/KNOWN-LIMITATIONS.md.\n',
  );
  process.exit(1);
}

console.log(
  `[check-rls] ${covered} tenant-owned tables: RLS enabled, FORCED, and policied. ${BOOTSTRAP.size} bootstrap tables exempt.`,
);
