import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/lib/auth/password';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * This spec drives a *running server*, so it must read the database that server
 * is connected to — not the isolated one in .env.test. Importing @/lib/db here
 * pointed the assertions at a different database from the one under test, so
 * the owner it created could never log in.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:leadflow@localhost:5432/leadflow?schema=public',
  }),
});
const suffix = Date.now().toString(36);
const ownerEmail = `e2e.owner.${suffix}@masterapp.local`;
const ownerPassword = `Owner-${suffix}-Secure!42`;
const manathSlug = `manath-homes-${suffix}`;
const leadersSlug = `leadersfort-${suffix}`;

/**
 * The scenario signs in as five different accounts from one address, and login
 * is throttled to 10 attempts per IP per 15 minutes. Without clearing that
 * counter the suite passes once and then 429s for a quarter of an hour, which
 * looks like a product bug and is actually the limiter doing its job.
 */
beforeAll(async () => {
  const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/0');
  const keys = await redis.keys('rl:login:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

// Every workspace this scenario provisions is suffixed, so cleanup is exact and
// the run leaves the demo workspaces untouched.
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { endsWith: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
  await prisma.subscriptionPlan.deleteMany({ where: { code: `acceptance-${suffix}` } }).catch(() => {});
  await prisma.$disconnect();
});

describe.sequential('unified commercial SaaS acceptance scenario', () => {
  it('provisions two isolated workspaces with HRMS and Sales on one identity system', async () => {
    await prisma.platformUser.create({
      data: {
        email: ownerEmail,
        normalizedEmail: ownerEmail,
        fullName: 'E2E Platform Owner',
        passwordHash: await hashPassword(ownerPassword),
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        platformRole: 'OWNER',
      },
    });

    const ownerLogin = await call('/api/v1/auth/login', 'POST', { email: ownerEmail, password: ownerPassword });
    expect(ownerLogin.status, JSON.stringify(ownerLogin.data)).toBe(200);
    expect(ownerLogin.data.destination).toBe('/platform');

    const planCode = `acceptance-${suffix}`;
    const createdPlan = await call('/api/v1/platform/plans', 'POST', {
      code: planCode,
      name: `Acceptance ${suffix}`,
      modules: ['HRMS', 'SALES'],
      maxUsers: 75,
      maxEmployees: 50,
      maxStorageMb: 8192,
    }, ownerLogin.cookie);
    expect(createdPlan.status, JSON.stringify(createdPlan.data)).toBe(201);
    expect(createdPlan.data.plan.planModules.map((item: any) => item.module).sort()).toEqual(['HRMS', 'SALES']);
    expect(createdPlan.data.plan.planLimits.find((item: any) => item.key === 'employees').value).toBe(50);

    const manathAdminEmail = `admin.${suffix}@manathhomes.ae`;
    const manathAdminPassword = `Manath-${suffix}-Admin!42`;
    const manath = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'Manath Homes', slug: manathSlug, legalName: 'Manath Homes LLC', displayName: 'Manath Homes',
      primaryAdminName: 'Manath Administrator', primaryAdminEmail: manathAdminEmail, primaryAdminPassword: manathAdminPassword,
    }), ownerLogin.cookie);
    expect(manath.status, JSON.stringify(manath.data)).toBe(201);
    expect(manath.data.workspace.moduleEntitlements.map((item: any) => item.module).sort()).toEqual(['HRMS', 'SALES']);

    const leadersAdminEmail = `admin.${suffix}@leadersfort.com`;
    const leadersAdminPassword = `Leaders-${suffix}-Admin!42`;
    const leaders = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'Leadersfort', slug: leadersSlug, legalName: 'Leadersfort LLC', displayName: 'Leadersfort',
      primaryAdminName: 'Leadersfort Administrator', primaryAdminEmail: leadersAdminEmail, primaryAdminPassword: leadersAdminPassword,
    }), ownerLogin.cookie);
    expect(leaders.status, JSON.stringify(leaders.data)).toBe(201);

    const duplicateSlug = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'Duplicate', slug: manathSlug, legalName: 'Duplicate LLC', displayName: 'Duplicate',
      primaryAdminName: 'Duplicate Admin', primaryAdminEmail: `duplicate.${suffix}@example.com`, primaryAdminPassword: `Duplicate-${suffix}!42`,
    }), ownerLogin.cookie);
    expect(duplicateSlug.status).toBe(409);

    const manathLogin = await call('/api/v1/auth/login', 'POST', { email: manathAdminEmail, password: manathAdminPassword });
    expect(manathLogin.status, JSON.stringify(manathLogin.data)).toBe(200);
    expect(manathLogin.data.destination).toBe(`/${manathSlug}/dashboard`);

    const companyCannotCreatePlatformWorkspace = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'Forbidden', slug: `forbidden-${suffix}`, legalName: 'Forbidden LLC', displayName: 'Forbidden',
      primaryAdminName: 'Forbidden Admin', primaryAdminEmail: `forbidden.${suffix}@example.com`, primaryAdminPassword: `Forbidden-${suffix}!42`,
    }), manathLogin.cookie);
    expect(companyCannotCreatePlatformWorkspace.status).toBe(403);

    const department = await call(`/api/v1/workspaces/${manathSlug}/hr/departments`, 'POST', { name: 'Sales', code: 'SALES' }, manathLogin.cookie);
    expect(department.status, JSON.stringify(department.data)).toBe(200);

    const employee = await call(`/api/v1/workspaces/${manathSlug}/hr/employees`, 'POST', {
      fullName: 'Test Employee',
      email: `test.employee.${suffix}@manathhomes.ae`,
      initialPassword: `Employee-${suffix}!42`,
      employeeNumber: `MH-${suffix}`,
      roleKey: 'sales_rep',
      departmentId: department.data.id,
      designation: 'Sales Representative',
      employmentType: 'Full-time',
    }, manathLogin.cookie);
    expect(employee.status, JSON.stringify(employee.data)).toBe(200);

    const lead = await call(`/api/v1/workspaces/${manathSlug}/sales/leads`, 'POST', {
      fullName: 'Acceptance Test Lead', company: 'COLLAB', ownerId: employee.data.membership.salesUser.id,
    }, manathLogin.cookie);
    expect(lead.status, JSON.stringify(lead.data)).toBe(200);

    const manathId = manath.data.workspace.id as string;
    const leadersId = leaders.data.workspace.id as string;
    expect(department.data.tenantId).toBe(manathId);
    expect(employee.data.tenantId).toBe(manathId);
    expect(lead.data.tenantId).toBe(manathId);
    expect(leadersId).not.toBe(manathId);

    const leadersLogin = await call('/api/v1/auth/login', 'POST', { email: leadersAdminEmail, password: leadersAdminPassword });
    expect(leadersLogin.status).toBe(200);
    const crossWorkspace = await call(`/api/v1/workspaces/${manathSlug}/hr/employees`, 'GET', undefined, leadersLogin.cookie);
    expect(crossWorkspace.status).toBe(404);

    const leakedEmployee = await prisma.employeeProfile.findFirst({ where: { tenantId: leadersId, id: employee.data.id } });
    const leakedLead = await prisma.lead.findFirst({ where: { tenantId: leadersId, id: lead.data.id } });
    expect(leakedEmployee).toBeNull();
    expect(leakedLead).toBeNull();

    const rlsVisible = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE master_saas_app');
      await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, manathId);
      return tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) FROM "EmployeeProfile" WHERE "tenantId" = $1`, leadersId);
    });
    expect(Number(rlsVisible[0]?.count ?? 0)).toBe(0);

    let rlsWriteBlocked = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE master_saas_app');
        await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, manathId);
        await tx.$executeRawUnsafe(`INSERT INTO "HrHoliday" ("id", "tenantId", "name", "holidayDate") VALUES ($1, $2, 'Blocked', NOW())`, `blocked-${suffix}`, leadersId);
      });
    } catch { rlsWriteBlocked = true; }
    expect(rlsWriteBlocked).toBe(true);

    const auditCount = await prisma.auditLog.count({ where: { tenantId: manathId, event: 'RECORD_CREATED' } });
    expect(auditCount).toBeGreaterThanOrEqual(3);

    const hrOnly = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'HR Only', slug: `hr-only-${suffix}`, legalName: 'HR Only LLC', displayName: 'HR Only',
      primaryAdminName: 'HR Admin', primaryAdminEmail: `hr.${suffix}@example.com`, primaryAdminPassword: `HrOnly-${suffix}-Admin!42`, enabledModules: ['HRMS'],
    }), ownerLogin.cookie);
    expect(hrOnly.status).toBe(201);
    const hrLogin = await call('/api/v1/auth/login', 'POST', { email: `hr.${suffix}@example.com`, password: `HrOnly-${suffix}-Admin!42` });
    expect((await call(`/api/v1/workspaces/hr-only-${suffix}/hr/departments`, 'GET', undefined, hrLogin.cookie)).status).toBe(200);
    expect((await call(`/api/v1/workspaces/hr-only-${suffix}/sales/leads`, 'GET', undefined, hrLogin.cookie)).status).toBe(403);

    const salesOnly = await call('/api/v1/platform/workspaces', 'POST', workspaceBody({
      workspaceName: 'Sales Only', slug: `sales-only-${suffix}`, legalName: 'Sales Only LLC', displayName: 'Sales Only',
      primaryAdminName: 'Sales Admin', primaryAdminEmail: `sales.${suffix}@example.com`, primaryAdminPassword: `SalesOnly-${suffix}!42`, enabledModules: ['SALES'],
    }), ownerLogin.cookie);
    expect(salesOnly.status).toBe(201);
    const salesLogin = await call('/api/v1/auth/login', 'POST', { email: `sales.${suffix}@example.com`, password: `SalesOnly-${suffix}!42` });
    expect((await call(`/api/v1/workspaces/sales-only-${suffix}/sales/leads`, 'GET', undefined, salesLogin.cookie)).status).toBe(200);
    expect((await call(`/api/v1/workspaces/sales-only-${suffix}/hr/departments`, 'GET', undefined, salesLogin.cookie)).status).toBe(403);

    const suspended = await call(`/api/v1/platform/workspaces/${manathId}`, 'PATCH', { status: 'SUSPENDED', subscriptionState: 'SUSPENDED', revokeSessions: true }, ownerLogin.cookie);
    expect(suspended.status).toBe(200);
    expect((await call(`/api/v1/workspaces/${manathSlug}/hr/departments`, 'GET', undefined, manathLogin.cookie)).status).toBe(401);
    expect((await call(`/api/v1/platform/workspaces/${manathId}`, 'PATCH', { status: 'ACTIVE', subscriptionState: 'ACTIVE' }, ownerLogin.cookie)).status).toBe(200);
  }, 120_000);
});

function workspaceBody(input: Record<string, any>) {
  const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 14);
  return {
    ...input,
    planCode: 'business', enabledModules: input.enabledModules ?? ['HRMS', 'SALES'], maxEmployees: 100, maxUsers: 100,
    maxStorageMb: 10240, industry: 'Real Estate', country: 'AE', timezone: 'Asia/Dubai', currency: 'AED',
    companyEmail: input.primaryAdminEmail, companyPhone: '+971500000000', companyAddress: 'Dubai, UAE',
    trialStartDate: start.toISOString(), trialEndDate: end.toISOString(), status: 'ACTIVE',
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
