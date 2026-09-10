/**
 * SPEC-0008 revision 3 — ST-D4 and ST-D5: does APPLICATION authorization hold?
 *
 * ── Why this file is separate from demo-tenant-boundary.spec.ts ─────────────
 *
 * That file characterises the database layer and shows, by measurement, that
 * `WorkspaceMembership` and `IntegrationConnection` are readable across tenants
 * as `master_saas_app` because both sit in the BOOTSTRAP exemption set. Ten
 * passing cases there establish where row-level security does **not** reach.
 * They establish nothing about whether the application refuses what the
 * database would allow — and that is the entire remaining question for a public
 * demo login.
 *
 * So this file exercises the real thing: a real `PlatformSession` minted by
 * `tests/helpers/session.ts`, resolved by the real `resolveCtx`, calling the
 * real route handlers, against the real database. **The authorization decision
 * under test is never mocked.** If a case here passes, the application refused
 * it; if one fails, that is a reachable defect and it is reported as one.
 *
 * ── Positive controls are load-bearing ──────────────────────────────────────
 *
 * A suite of negative assertions goes green when everything is broken — a route
 * that 500s on every request refuses cross-tenant access beautifully. Every
 * denial below is therefore paired with a positive case proving the same route
 * works for the principal that legitimately owns the data. If the positives
 * fail, the negatives prove nothing and the suite says so.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * R2, test-only, local disposable database. No product code and no schema is
 * touched: SPEC-0008 is at READY_FOR_PLAN with gates 3, 4, 5 and 7 unrecorded,
 * and no demo policy or tenant classification exists yet. These tests describe
 * the boundary as it stands TODAY, which is what gate 3 needs in order to judge
 * whether application authorization is sufficient for the proposal.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createPlatformSessionToken, createSessionToken } from '../helpers/session';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { get, del, patch } from '../helpers/request';
import {
  GET as listIntegrations,
  DELETE as deleteIntegration,
  PATCH as patchIntegration,
} from '@/app/api/v1/integrations/route';
import { GET as listWorkspaces } from '@/app/api/v1/auth/workspaces/route';
import { GET as platformWorkspaces } from '@/app/api/v1/platform/workspaces/route';

const suffix = randomBytes(4).toString('hex');

interface Party {
  label: string;
  tenantId: string;
  slug: string;
  userId: string;
  platformUserId: string;
  cookie: string;
  /** The marker planted in this tenant's integration credentials. */
  marker: string;
}

const parties: Record<'customerA' | 'customerB' | 'demo', Party> = {} as never;

/**
 * Builds a tenant with an admin who genuinely holds the integrations
 * permissions, so a refusal below is a *tenant* boundary refusing, not a
 * missing grant. Testing a denial against a principal who lacks the permission
 * anyway would prove nothing about tenancy.
 */
async function buildParty(label: string): Promise<Party> {
  const slug = `appbnd-${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: `${slug} LLC`, displayName: slug },
  });
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId: tenant.id, module: 'HRMS', state: 'ACTIVE' },
      { tenantId: tenant.id, module: 'SALES', state: 'ACTIVE' },
    ],
    skipDuplicates: true,
  });

  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin' },
  });
  await grantPermissions(tenant.id, role.id, [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);

  const user = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `${slug}@example.test`,
    fullName: `${label} admin`,
  });

  // createWorkspaceUser returns the workspace `User`; the platform identity is
  // reachable through the membership it created. Read rather than assumed,
  // because the forged-session case below depends on holding the right id.
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId: tenant.id, salesUserId: user.id },
    select: { platformUserId: true },
  });

  const marker = `credential-marker-of-${slug}`;
  await prisma.integrationConnection.create({
    data: {
      tenantId: tenant.id,
      provider: 'whatsapp',
      status: 'CONNECTED',
      credentials: { token: marker },
    },
  });

  return {
    label,
    tenantId: tenant.id,
    slug,
    userId: user.id,
    platformUserId: membership.platformUserId,
    cookie: await createSessionToken(tenant.id, user.id),
    marker,
  };
}

beforeAll(async () => {
  parties.customerA = await buildParty('cust-a');
  parties.customerB = await buildParty('cust-b');
  parties.demo = await buildParty('demo');
}, 120_000);

afterAll(async () => {
  for (const party of Object.values(parties)) {
    if (party?.tenantId) await prisma.tenant.delete({ where: { id: party.tenantId } }).catch(() => {});
    if (party?.platformUserId) {
      await prisma.platformUser.delete({ where: { id: party.platformUserId } }).catch(() => {});
    }
  }
});

/** A refusal, not a crash. A 500 must never satisfy a negative assertion. */
const REFUSED = [401, 403, 404];

/** True if the serialised payload contains `needle` anywhere. Blunt on purpose:
 * a credential must not appear in any field, nested or renamed. */
function leaks(payload: unknown, needle: string): boolean {
  return JSON.stringify(payload ?? null).includes(needle);
}

describe('SPEC-0008/R3 ST-D4 — membership and workspace selection', () => {
  it('POSITIVE: the demo principal sees its own workspace', async () => {
    const res = await get(listWorkspaces, '/api/v1/auth/workspaces', parties.demo.cookie);
    expect(res.status, 'the positive control failed; every denial below is therefore unproven').toBe(200);
    const slugs = (res.body?.data?.workspaces ?? res.body?.workspaces ?? []).map((w: any) => w.slug);
    expect(slugs).toContain(parties.demo.slug);
  });

  it('the demo principal does NOT see customer workspaces in its own list', async () => {
    const res = await get(listWorkspaces, '/api/v1/auth/workspaces', parties.demo.cookie);
    const slugs = (res.body?.data?.workspaces ?? res.body?.workspaces ?? []).map((w: any) => w.slug);
    expect(slugs).not.toContain(parties.customerA.slug);
    expect(slugs).not.toContain(parties.customerB.slug);
  });

  /**
   * The case the characterisation suite could not answer.
   *
   * demo-tenant-boundary.spec.ts pinned a *nonexistent* tenant id directly into
   * the database session and observed zero rows — which tests the RLS policy,
   * not the application. This mints a session for the demo platform user whose
   * **active tenant is customer A**: an existing, real customer tenant, supplied
   * through the authenticated request path. Nothing about it is forged at the
   * database layer; it is forged at the identity layer, which is where a real
   * attack would put it.
   */
  it('a demo session naming an EXISTING customer tenant as active is refused', async () => {
    const forged = await createPlatformSessionToken(parties.demo.platformUserId, parties.customerA.tenantId);
    const res = await get(listIntegrations, '/api/v1/integrations', forged);

    expect(REFUSED, `a demo principal reached customer A's integrations with status ${res.status}`).toContain(
      res.status,
    );
    expect(res.status, 'a 500 is a broken route, not a refusal').not.toBe(500);
    expect(leaks(res.body, parties.customerA.marker), 'customer credential leaked in the refusal body').toBe(false);
  });

  it('the demo principal holds no membership row in any customer tenant', async () => {
    const rows = await prisma.workspaceMembership.findMany({
      where: { platformUserId: parties.demo.platformUserId },
      select: { tenantId: true },
    });
    expect(rows.map((r) => r.tenantId)).toEqual([parties.demo.tenantId]);
  });
});

describe('SPEC-0008/R3 ST-D4 — platform administration', () => {
  it('the demo principal is refused the platform control plane', async () => {
    const res = await get(platformWorkspaces, '/api/v1/platform/workspaces', parties.demo.cookie);
    expect(REFUSED).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('the demo principal cannot elevate its own platform role', async () => {
    const before = await prisma.platformUser.findUniqueOrThrow({
      where: { id: parties.demo.platformUserId },
      select: { platformRole: true },
    });
    expect(before.platformRole, 'the demo identity was not created as an ordinary USER').toBe('USER');

    // There is no route that offers self-elevation; asserting the absence of an
    // affordance is weak, so this asserts the state a route would have to change
    // and pairs it with the control-plane refusal above.
    const res = await get(platformWorkspaces, '/api/v1/platform/workspaces', parties.demo.cookie);
    expect(REFUSED).toContain(res.status);

    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: parties.demo.platformUserId },
      select: { platformRole: true },
    });
    expect(after.platformRole).toBe('USER');
  });
});

describe('SPEC-0008/R3 ST-D5 — integration connections', () => {
  it('POSITIVE: customer A can list its own integrations', async () => {
    const res = await get(listIntegrations, '/api/v1/integrations', parties.customerA.cookie);
    expect(res.status, 'the positive control failed; the denials below are unproven').toBe(200);
  });

  it('POSITIVE: the demo principal can list its own integrations', async () => {
    const res = await get(listIntegrations, '/api/v1/integrations', parties.demo.cookie);
    expect(res.status).toBe(200);
  });

  it('a demo list response contains no customer credential marker', async () => {
    const res = await get(listIntegrations, '/api/v1/integrations', parties.demo.cookie);
    expect(leaks(res.body, parties.customerA.marker)).toBe(false);
    expect(leaks(res.body, parties.customerB.marker)).toBe(false);
  });

  it('no list response exposes any credential marker at all, including the caller’s own', async () => {
    // The route selects provider, status, webhookKey, metadata, expiresAt,
    // lastSyncAt, errorMessage and updatedAt — deliberately not `credentials`.
    // Asserted so a later `select` widening is caught here rather than in an
    // incident.
    const res = await get(listIntegrations, '/api/v1/integrations', parties.customerA.cookie);
    expect(leaks(res.body, parties.customerA.marker), 'the route now returns credentials').toBe(false);
  });

  it('a demo DELETE cannot remove a customer integration, and leaves it in place', async () => {
    const before = await prisma.integrationConnection.count({ where: { tenantId: parties.customerA.tenantId } });

    const res = await del(
      deleteIntegration,
      `/api/v1/integrations?provider=whatsapp&tenantId=${parties.customerA.tenantId}`,
      parties.demo.cookie,
    );
    expect(res.status).not.toBe(500);

    const after = await prisma.integrationConnection.findMany({
      where: { tenantId: parties.customerA.tenantId },
      select: { provider: true, credentials: true },
    });
    expect(after.length, 'a demo request deleted a customer integration').toBe(before);
    expect(JSON.stringify(after)).toContain(parties.customerA.marker);
  });

  it('a demo PATCH cannot modify a customer integration', async () => {
    const res = await patch(
      patchIntegration,
      '/api/v1/integrations',
      { provider: 'whatsapp', tenantId: parties.customerA.tenantId, status: 'DISCONNECTED' },
      parties.demo.cookie,
    );
    expect(res.status).not.toBe(500);

    const row = await prisma.integrationConnection.findFirst({
      where: { tenantId: parties.customerA.tenantId, provider: 'whatsapp' },
      select: { status: true, credentials: true },
    });
    expect(row?.status, 'a demo request changed a customer integration’s status').toBe('CONNECTED');
    expect(JSON.stringify(row?.credentials)).toContain(parties.customerA.marker);
  });

  it('customer A and customer B cannot reach each other either — the boundary is not demo-specific', async () => {
    const res = await get(listIntegrations, '/api/v1/integrations', parties.customerB.cookie);
    expect(res.status).toBe(200);
    expect(leaks(res.body, parties.customerA.marker)).toBe(false);
  });
});
