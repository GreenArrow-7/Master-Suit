import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { totp } from '@/lib/auth/mfa';

/**
 * The commercial acceptance scenario: one company, one identity, two products.
 *
 * This drives a *running server* over HTTP, so it reads the database that server
 * is connected to rather than the isolated one in `.env.test` — the same reason
 * given at the top of unified-saas.spec.ts.
 *
 * What it is here to prove, in the order the criteria state it:
 *
 *   C  one login reaches both products, on one session that does not change
 *   D  entitlement is not authorisation — a Sales-only user is refused HR
 *   E  cancelling Sales leaves HR, the identity and the membership intact
 *   F  and the same in reverse
 *   H  an expired term is refused even while the state column says ACTIVE
 *   I  two sources for one module: expiring one keeps the module
 *   J  buying a second product creates no second tenant, identity or membership
 *
 * A and B (single-product workspaces) are covered by unified-saas.spec.ts, which
 * provisions an HR-only and a Sales-only workspace and asserts the cross-module
 * refusal; they are re-asserted here against the derived entitlements.
 */
const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:leadflow@localhost:5432/leadflow?schema=public',
  }),
});

const suffix = Date.now().toString(36);
const ownerEmail = `psub.owner.${suffix}@masterapp.local`;
const ownerPassword = `Owner-${suffix}-Secure!42`;
const abcSlug = `abc-realestate-${suffix}`;
const adminEmail = `admin.${suffix}@abcrealestate.ae`;
const adminPassword = `Abc-${suffix}-Admin!42`;
/**
 * The password the administrator actually uses.
 *
 * A workspace provisioned by the platform owner arrives with an
 * administrator-issued credential, and `passwordChangedAt` is null until the
 * person changes it. Every workspace page redirects to /profile/security while
 * that holds — correctly, it is the forced-change gate — so this scenario
 * changes it once during provisioning and signs in with it thereafter. Testing
 * product access through a shell that is redirecting for an unrelated reason
 * would prove nothing either way.
 */
const adminFinalPassword = `Abc-${suffix}-Chosen!42`;
const salesOnlyRoleKey = `sales_only_${suffix.slice(-6)}`;
const repEmail = `rep.${suffix}@abcrealestate.ae`;
const repPassword = `Rep-${suffix}-Sales!42`;
const planCode = `psub-both-${suffix}`;

/** Filled by the provisioning test and read by the rest. */
const state = {
  ownerCookie: '',
  tenantId: '',
  subscriptionId: '',
  adminCookie: '',
  adminSessionId: '',
};

beforeAll(async () => {
  // Login is throttled per IP; this file signs in several times.
  const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://:leadflow@localhost:6379/0');
  const keys = await redis.keys('rl:login:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { endsWith: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
  await prisma.subscriptionPlan.deleteMany({ where: { code: planCode } }).catch(() => {});
  await prisma.$disconnect();
});

describe.sequential('product subscriptions: one company, two products, one login', () => {
  it('provisions ABC Real Estate with HRMS and SALES on one identity', async () => {
    await prisma.platformUser.create({
      data: {
        email: ownerEmail,
        normalizedEmail: ownerEmail,
        fullName: 'Product Subscription Owner',
        passwordHash: await hashPassword(ownerPassword),
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        platformRole: 'OWNER',
      },
    });

    // A platform owner cannot sign in on a password alone.
    const first = await call('/api/v1/auth/login', 'POST', { email: ownerEmail, password: ownerPassword });
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    const begin = await call('/api/v1/auth/enroll-2fa', 'POST', { step: 'begin' }, first.cookie);
    const secret: string = begin.data.secret;
    await call('/api/v1/auth/enroll-2fa', 'POST', { step: 'confirm', code: code(secret) }, first.cookie);
    const owner = await call('/api/v1/auth/login', 'POST', {
      email: ownerEmail,
      password: ownerPassword,
      mfaCode: code(secret),
    });
    expect(owner.status, JSON.stringify(owner.data)).toBe(200);
    state.ownerCookie = owner.cookie!;

    const plan = await call(
      '/api/v1/platform/plans',
      'POST',
      {
        code: planCode,
        name: `Both products ${suffix}`,
        modules: ['HRMS', 'SALES'],
        maxUsers: 50,
        maxEmployees: 50,
        maxStorageMb: 4096,
      },
      state.ownerCookie,
    );
    expect(plan.status, JSON.stringify(plan.data)).toBe(201);

    const created = await call(
      '/api/v1/platform/workspaces',
      'POST',
      {
        workspaceName: 'ABC Real Estate',
        slug: abcSlug,
        legalName: 'ABC Real Estate LLC',
        displayName: 'ABC Real Estate',
        primaryAdminName: 'ABC Administrator',
        primaryAdminEmail: adminEmail,
        primaryAdminPassword: adminPassword,
        planCode,
        enabledModules: ['HRMS', 'SALES'],
        maxEmployees: 50,
        maxUsers: 50,
        maxStorageMb: 4096,
        industry: 'Real Estate',
        country: 'AE',
        timezone: 'Asia/Dubai',
        currency: 'AED',
        companyEmail: adminEmail,
        companyPhone: '+971500000001',
        companyAddress: 'Dubai, UAE',
        status: 'ACTIVE',
      },
      state.ownerCookie,
    );
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    state.tenantId = created.data.workspace.id;

    const subscription = await prisma.tenantSubscription.findUniqueOrThrow({
      where: { tenantId: state.tenantId },
    });
    state.subscriptionId = subscription.id;

    // The purchase is recorded as one product row per module, each with its own
    // plan and terms — the shape the whole change exists to make possible.
    const products = await prisma.subscriptionModule.findMany({ where: { subscriptionId: subscription.id } });
    expect(products.map((row) => row.module).sort()).toEqual(['HRMS', 'SALES']);
    expect(
      products.every((row) => row.planId !== null),
      'each product carries its own plan',
    ).toBe(true);

    expect(await usableModules()).toEqual(['HRMS', 'SALES']);

    // Clear the forced-change gate, once.
    const initial = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminPassword });
    expect(initial.status, JSON.stringify(initial.data)).toBe(200);
    expect(initial.data.mustChangePassword, 'an administrator-issued password is temporary').toBe(true);
    const changed = await call(
      `/api/v1/workspaces/${abcSlug}/identity/self/password-change`,
      'POST',
      { currentPassword: adminPassword, newPassword: adminFinalPassword },
      initial.cookie,
    );
    expect(changed.status, JSON.stringify(changed.data)).toBe(200);
    await call('/api/v1/auth/logout', 'POST', undefined, initial.cookie);
  }, 120_000);

  /**
   * TEST C — the primary acceptance criterion.
   *
   * One authentication. One PlatformSession. Both products reachable, by API and
   * by page, and the session identifier is the same before and after switching
   * in both directions.
   */
  it('TEST C: one login, one session, reaches both HR and Sales', async () => {
    const login = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminFinalPassword });
    expect(login.status, JSON.stringify(login.data)).toBe(200);
    expect(login.data.mustChangePassword, 'the chosen password is not a temporary one').toBeFalsy();
    state.adminCookie = login.cookie!;

    const sessions = await sessionsFor(adminEmail);
    expect(sessions.length, 'exactly one session was created by one login').toBe(1);
    state.adminSessionId = sessions[0]!.id;

    // ── API, both products, same cookie ──────────────────────────────────────
    const hrApi = await call(`/api/v1/workspaces/${abcSlug}/hr/departments`, 'GET', undefined, state.adminCookie);
    expect(hrApi.status, `HR API: ${JSON.stringify(hrApi.data)}`).toBe(200);

    const salesApi = await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, state.adminCookie);
    expect(salesApi.status, `Sales API: ${JSON.stringify(salesApi.data)}`).toBe(200);

    // ── Pages, both products, same cookie ────────────────────────────────────
    //
    // The module layouts redirect to /dashboard when entitlement is missing, so
    // a 200 here is the positive signal and a 3xx would be the refusal.
    await expectPage(`/${abcSlug}/people`, state.adminCookie, 'People shell');
    await expectPage(`/${abcSlug}/sales`, state.adminCookie, 'Sales shell');

    // ── Switching, both directions, no new session ───────────────────────────
    await page(`/${abcSlug}/people`, state.adminCookie);
    await page(`/${abcSlug}/sales`, state.adminCookie);
    await page(`/${abcSlug}/people`, state.adminCookie);

    const after = await sessionsFor(adminEmail);
    expect(after.length, 'switching product did not mint a second session').toBe(1);
    expect(after[0]!.id, 'the same PlatformSession served both products').toBe(state.adminSessionId);
    expect(after[0]!.revokedAt, 'the session was never revoked by switching').toBeNull();
  }, 120_000);

  /**
   * TEST J — buying a second product must not touch identity.
   *
   * Asserted against the state provisioning left: one tenant, one platform
   * identity for the administrator, one membership. Selling another product
   * below must leave all three unchanged.
   */
  it('TEST J: one tenant, one identity, one membership', async () => {
    const identity = await counts();
    expect(identity.tenants).toBe(1);
    expect(identity.memberships).toBe(1);
    expect(identity.platformUsers).toBe(1);

    // Sell HRMS again from a second source — the "customer adds a product"
    // motion — and re-check. Nothing about who they are may change.
    await prisma.subscriptionModule.create({
      data: { subscriptionId: state.subscriptionId, module: 'HRMS', state: 'ACTIVE' },
    });
    const after = await counts();
    expect(after).toEqual(identity);
  });

  /**
   * TEST D — entitlement is not authorisation.
   *
   * The company owns both products; this user holds `sales_rep`, which grants
   * `leads` and no `employee`. Sales must work and HR must be refused, and the
   * company must keep HR for everybody else.
   */
  it('TEST D: a Sales-only user is refused HR while the company keeps it', async () => {
    const department = await call(
      `/api/v1/workspaces/${abcSlug}/hr/departments`,
      'POST',
      { name: 'Sales', code: `SL${suffix.slice(-4)}` },
      state.adminCookie,
    );
    expect(department.status, JSON.stringify(department.data)).toBe(200);

    /**
     * A genuinely Sales-only role, created explicitly.
     *
     * `roleKey: 'sales_rep'` is not enough. A workspace provisioned through the
     * platform API holds exactly one role — Company Administrator — so any other
     * key falls through to `createDefaultEmployeeRole`, which grants
     * `employee:VIEW` at OWN scope alongside leads. That is correct product
     * behaviour (it is how a new hire sees their own record) but it means the
     * auto-created role cannot express "no HR access at all", which is what this
     * test is about. So the role is built here with Sales grants and nothing else.
     */
    const leadPermissions = await prisma.permission.findMany({
      where: {
        module: { in: ['leads', 'opportunities', 'activities', 'tasks'] },
        action: { in: ['VIEW', 'CREATE', 'EDIT'] },
      },
      select: { id: true },
    });
    expect(leadPermissions.length, 'the workspace has Sales permissions to grant').toBeGreaterThan(0);
    const salesOnlyRole = await prisma.role.create({
      data: {
        tenantId: state.tenantId,
        key: salesOnlyRoleKey,
        name: 'Sales Only',
        description: 'Sales access with no HR permission at all.',
        rank: 60,
        defaultScope: 'OWN',
      },
    });
    await prisma.rolePermission.createMany({
      data: leadPermissions.map((permission) => ({
        tenantId: state.tenantId,
        roleId: salesOnlyRole.id,
        permissionId: permission.id,
        granted: true,
        scope: 'OWN' as const,
      })),
    });

    const invitation = await call(
      `/api/v1/workspaces/${abcSlug}/hr/employees`,
      'POST',
      {
        fullName: 'ABC Sales Rep',
        email: repEmail,
        employeeNumber: `ABC-${suffix}`,
        roleKey: salesOnlyRoleKey,
        departmentId: department.data.id,
        designation: 'Sales Representative',
      },
      state.adminCookie,
    );
    expect(invitation.status, JSON.stringify(invitation.data)).toBe(200);

    // The emailed token exists only in the server process; re-issuing it against
    // the same row exercises acceptance over HTTP, as unified-saas.spec.ts does.
    const token = randomBytes(32).toString('base64url');
    await prisma.workspaceInvitation.update({
      where: { id: invitation.data.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    const accepted = await call('/api/v1/auth/accept-invite', 'POST', { token, password: repPassword });
    expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);

    const rep = await call('/api/v1/auth/login', 'POST', { email: repEmail, password: repPassword });
    expect(rep.status, JSON.stringify(rep.data)).toBe(200);

    const repSales = await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, rep.cookie);
    expect(repSales.status, 'a sales rep reaches Sales').toBe(200);

    const repHr = await call(`/api/v1/workspaces/${abcSlug}/hr/employees`, 'GET', undefined, rep.cookie);
    expect(repHr.status, 'a sales rep is refused HR by permission, not entitlement').toBe(403);

    // And the company still has HR: the administrator is unaffected.
    const adminHr = await call(`/api/v1/workspaces/${abcSlug}/hr/employees`, 'GET', undefined, state.adminCookie);
    expect(adminHr.status).toBe(200);
  }, 120_000);

  /**
   * TEST I — two sources provide SALES; expiring one keeps the module.
   *
   * Impossible to represent before this change: `(subscriptionId, module)` was
   * unique, so a second source could not exist and expiry of the only row was
   * always total.
   */
  it('TEST I: expiring one of two sources leaves the module available', async () => {
    const past = new Date(Date.now() - 60_000);
    const second = await prisma.subscriptionModule.create({
      data: { subscriptionId: state.subscriptionId, module: 'SALES', state: 'ACTIVE' },
    });

    // Expire the ORIGINAL Sales row, leaving the one just added.
    const original = await prisma.subscriptionModule.findFirstOrThrow({
      where: { subscriptionId: state.subscriptionId, module: 'SALES', id: { not: second.id } },
    });
    await prisma.subscriptionModule.update({ where: { id: original.id }, data: { endsAt: past } });

    await reconcile();
    expect(await usableModules()).toContain('SALES');
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, state.adminCookie)).status,
      'Sales survives one source expiring',
    ).toBe(200);

    // Clean up: drop the extra source so later tests see one Sales product.
    await prisma.subscriptionModule.delete({ where: { id: second.id } });
    await prisma.subscriptionModule.update({ where: { id: original.id }, data: { endsAt: null } });
    await reconcile();
    expect(await usableModules()).toContain('SALES');
  }, 60_000);

  /**
   * TEST H — an expired term is refused even while `state` still reads ACTIVE.
   *
   * The failure mode this guards is a billing job that did not run: the row is
   * never moved out of ACTIVE, and access silently outlives the term.
   */
  it('TEST H: endsAt in the past overrides an ACTIVE state everywhere', async () => {
    const past = new Date(Date.now() - 60_000);
    await prisma.subscriptionModule.updateMany({
      where: { subscriptionId: state.subscriptionId, module: 'SALES' },
      data: { state: 'ACTIVE', endsAt: past },
    });
    await reconcile();

    const entitlement = await prisma.moduleEntitlement.findUniqueOrThrow({
      where: { tenantId_module: { tenantId: state.tenantId, module: 'SALES' } },
    });
    expect(entitlement.endsAt && entitlement.endsAt <= new Date(), 'projection expired too').toBe(true);

    expect(await usableModules()).not.toContain('SALES');
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, state.adminCookie)).status,
      'API refuses an expired product',
    ).toBe(403);

    // Restore for the cancellation tests below.
    await prisma.subscriptionModule.updateMany({
      where: { subscriptionId: state.subscriptionId, module: 'SALES' },
      data: { state: 'ACTIVE', endsAt: null },
    });
    await reconcile();
    expect(await usableModules()).toContain('SALES');
  }, 60_000);

  /**
   * TEST E — cancel Sales, keep everything else.
   *
   * The behaviour the previous implementation could not produce: every write
   * path updated entitlements with `where: { tenantId }` and no module filter.
   */
  it('TEST E: cancelling Sales leaves HR, the account and the data intact', async () => {
    const before = await counts();
    const employeesBefore = await prisma.employeeProfile.count({ where: { tenantId: state.tenantId } });

    const canceled = await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/SALES`,
      'DELETE',
      undefined,
      state.ownerCookie,
    );
    expect(canceled.status, JSON.stringify(canceled.data)).toBe(200);

    expect(await usableModules(), 'Sales gone, HR kept').toEqual(['HRMS']);

    // HR still answers, on the session that was already open.
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/hr/departments`, 'GET', undefined, state.adminCookie)).status,
      'HR API after cancelling Sales',
    ).toBe(200);
    await expectPage(`/${abcSlug}/people`, state.adminCookie, 'HR shell after cancelling Sales');

    // Sales is refused.
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, state.adminCookie)).status,
      'Sales API after cancellation',
    ).toBe(403);

    // Identity, membership, tenant and HR data are untouched.
    expect(await counts()).toEqual(before);
    expect(await prisma.employeeProfile.count({ where: { tenantId: state.tenantId } })).toBe(employeesBefore);
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { tenantId: state.tenantId, isPrimaryAdmin: true },
    });
    expect(membership.status).toBe('ACTIVE');

    // The administrator can still sign in — the credential is unchanged.
    const relogin = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminFinalPassword });
    expect(relogin.status, 'the account still authenticates').toBe(200);

    // Billing history is kept rather than deleted.
    const salesRows = await prisma.subscriptionModule.findMany({
      where: { subscriptionId: state.subscriptionId, module: 'SALES' },
    });
    expect(salesRows.length).toBeGreaterThan(0);
    expect(salesRows.every((row) => row.state === 'CANCELED' && row.canceledAt !== null)).toBe(true);
  }, 120_000);

  /** TEST F — the reverse: reinstate Sales, cancel HR. */
  it('TEST F: cancelling HR leaves Sales working', async () => {
    const reinstated = await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/SALES`,
      'PATCH',
      { state: 'ACTIVE', endsAt: null },
      state.ownerCookie,
    );
    expect(reinstated.status, JSON.stringify(reinstated.data)).toBe(200);
    expect(await usableModules()).toEqual(['HRMS', 'SALES']);

    const canceledHr = await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/HRMS`,
      'DELETE',
      undefined,
      state.ownerCookie,
    );
    expect(canceledHr.status, JSON.stringify(canceledHr.data)).toBe(200);

    expect(await usableModules()).toEqual(['SALES']);
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, state.adminCookie)).status,
      'Sales API after cancelling HR',
    ).toBe(200);
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/hr/departments`, 'GET', undefined, state.adminCookie)).status,
      'HR API after cancelling HR',
    ).toBe(403);

    // Identity is still untouched by a purely commercial change.
    const identity = await counts();
    expect(identity.tenants).toBe(1);
    expect(identity.memberships).toBe(1);
  }, 120_000);

  /**
   * The definition of done, end to end: HR-only company buys Sales, and the same
   * administrator reaches both on the session they already hold.
   */
  it('DEFINITION OF DONE: adding Sales to an HR company needs no new identity', async () => {
    // Start from HR only.
    await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/HRMS`,
      'PATCH',
      { state: 'ACTIVE', endsAt: null },
      state.ownerCookie,
    );
    await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/SALES`,
      'DELETE',
      undefined,
      state.ownerCookie,
    );
    expect(await usableModules()).toEqual(['HRMS']);

    const before = await counts();
    const login = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminFinalPassword });
    expect(login.status).toBe(200);
    const cookie = login.cookie!;
    const sessionId = (await sessionsFor(adminEmail)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!
      .id;

    await expectPage(`/${abcSlug}/people`, cookie, 'HR before the purchase');

    // The company buys Sales.
    const purchase = await call(
      `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/SALES`,
      'PATCH',
      { state: 'ACTIVE', endsAt: null, planCode, create: true },
      state.ownerCookie,
    );
    expect(purchase.status, JSON.stringify(purchase.data)).toBe(200);
    expect(await usableModules()).toEqual(['HRMS', 'SALES']);

    // No new tenant, identity or membership.
    expect(await counts()).toEqual(before);

    // The administrator did not sign in again, and reaches both.
    await expectPage(`/${abcSlug}/sales`, cookie, 'Sales on the pre-existing session');
    await expectPage(`/${abcSlug}/people`, cookie, 'HR still works');
    expect(
      (await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, cookie)).status,
      'Sales API on the pre-existing session',
    ).toBe(200);

    const live = (await sessionsFor(adminEmail)).filter((row) => row.revokedAt === null);
    expect(
      live.some((row) => row.id === sessionId),
      'the original session is still the live one',
    ).toBe(true);
  }, 120_000);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function code(secret: string) {
  return totp(secret, Math.floor(Date.now() / 1000 / 30));
}

/** The modules the tenant can currently use, read the way the API gate reads them. */
async function usableModules(): Promise<string[]> {
  const now = new Date();
  const rows = await prisma.moduleEntitlement.findMany({ where: { tenantId: state.tenantId } });
  return rows
    .filter((row) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(row.state) && (!row.endsAt || row.endsAt > now))
    .map((row) => row.module)
    .sort();
}

/**
 * Recomputes entitlements from the product rows, the way a platform write does.
 *
 * Called after fixtures that write `SubscriptionModule` directly. It goes
 * through the platform API rather than importing the service, because this
 * process and the server under test are different processes with different
 * Prisma clients — reconciling here would update a row the server then serves
 * from its own Redis cache.
 */
async function reconcile() {
  const response = await call(
    `/api/v1/platform/subscriptions/${state.subscriptionId}/modules/SALES`,
    'PATCH',
    { metadata: { reconciledAt: new Date().toISOString() } },
    state.ownerCookie,
  );
  expect(response.status, `reconcile: ${JSON.stringify(response.data)}`).toBe(200);
}

async function counts() {
  return {
    tenants: await prisma.tenant.count({ where: { id: state.tenantId, deletedAt: null } }),
    memberships: await prisma.workspaceMembership.count({
      where: { tenantId: state.tenantId, platformUser: { normalizedEmail: adminEmail } },
    }),
    platformUsers: await prisma.platformUser.count({ where: { normalizedEmail: adminEmail } }),
  };
}

/** Sessions that are still usable — a revoked row is history, not access. */
async function sessionsFor(email: string) {
  return prisma.platformSession.findMany({
    where: { platformUser: { normalizedEmail: email }, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * A page request, without following redirects.
 *
 * Returns `status`, and `location` when it is a redirect: the two reasons a
 * workspace page redirects — a missing entitlement (→ /dashboard) and a
 * password that must be changed (→ /profile/security) — are both 307, and a
 * bare status cannot tell them apart. A failure that says which one it was is
 * the difference between a diagnosis and a guess.
 */
async function page(path: string, cookie: string): Promise<{ status: number; location: string | null }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie }, redirect: 'manual' });
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status, location: response.headers.get('location') };
}

/** Asserts a page rendered, naming the redirect target when it did not. */
async function expectPage(path: string, cookie: string, what: string) {
  const result = await page(path, cookie);
  expect(result.status, `${what} — redirected to ${result.location ?? 'nowhere'}`).toBe(200);
}

async function call(path: string, method: string, body?: unknown, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, data, cookie: setCookie?.split(';')[0] ?? cookie };
}
