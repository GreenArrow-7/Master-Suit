import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { invalidateEntitlements, workspaceLanding } from '@/lib/security/entitlements';

/**
 * Owner decision (18 Oct): a workspace whose only product is Lead Eagle opens on
 * the Lead Eagle board after sign-in; every other workspace on its summary.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const slug = `landing-${suffix}`;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Landing LLC', displayName: 'Landing', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('where a workspace opens after sign-in', () => {
  it('Lead Eagle alone: its board', async () => {
    expect(await workspaceLanding(tenantId, slug)).toBe(`/${slug}/lead-eagle/dashboard`);
  });

  it('Lead Eagle with another product, or a lapsed Lead Eagle: the workspace summary', async () => {
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
    await invalidateEntitlements(tenantId);
    expect(await workspaceLanding(tenantId, slug)).toBe(`/${slug}/dashboard`);

    await prisma.moduleEntitlement.deleteMany({ where: { tenantId, module: 'HRMS' } });
    await prisma.moduleEntitlement.updateMany({
      where: { tenantId, module: 'LEAD_EAGLE' },
      data: { state: 'SUSPENDED' },
    });
    await invalidateEntitlements(tenantId);
    expect(await workspaceLanding(tenantId, slug)).toBe(`/${slug}/dashboard`);
  });
});
