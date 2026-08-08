/**
 * Proves tenant isolation at the database layer, not the application layer.
 *
 * Everything here runs over a raw pg connection as `master_saas_app` — the
 * NOBYPASSRLS role production connects as — so the application's tenant guard,
 * its Prisma extension and its session handling are all out of the picture. If
 * these pass, Postgres itself is refusing the cross-tenant access.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Never skipped.
 *
 * This used to be `describe.skipIf(!rlsUrl)`, so unsetting one environment
 * variable made the entire cross-tenant proof disappear while the run stayed
 * green — which is how "tenant isolation verified" got reported by a suite that
 * verified nothing. If the connection is not configured, that is a broken test
 * environment and it must say so.
 */
const rlsUrl = process.env.RLS_DATABASE_URL;
if (!rlsUrl) {
  throw new Error(
    'RLS_DATABASE_URL is not set, so the row-level-security proof cannot run.\n' +
      '  It must name the same NOBYPASSRLS role as DATABASE_URL — testing a role the\n' +
      '  application never connects as proves nothing. See apps/web/.env.test.',
  );
}
if (rlsUrl !== process.env.DATABASE_URL) {
  throw new Error(
    'RLS_DATABASE_URL and DATABASE_URL name different connections.\n' +
      '  This suite exists to prove the database refuses cross-tenant access for the\n' +
      '  role the application actually uses. Pointing it at a different role makes it\n' +
      `  a decoration.\n    DATABASE_URL:     ${process.env.DATABASE_URL}\n    RLS_DATABASE_URL: ${rlsUrl}`,
  );
}

const suffix = Date.now().toString(36);

// Two workspaces standing in for the acceptance scenario's named companies.
const manath = { slug: `rls-manath-${suffix}`, id: '' };
const leaders = { slug: `rls-leadersfort-${suffix}`, id: '' };

let app: Client;

/** Runs `sql` with app.tenant_id pinned to `tenantId` for that statement only. */
async function asTenant<T = any>(tenantId: string, sql: string, params: any[] = []): Promise<T[]> {
  await app.query('BEGIN');
  try {
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await app.query(sql, params);
    await app.query('COMMIT');
    return result.rows as T[];
  } catch (err) {
    await app.query('ROLLBACK');
    throw err;
  }
}

beforeAll(async () => {
  for (const workspace of [manath, leaders]) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;

    const stage = await prisma.leadStage.create({
      data: { tenantId: tenant.id, name: 'New', key: `new-${suffix}`, position: 0 },
    });
    await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        reference: `${workspace.slug}-L1`,
        fullName: `${workspace.slug} lead`,
        stageId: stage.id,
      },
    });
    await prisma.department.create({
      data: { tenantId: tenant.id, name: 'Sales', code: `SALES-${suffix}` },
    });
    await prisma.moduleEntitlement.createMany({
      data: [
        { tenantId: tenant.id, module: 'HRMS', state: 'ACTIVE' },
        { tenantId: tenant.id, module: 'SALES', state: 'ACTIVE' },
      ],
    });
  }

  app = new Client({ connectionString: rlsUrl });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  for (const workspace of [manath, leaders]) {
    if (workspace.id) await prisma.tenant.delete({ where: { id: workspace.id } }).catch(() => {});
  }
});

describe('postgres row-level security', () => {
  it('connects as a role that cannot bypass RLS', async () => {
    const [row] = (await app.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)).rows;
    expect(row.rolbypassrls).toBe(false);
    expect(row.rolsuper).toBe(false);
  });

  it('returns nothing when no tenant context is set — the policy fails closed', async () => {
    const { rows } = await app.query('SELECT count(*)::int AS count FROM "Lead"');
    expect(rows[0].count).toBe(0);
  });

  it('shows a workspace its own rows', async () => {
    const rows = await asTenant(manath.id, 'SELECT id FROM "Lead"');
    expect(rows).toHaveLength(1);
  });

  it('blocks a cross-workspace read even with an explicit tenantId filter', async () => {
    const rows = await asTenant(manath.id, 'SELECT id FROM "Lead" WHERE "tenantId" = $1', [leaders.id]);
    expect(rows).toHaveLength(0);
  });

  it('blocks Manath Homes from reading Leadersfort employees data', async () => {
    const rows = await asTenant(manath.id, 'SELECT id FROM "Department" WHERE "tenantId" = $1', [leaders.id]);
    expect(rows).toHaveLength(0);
  });

  it('blocks Leadersfort from reading Manath Homes leads', async () => {
    const rows = await asTenant(leaders.id, 'SELECT id FROM "Lead" WHERE "tenantId" = $1', [manath.id]);
    expect(rows).toHaveLength(0);
  });

  it('blocks a cross-workspace update', async () => {
    const rows = await asTenant(manath.id, 'UPDATE "Lead" SET "fullName" = $1 WHERE "tenantId" = $2 RETURNING id', [
      'hijacked',
      leaders.id,
    ]);
    expect(rows).toHaveLength(0);

    const untouched = await prisma.lead.findFirst({ where: { tenantId: leaders.id } });
    expect(untouched?.fullName).not.toBe('hijacked');
  });

  it('blocks a cross-workspace delete', async () => {
    const rows = await asTenant(manath.id, 'DELETE FROM "Lead" WHERE "tenantId" = $1 RETURNING id', [leaders.id]);
    expect(rows).toHaveLength(0);
    expect(await prisma.lead.count({ where: { tenantId: leaders.id } })).toBe(1);
  });

  it('rejects an insert that claims another workspace (WITH CHECK)', async () => {
    await expect(
      asTenant(manath.id, 'INSERT INTO "HrHoliday" (id, "tenantId", name, "holidayDate") VALUES ($1, $2, $3, NOW())', [
        `rls-${suffix}`,
        leaders.id,
        'Planted',
      ]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('covers every tenant-owned table except the documented bootstrap set', async () => {
    const { rows } = await app.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND NOT t.rowsecurity
      ORDER BY 1
    `);
    // These are reached before a tenant is known (bearer-secret lookups) or are
    // cross-tenant control-plane tables gated by requirePlatformOwner instead.
    // AuthenticationFactor and PlatformSession are absent because they carry no
    // tenantId at all — they hang off the platform user, not a workspace.
    //
    // AIAnalysis, CallAudit, Recording, RecordingConsent and Transcript were on
    // this list and are not any more (20260808200000_rls_call_intelligence).
    // They were never bootstrap cases: `callId` is a cuid, not a bearer secret,
    // and every caller already knew the tenant. Being here made recordings and
    // transcripts of client conversations the least protected rows in the
    // database. If one reappears, a `findUnique({ where: { callId } })` has been
    // reintroduced somewhere and this test is the thing that says so.
    expect(rows.map((r: any) => r.table_name)).toEqual(
      [
        'APIKey',
        // A telephony vendor posts to a URL knowing nothing about workspaces, so
        // the key in that URL is the only thing that can resolve the tenant.
        'IntegrationConnection',
        'PasswordResetToken',
        'PlatformAuditEvent',
        'RateLimitCounter',
        // 'Session' was here until migration 20260808120000 dropped the table.
        // Redeemed by someone not signed in, before any tenant is known — the
        // same category as PasswordResetToken. What guards it instead is that the
        // token is stored hashed and every administrative read is tenant-scoped.
        'WorkspaceInvitation',
        'WorkspaceMembership',
      ].sort(),
    );
  });
});

/**
 * The pin, not just the policy.
 *
 * RLS being correct is only half of it: the application must actually tell
 * Postgres which tenant it is acting for. When it does not, reads succeed and
 * simply return nothing — no error, no 403, just empty relations.
 *
 * That failure mode shipped: requireWorkspace loads the workspace by primary key
 * and pulls moduleEntitlements and subscription through it, but the pin only
 * looked for a `tenantId` filter and a Tenant row is keyed by `id`. The includes
 * came back empty, the UI read that as "no modules entitled", and the People
 * module disappeared from the sidebar for every workspace.
 *
 * The rest of the suite connects as the owner role, which bypasses RLS and so
 * cannot see any of this. These cases connect as the application role on purpose.
 */
describe('tenant pinning as the application role', () => {
  it('returns no entitlements for a Tenant read that is not pinned', async () => {
    const { rows } = await app.query(`SELECT count(*)::int AS count FROM "ModuleEntitlement" WHERE "tenantId" = $1`, [
      manath.id,
    ]);
    expect(rows[0].count).toBe(0);
  });

  it('returns the entitlements once the tenant is pinned', async () => {
    const rows = await asTenant(manath.id, 'SELECT module FROM "ModuleEntitlement" WHERE "tenantId" = $1', [manath.id]);
    expect(rows.map((r: any) => r.module).sort()).toEqual(['HRMS', 'SALES']);
  });

  it('reads every tenant when acting as platform admin', async () => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.platform_admin', 'on', true)`);
      const { rows } = await app.query(
        `SELECT count(DISTINCT "tenantId")::int AS tenants FROM "ModuleEntitlement" WHERE "tenantId" = ANY($1)`,
        [[manath.id, leaders.id]],
      );
      // The platform console lists every workspace; without this it showed each
      // one as having no modules and no employees.
      expect(rows[0].tenants).toBe(2);
    } finally {
      await app.query('ROLLBACK');
    }
  });
});
