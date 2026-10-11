import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { isEntitlementUsable } from '@/lib/security/entitlements';
import { PATCH as editWorkspace } from '@/app/api/v1/platform/workspaces/[workspaceId]/route';
import { createPlatformSessionToken } from '../helpers/session';
import { patch } from '../helpers/request';

/**
 * The platform console's workspace edit form sends trialEndsAt (prefilled with
 * the stored date) and enabledModules on every save. Saving used to write that
 * date into every module's end, so a paying customer whose trial ended long ago
 * lost every module when anyone fixed, say, the company phone (10 Oct).
 */
const suffix = randomBytes(4).toString('hex');
let ownerCookie = '';

async function workspace(slug: string, state: 'TRIAL' | 'ACTIVE', trialEndsAt: Date, endsAt: Date | null) {
  const plan = await prisma.subscriptionPlan.create({
    data: { code: `edit-${slug}-${suffix}`, name: 'Edit plan', modules: ['LEAD_EAGLE'], seatLimit: 5, storageMb: 512 },
  });
  const tenant = await prisma.tenant.create({
    data: {
      slug: `edit-${slug}-${suffix}`,
      legalName: 'Edit LLC',
      displayName: 'Edit Co',
      planCode: plan.code,
      trialEndsAt,
    },
  });
  await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: 'LEAD_EAGLE', state, endsAt } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, planId: plan.id, state } });
  return tenant.id;
}

const save = (id: string, body: Record<string, unknown>) =>
  patch(editWorkspace, `/api/v1/platform/workspaces/${id}`, body, ownerCookie, { workspaceId: id });
const entitlement = (tenantId: string) =>
  prisma.moduleEntitlement.findFirstOrThrow({ where: { tenantId, module: 'LEAD_EAGLE' } });

beforeAll(async () => {
  const owner = await prisma.platformUser.create({
    data: {
      email: `edit.owner.${suffix}@platform.test`,
      normalizedEmail: `edit.owner.${suffix}@platform.test`,
      fullName: 'Edit Owner',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerCookie = await createPlatformSessionToken(owner.id);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { contains: suffix } } }).catch(() => {});
  await prisma.subscriptionPlan.deleteMany({ where: { code: { contains: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('platform workspace edit', () => {
  it('leaves a paying customer’s modules alone when an unrelated field is saved', async () => {
    const id = await workspace('paying', 'ACTIVE', new Date('2026-01-01T09:30:00Z'), null);
    // What the form sends: the change, plus the prefilled trial end and modules.
    const res = await save(id, {
      companyPhone: '+971 4 000 0000',
      trialEndsAt: '2026-01-01',
      enabledModules: ['LEAD_EAGLE'],
    });
    expect(res.status).toBe(200);
    const row = await entitlement(id);
    expect(row.endsAt).toBeNull();
    expect(isEntitlementUsable(row)).toBe(true);
  });

  it('moves a trial workspace’s module end when its trial end is changed', async () => {
    const end = new Date('2099-01-01T10:00:00Z');
    const id = await workspace('trial', 'TRIAL', end, end);

    // Saved unchanged: the module keeps its exact end, time of day included.
    expect(
      (await save(id, { companyPhone: '+971 4 111 1111', trialEndsAt: '2099-01-01', enabledModules: ['LEAD_EAGLE'] }))
        .status,
    ).toBe(200);
    expect((await entitlement(id)).endsAt?.toISOString()).toBe(end.toISOString());

    // Extended: the module follows.
    expect((await save(id, { trialEndsAt: '2099-02-01', enabledModules: ['LEAD_EAGLE'] })).status).toBe(200);
    expect((await entitlement(id)).endsAt?.toISOString().slice(0, 10)).toBe('2099-02-01');
  });
});
