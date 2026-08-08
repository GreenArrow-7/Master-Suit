/**
 * Application-layer tenant isolation: two real workspaces, real sessions, real
 * route handlers. The database-layer proof lives in tests/tenant/rls.spec.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, TenantGuardError } from '@/lib/db';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { GET as getLead, PATCH as patchLead, DELETE as deleteLead } from '@/app/api/v1/leads/[id]/route';
import { get, patch, del } from '../helpers/request';

let fx: Fixture;
beforeAll(async () => {
  fx = await seedTwoTenants();
});
afterAll(async () => {
  await fx?.cleanup();
});

describe('tenant isolation', () => {
  it('a list endpoint never returns another workspace records', async () => {
    const res = await get(listLeads, '/api/v1/leads?limit=200', fx.a.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((l: any) => l.id);
    expect(ids).toHaveLength(fx.a.leadCount);
    expect(ids.some((id: string) => fx.b.leadIds.includes(id))).toBe(false);
  });

  it('fetching another workspace record returns 404, not 403', async () => {
    // 403 would confirm the record exists. See docs/03-API.md §3.
    const res = await get(getLead, `/api/v1/leads/${fx.b.leadIds[0]}`, fx.a.cookie);
    expect(res.status).toBe(404);
  });

  it('updating another workspace record returns 404 and changes nothing', async () => {
    const before = await prisma.lead.findFirst({ where: { tenantId: fx.b.tenantId, id: fx.b.leadIds[0] } });
    const res = await patch(patchLead, `/api/v1/leads/${fx.b.leadIds[0]}`, { fullName: 'Overwritten' }, fx.a.cookie);
    expect(res.status).toBe(404);
    const after = await prisma.lead.findFirst({ where: { tenantId: fx.b.tenantId, id: fx.b.leadIds[0] } });
    expect(after!.fullName).toBe(before!.fullName);
  });

  it('deleting another workspace record returns 404 and leaves it in place', async () => {
    const res = await del(deleteLead, `/api/v1/leads/${fx.b.leadIds[0]}`, fx.a.cookie);
    expect(res.status).toBe(404);
    const still = await prisma.lead.findFirst({ where: { tenantId: fx.b.tenantId, id: fx.b.leadIds[0] } });
    expect(still).not.toBeNull();
  });

  it('each workspace sees exactly its own row count', async () => {
    const a = await get(listLeads, '/api/v1/leads?limit=200', fx.a.cookie);
    const b = await get(listLeads, '/api/v1/leads?limit=200', fx.b.cookie);
    expect(a.body.data).toHaveLength(fx.a.leadCount);
    expect(b.body.data).toHaveLength(fx.b.leadCount);
  });

  it('an unauthenticated request is refused', async () => {
    const res = await get(listLeads, '/api/v1/leads?limit=200');
    expect(res.status).toBe(401);
  });
});

describe('prisma tenant guard', () => {
  it('throws when a tenant-scoped read omits tenantId', async () => {
    await expect(prisma.lead.findMany({ where: { score: { gte: 0 } } as any })).rejects.toBeInstanceOf(
      TenantGuardError,
    );
  });

  it('throws when a create omits tenantId', async () => {
    await expect(prisma.lead.create({ data: { fullName: 'X' } as any })).rejects.toBeInstanceOf(TenantGuardError);
  });

  it('throws when an updateMany omits tenantId', async () => {
    await expect(prisma.lead.updateMany({ where: { score: 0 } as any, data: { score: 1 } })).rejects.toBeInstanceOf(
      TenantGuardError,
    );
  });

  it('excludes soft-deleted rows from reads by default', async () => {
    const victim = fx.a.leadIds[fx.a.leadIds.length - 1];
    await prisma.lead.update({ where: { tenantId: fx.a.tenantId, id: victim }, data: { deletedAt: new Date() } });
    const rows = await prisma.lead.findMany({ where: { tenantId: fx.a.tenantId } });
    expect(rows.map((r) => r.id)).not.toContain(victim);
  });
});
