/**
 * SPEC-0008 revision 3 — where the database does NOT protect a demo tenant.
 *
 * ── Why this file exists, and why it is not another RLS suite ────────────────
 *
 * `tests/tenant/rls.spec.ts` already proves the database refuses cross-tenant
 * reads, writes, deletes and WITH CHECK inserts, as `master_saas_app`, the
 * NOBYPASSRLS role production connects as. `tests/tenant/pooling.spec.ts`
 * already proves the pinned tenant is transaction-local and does not leak
 * across interleaved use of one pool. Repeating either here would add
 * confidence about a layer that is already covered and none about the layer
 * that is not.
 *
 * The proposal in SPEC-0008 revision 3 puts a *public* login into the
 * deployment that serves customers. That does not weaken row-level security —
 * it changes who stands on the far side of the surfaces row-level security was
 * never applied to:
 *
 *   - seven BOOTSTRAP tables that carry `tenantId` and are deliberately exempt
 *     from the policy sweep (scripts/check-rls.mjs);
 *   - seventeen GLOBAL_MODELS (src/lib/db.ts), most of which carry no
 *     `tenantId` at all, so no policy could ever have applied to them.
 *
 * For those, application authorization is the whole boundary. This file
 * *characterises that*, at the database layer, as `master_saas_app`. Several
 * cases below deliberately assert that a cross-tenant read SUCCEEDS — which is
 * the correct, expected result today, and is exactly the point. They document
 * the boundary the application must therefore hold on its own, so that
 * SPEC-0008's `ST-D4`, `ST-D5` and `ST-D14`-`ST-D16` are written against a
 * measured baseline rather than an assumption.
 *
 * ── Read the assertions carefully ───────────────────────────────────────────
 *
 * A test here that flips from "reachable" to "not reachable" is not a
 * regression. It means someone brought that table under RLS, which would be an
 * improvement, and the assertion should be updated deliberately rather than
 * loosened.
 *
 * Nothing here tests the demo policy: no demo policy exists yet. SPEC-0008 is
 * at READY_FOR_PLAN with gates 3 and 5 unrecorded, and no product code has been
 * written. This is R2 test-only work against a disposable local database.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

/** Same refusal-to-skip reasoning as tests/tenant/rls.spec.ts. */
const rlsUrl = process.env.RLS_DATABASE_URL;
if (!rlsUrl) {
  throw new Error(
    'RLS_DATABASE_URL is not set, so the demo-tenant boundary characterisation cannot run.\n' +
      '  It must name the same NOBYPASSRLS role as DATABASE_URL. See apps/web/.env.test.',
  );
}
if (rlsUrl !== process.env.DATABASE_URL) {
  throw new Error('RLS_DATABASE_URL and DATABASE_URL name different connections; this proves nothing.');
}

const suffix = Date.now().toString(36);

/**
 * Three fixtures, which is the shape SPEC-0008 asks for: two customers and a
 * demo. The third is what makes "a demo tenant cannot reach a customer" a
 * different question from "tenant A cannot reach tenant B".
 */
const customerA = { slug: `bnd-cust-a-${suffix}`, id: '' };
const customerB = { slug: `bnd-cust-b-${suffix}`, id: '' };
const demo = { slug: `bnd-demo-${suffix}`, id: '' };
const all = [customerA, customerB, demo];

let app: Client;
const platformUserIds: string[] = [];

/** Runs `sql` with `app.tenant_id` pinned for that statement only. */
async function asTenant<T = unknown>(tenantId: string, sql: string, params: unknown[] = []): Promise<T[]> {
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
  for (const workspace of all) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;

    // One integration connection per tenant, holding a distinguishable secret.
    // IntegrationConnection is in the BOOTSTRAP exemption set, so no policy
    // applies to it — that is what the cases below measure.
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        provider: `prov-${workspace.slug}`,
        status: 'CONNECTED',
        credentials: { marker: `secret-of-${workspace.slug}` },
      },
    });

    // A platform identity with a membership, so WorkspaceMembership has
    // something real to be read across.
    const pu = await prisma.platformUser.create({
      data: {
        email: `${workspace.slug}@example.test`,
        normalizedEmail: `${workspace.slug}@example.test`,
        fullName: `${workspace.slug} member`,
        platformRole: 'USER',
        status: 'ACTIVE',
      },
    });
    platformUserIds.push(pu.id);
    await prisma.workspaceMembership.create({
      data: { tenantId: tenant.id, platformUserId: pu.id, status: 'ACTIVE' },
    });
  }

  app = new Client({ connectionString: rlsUrl });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  for (const workspace of all) {
    if (workspace.id) await prisma.tenant.delete({ where: { id: workspace.id } }).catch(() => {});
  }
  for (const id of platformUserIds) {
    await prisma.platformUser.delete({ where: { id } }).catch(() => {});
  }
});

describe('SPEC-0008/R3 — the demo tenant is separated by policy where policy applies', () => {
  it('the connection cannot bypass row-level security', async () => {
    const [row] = await app
      .query<{ rolbypassrls: boolean }>('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')
      .then((r) => r.rows);
    expect(row?.rolbypassrls, 'the test connects as a role that bypasses RLS, so it proves nothing').toBe(false);
  });

  it('a demo tenant cannot read a customer tenant’s leads', async () => {
    // Covered in principle by rls.spec.ts for two tenants; asserted here with
    // the demo fixture specifically, because that is the pairing the proposal
    // introduces and the one a reviewer will look for.
    const rows = await asTenant(demo.id, 'SELECT id FROM "Lead" WHERE "tenantId" = $1', [customerA.id]);
    expect(rows).toHaveLength(0);
  });

  it('a customer tenant cannot read the demo tenant’s leads either — the boundary is symmetric', async () => {
    const rows = await asTenant(customerA.id, 'SELECT id FROM "Lead" WHERE "tenantId" = $1', [demo.id]);
    expect(rows).toHaveLength(0);
  });
});

/**
 * ── The characterisation cases ──────────────────────────────────────────────
 *
 * Everything below asserts what is true TODAY of tables outside the policy
 * sweep. Where a cross-tenant read succeeds, that is the documented design and
 * the assertion records it, so the application-layer requirement in SPEC-0008
 * rests on a measurement.
 */
describe('SPEC-0008/R3 — surfaces where row-level security does not apply', () => {
  it('IntegrationConnection is readable across tenants at the database layer (BOOTSTRAP exemption)', async () => {
    const rows = await asTenant<{ credentials: { marker: string } }>(
      demo.id,
      'SELECT credentials FROM "IntegrationConnection" WHERE "tenantId" = $1',
      [customerA.id],
    );

    // Not a defect: IntegrationConnection is listed in the BOOTSTRAP set in
    // scripts/check-rls.mjs, so no policy was ever created for it. The value of
    // asserting it is that SPEC-0008/ST-D5 must therefore be an APPLICATION
    // test — the database will not refuse this, and a reviewer should not
    // assume otherwise.
    expect(rows.length, 'IntegrationConnection has come under RLS — update ST-D5 deliberately').toBe(1);
    expect(rows[0]!.credentials.marker).toBe(`secret-of-${customerA.slug}`);
  });

  it('WorkspaceMembership is readable across tenants at the database layer (BOOTSTRAP exemption)', async () => {
    const rows = await asTenant(demo.id, 'SELECT id FROM "WorkspaceMembership" WHERE "tenantId" = $1', [customerA.id]);

    // Same reasoning. This is the table that decides which workspaces a login
    // reaches, so SPEC-0008/ST-D4 is the highest-value application test in the
    // set: the database is not going to help.
    expect(rows.length, 'WorkspaceMembership has come under RLS — update ST-D4 deliberately').toBe(1);
  });

  it('PlatformUser carries no tenant column, so no policy could scope it', async () => {
    const [col] = await app
      .query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_name = 'PlatformUser' AND column_name = 'tenantId'`,
      )
      .then((r) => r.rows);

    // GLOBAL_MODELS in src/lib/db.ts. The identity layer is global by
    // construction; ST-D14 and ST-D15 are application tests for the same
    // reason, and gate 3 is being asked to accept exactly this.
    expect(col?.n).toBe('0');
  });

  it('every BOOTSTRAP table named in check-rls.mjs really is outside the policy', async () => {
    // Guards the inventory in the SPEC-0008 packet against drift. If a table
    // gains a policy this fails, and the packet's risk table is then wrong in a
    // direction worth knowing about.
    const bootstrap = [
      'APIKey',
      'IntegrationConnection',
      'PasswordResetToken',
      'RateLimitCounter',
      'WorkspaceInvitation',
      'WorkspaceMembership',
      'PlatformAuditEvent',
    ];
    const rows = await app
      .query<{ tablename: string }>(
        `SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [bootstrap],
      )
      .then((r) => r.rows);

    expect(
      rows.map((r) => r.tablename).sort(),
      'a BOOTSTRAP table has gained a policy — good, but the SPEC-0008 inventory must be updated',
    ).toEqual([]);
  });
});

describe('SPEC-0008/R3 — context failures fail closed', () => {
  it('an unpinned read returns nothing rather than everything', async () => {
    const rows = await app.query('SELECT id FROM "Lead" LIMIT 1').then((r) => r.rows);
    expect(rows).toHaveLength(0);
  });

  it('a forged tenant id that names no tenant returns nothing', async () => {
    const rows = await asTenant('not-a-real-tenant-id', 'SELECT id FROM "Lead" LIMIT 1');
    expect(rows).toHaveLength(0);
  });

  it('the pinned tenant does not survive its transaction', async () => {
    await asTenant(demo.id, 'SELECT 1');
    const rows = await app.query('SELECT id FROM "Lead" LIMIT 1').then((r) => r.rows);
    expect(rows, 'the tenant setting leaked out of its transaction').toHaveLength(0);
  });
});
