import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { totp } from '@/lib/auth/mfa';

/**
 * One company, one user directory — whichever module the administrator used.
 *
 * The requirement is that a person added from People HRMS and a person invited
 * from Sales end up as the *same shape* of identity: one PlatformUser, one
 * WorkspaceMembership in that company, and module access decided by RBAC rather
 * than by which screen created them. There must be no HR-John and Sales-John.
 *
 * This drives the real HTTP routes against a running server, because the claim
 * being tested is about what the product does, not about what a service would do
 * if called correctly.
 */
const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:leadflow@localhost:5432/leadflow?schema=public',
  }),
});

const suffix = Date.now().toString(36);
const ownerEmail = `ident.owner.${suffix}@masterapp.local`;
const ownerPassword = `Owner-${suffix}-Secure!42`;
const abcSlug = `abc-identity-${suffix}`;
const otherSlug = `other-identity-${suffix}`;
const adminEmail = `admin.${suffix}@abcidentity.ae`;
const adminPassword = `Abc-${suffix}-Admin!42`;
const adminChosen = `Abc-${suffix}-Chosen!42`;
const johnEmail = `john.${suffix}@abcidentity.ae`;
const johnPassword = `John-${suffix}-Secret!42`;
const sarahEmail = `sarah.${suffix}@abcidentity.ae`;
const sarahPassword = `Sarah-${suffix}-Secret!42`;
const planCode = `ident-both-${suffix}`;

const state = { ownerCookie: '', tenantId: '', otherTenantId: '', adminCookie: '', memberRoleId: '' };

beforeAll(async () => {
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

describe.sequential('one shared company user directory', () => {
  it('provisions two companies on one platform', async () => {
    await prisma.platformUser.create({
      data: {
        email: ownerEmail,
        normalizedEmail: ownerEmail,
        fullName: 'Identity Owner',
        passwordHash: await hashPassword(ownerPassword),
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        platformRole: 'OWNER',
      },
    });
    const first = await call('/api/v1/auth/login', 'POST', { email: ownerEmail, password: ownerPassword });
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
        name: `Identity ${suffix}`,
        modules: ['HRMS', 'SALES'],
        maxUsers: 50,
        maxEmployees: 50,
        maxStorageMb: 2048,
      },
      state.ownerCookie,
    );
    expect(plan.status, JSON.stringify(plan.data)).toBe(201);

    const abc = await call(
      '/api/v1/platform/workspaces',
      'POST',
      workspace(abcSlug, 'ABC Identity', adminEmail, adminPassword),
      state.ownerCookie,
    );
    expect(abc.status, JSON.stringify(abc.data)).toBe(201);
    state.tenantId = abc.data.workspace.id;

    const other = await call(
      '/api/v1/platform/workspaces',
      'POST',
      workspace(otherSlug, 'Other Identity', `admin.${suffix}@otheridentity.ae`, `Other-${suffix}-Admin!42`),
      state.ownerCookie,
    );
    expect(other.status, JSON.stringify(other.data)).toBe(201);
    state.otherTenantId = other.data.workspace.id;

    // Clear the forced-change gate so page routes render.
    const initial = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminPassword });
    await call(
      `/api/v1/workspaces/${abcSlug}/identity/self/password-change`,
      'POST',
      { currentPassword: adminPassword, newPassword: adminChosen },
      initial.cookie,
    );
    await call('/api/v1/auth/logout', 'POST', undefined, initial.cookie);

    const admin = await call('/api/v1/auth/login', 'POST', { email: adminEmail, password: adminChosen });
    expect(admin.status, JSON.stringify(admin.data)).toBe(200);
    state.adminCookie = admin.cookie!;

    // A non-admin role for the invitations below: `inviteUser` refuses to bind
    // somebody into a role at or above the inviter's own rank.
    const role = await prisma.role.create({
      data: { tenantId: state.tenantId, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
    });
    state.memberRoleId = role.id;
    const permissions = await prisma.permission.findMany({
      where: { module: { in: ['leads', 'employee', 'tasks'] }, action: { in: ['VIEW', 'CREATE', 'EDIT'] } },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        tenantId: state.tenantId,
        roleId: role.id,
        permissionId: permission.id,
        granted: true,
        scope: 'OWN' as const,
      })),
    });
  }, 180_000);

  /** §41 — a user created from People HRMS. */
  it('creates John from HR as one shared identity', async () => {
    const department = await call(
      `/api/v1/workspaces/${abcSlug}/hr/departments`,
      'POST',
      { name: 'Operations', code: `OPS${suffix.slice(-4)}` },
      state.adminCookie,
    );
    expect(department.status, JSON.stringify(department.data)).toBe(200);

    const invitation = await call(
      `/api/v1/workspaces/${abcSlug}/hr/employees`,
      'POST',
      {
        fullName: 'John Smith',
        email: johnEmail,
        employeeNumber: `EMP-${suffix}`,
        roleKey: `member-${suffix}`,
        departmentId: department.data.id,
        designation: 'Operations Analyst',
      },
      state.adminCookie,
    );
    expect(invitation.status, JSON.stringify(invitation.data)).toBe(200);

    await accept(invitation.data.id, johnPassword);

    // One identity, one membership, one employee record — all linked.
    const identities = await prisma.platformUser.findMany({ where: { normalizedEmail: johnEmail } });
    expect(identities.length, 'exactly one PlatformUser for John').toBe(1);

    const memberships = await prisma.workspaceMembership.findMany({
      where: { tenantId: state.tenantId, platformUserId: identities[0]!.id },
      include: { employee: true, salesUser: true },
    });
    expect(memberships.length, 'exactly one WorkspaceMembership in ABC').toBe(1);
    expect(memberships[0]!.employee, 'EmployeeProfile linked to that membership').not.toBeNull();
    expect(memberships[0]!.employee!.employeeNumber).toBe(`EMP-${suffix}`);
    // The Sales-side user row hangs off the same membership rather than being a
    // second account: this is what makes John one person to both modules.
    expect(memberships[0]!.salesUser, 'the Sales user record is the same membership').not.toBeNull();

    // And John is in the shared company directory, not an HR-only list.
    const accounts = await call(`/api/v1/workspaces/${abcSlug}/identity/accounts`, 'GET', undefined, state.adminCookie);
    expect(accounts.status, JSON.stringify(accounts.data)).toBe(200);
    const rows = (accounts.data.data ?? accounts.data) as { email: string }[];
    expect(
      rows.some((row) => row.email === johnEmail),
      'John appears in the shared user directory',
    ).toBe(true);
  }, 180_000);

  /** §42 — a user created from Sales user management. */
  it('creates Sarah from Sales as the same shape of identity', async () => {
    const invitation = await call(
      `/api/v1/workspaces/${abcSlug}/identity/invite`,
      'POST',
      { email: sarahEmail, fullName: 'Sarah Ahmed', roleId: state.memberRoleId },
      state.adminCookie,
    );
    expect(invitation.status, JSON.stringify(invitation.data)).toBe(200);

    await accept(invitation.data.id, sarahPassword);

    const identities = await prisma.platformUser.findMany({ where: { normalizedEmail: sarahEmail } });
    expect(identities.length, 'exactly one PlatformUser for Sarah').toBe(1);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { tenantId: state.tenantId, platformUserId: identities[0]!.id },
    });
    expect(memberships.length, 'exactly one WorkspaceMembership in ABC').toBe(1);
  }, 180_000);

  /**
   * §46 / the primary requirement, for a user who was created from HR: one
   * login, one session, both products.
   */
  it('lets John reach both products on one login', async () => {
    const login = await call('/api/v1/auth/login', 'POST', { email: johnEmail, password: johnPassword });
    expect(login.status, JSON.stringify(login.data)).toBe(200);
    const cookie = login.cookie!;

    const live = await prisma.platformSession.findMany({
      where: { platformUser: { normalizedEmail: johnEmail }, revokedAt: null },
    });
    expect(live.length, 'one login made one session').toBe(1);
    const sessionId = live[0]!.id;

    // HR and Sales on the same cookie. `member-<suffix>` holds employee and
    // leads at OWN, so RBAC permits both.
    const hr = await call(`/api/v1/workspaces/${abcSlug}/hr/employees`, 'GET', undefined, cookie);
    expect(hr.status, `HR: ${JSON.stringify(hr.data)}`).toBe(200);
    const sales = await call(`/api/v1/workspaces/${abcSlug}/sales/leads`, 'GET', undefined, cookie);
    expect(sales.status, `Sales: ${JSON.stringify(sales.data)}`).toBe(200);

    const after = await prisma.platformSession.findMany({
      where: { platformUser: { normalizedEmail: johnEmail }, revokedAt: null },
    });
    expect(after.length, 'no second session was minted by using both modules').toBe(1);
    expect(after[0]!.id).toBe(sessionId);
  }, 180_000);

  /**
   * SCENARIO D — the same invitation sent twice.
   *
   * `WorkspaceInvitation` has a unique on (tenantId, pendingKey), so a second
   * open invitation to one address is refused by the database. What matters here
   * is that the caller is told *why*: a duplicate invitation is an ordinary
   * operator mistake, and it must not surface as an unexplained server error.
   */
  it('refuses a duplicate invitation with a conflict, not a server error', async () => {
    const email = `dupe.${suffix}@abcidentity.ae`;
    const first = await call(
      `/api/v1/workspaces/${abcSlug}/identity/invite`,
      'POST',
      { email, fullName: 'Duplicate Person', roleId: state.memberRoleId },
      state.adminCookie,
    );
    expect(first.status, JSON.stringify(first.data)).toBe(200);

    const second = await call(
      `/api/v1/workspaces/${abcSlug}/identity/invite`,
      'POST',
      { email, fullName: 'Duplicate Person', roleId: state.memberRoleId },
      state.adminCookie,
    );
    expect(second.status, `a duplicate invitation must be a 409: ${JSON.stringify(second.data)}`).toBe(409);

    // And no second row was created either way.
    const open = await prisma.workspaceInvitation.count({
      where: { tenantId: state.tenantId, email, pendingKey: { not: null } },
    });
    expect(open, 'still exactly one open invitation').toBe(1);
  }, 120_000);

  /**
   * SCENARIO B — inviting somebody who is already a member.
   *
   * Must not create a second identity or a second membership, and must say so
   * rather than failing opaquely.
   */
  it('refuses to re-add an existing member without duplicating them', async () => {
    const res = await call(
      `/api/v1/workspaces/${abcSlug}/identity/invite`,
      'POST',
      { email: johnEmail, fullName: 'John Smith', roleId: state.memberRoleId },
      state.adminCookie,
    );
    expect(res.status, `already a member: ${JSON.stringify(res.data)}`).toBe(409);

    const identities = await prisma.platformUser.count({ where: { normalizedEmail: johnEmail } });
    const memberships = await prisma.workspaceMembership.count({
      where: { tenantId: state.tenantId, platformUser: { normalizedEmail: johnEmail } },
    });
    expect(identities).toBe(1);
    expect(memberships).toBe(1);
  }, 120_000);

  /**
   * SCENARIO C — the same person joining a second company.
   *
   * One human, one PlatformUser, two memberships. This is the case that would
   * be broken by "create a user per company", and the one that proves the
   * identity is global while access is per-company.
   */
  it('gives an existing person a second membership rather than a second identity', async () => {
    const otherAdminEmail = `admin.${suffix}@otheridentity.ae`;
    const otherAdminPassword = `Other-${suffix}-Admin!42`;
    const initial = await call('/api/v1/auth/login', 'POST', { email: otherAdminEmail, password: otherAdminPassword });
    expect(initial.status, JSON.stringify(initial.data)).toBe(200);
    const chosen = `Other-${suffix}-Chosen!42`;
    await call(
      `/api/v1/workspaces/${otherSlug}/identity/self/password-change`,
      'POST',
      { currentPassword: otherAdminPassword, newPassword: chosen },
      initial.cookie,
    );
    const otherAdmin = await call('/api/v1/auth/login', 'POST', { email: otherAdminEmail, password: chosen });

    const role = await prisma.role.create({
      data: { tenantId: state.otherTenantId, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
    });

    const invitation = await call(
      `/api/v1/workspaces/${otherSlug}/identity/invite`,
      'POST',
      { email: johnEmail, fullName: 'John Smith', roleId: role.id },
      otherAdmin.cookie,
    );
    expect(invitation.status, JSON.stringify(invitation.data)).toBe(200);
    await accept(invitation.data.id, `John-${suffix}-Other!42`);

    const identities = await prisma.platformUser.findMany({ where: { normalizedEmail: johnEmail } });
    expect(identities.length, 'still exactly one human identity').toBe(1);

    const memberships = await prisma.workspaceMembership.findMany({
      where: { platformUserId: identities[0]!.id },
    });
    expect(memberships.length, 'one membership per company').toBe(2);
    expect(new Set(memberships.map((m) => m.tenantId))).toEqual(new Set([state.tenantId, state.otherTenantId]));

    // And the second company cannot see the first company's data.
    const johnAtOther = await call('/api/v1/auth/login', 'POST', { email: johnEmail, password: johnPassword });
    expect(johnAtOther.status, 'the original password still works — no second credential').toBe(200);
    const crossTenant = await call(`/api/v1/workspaces/${abcSlug}/hr/employees`, 'GET', undefined, johnAtOther.cookie);
    // John is a member of ABC too, so this is allowed — the isolation assertion
    // that matters is that the *other* company's admin cannot reach ABC.
    expect(crossTenant.status).toBe(200);
    const otherAdminIntoAbc = await call(
      `/api/v1/workspaces/${abcSlug}/hr/employees`,
      'GET',
      undefined,
      otherAdmin.cookie,
    );
    expect(otherAdminIntoAbc.status, 'the other company cannot read ABC').toBe(404);
  }, 180_000);
});

function code(secret: string) {
  return totp(secret, Math.floor(Date.now() / 1000 / 30));
}

/** Re-issues the invitation token against the row, then accepts it over HTTP. */
async function accept(invitationId: string, password: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.workspaceInvitation.update({
    where: { id: invitationId },
    data: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
  const accepted = await call('/api/v1/auth/accept-invite', 'POST', { token, password });
  expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
  return accepted;
}

function workspace(slug: string, name: string, adminAddress: string, adminSecret: string) {
  return {
    workspaceName: name,
    slug,
    legalName: `${name} LLC`,
    displayName: name,
    primaryAdminName: `${name} Administrator`,
    primaryAdminEmail: adminAddress,
    primaryAdminPassword: adminSecret,
    planCode,
    enabledModules: ['HRMS', 'SALES'],
    maxEmployees: 50,
    maxUsers: 50,
    maxStorageMb: 2048,
    industry: 'Real Estate',
    country: 'AE',
    timezone: 'Asia/Dubai',
    currency: 'AED',
    companyEmail: adminAddress,
    companyPhone: '+971500000002',
    companyAddress: 'Dubai, UAE',
    status: 'ACTIVE',
  };
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
