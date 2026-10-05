import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { provisionLeadWork } from '@/services/platform/provisioning';

/**
 * The starting lists a workspace needs before it can take a lead — for every
 * module that works leads, not Sales alone (a Real-Estate-only or
 * Lead-Eagle-only workspace from the wizard could not create its first lead) —
 * and never a reset of a workspace that has made its own.
 */
const suffix = randomBytes(4).toString('hex');
const tenantIds: string[] = [];

async function workspace(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `prov-${label}-${suffix}`, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  tenantIds.push(tenant.id);
  return tenant.id;
}

const counts = async (tenantId: string) => ({
  stages: await prisma.leadStage.count({ where: { tenantId } }),
  activityTypes: await prisma.activityType.count({ where: { tenantId } }),
  taskTypes: await prisma.taskType.count({ where: { tenantId } }),
});

let fresh = '';
let customised = '';

beforeAll(async () => {
  fresh = await workspace('fresh');
  customised = await workspace('custom');
  await prisma.leadStage.create({ data: { tenantId: customised, key: 'enquiry', name: 'Enquiry', position: 1 } });
});

afterAll(async () => {
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
});

describe('provisionLeadWork', () => {
  it('gives a new workspace its stages, activity types and task types, with a default stage', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, fresh));
    expect(await counts(fresh)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await prisma.leadStage.count({ where: { tenantId: fresh, isDefault: true } })).toBe(1);
  });

  it('adds nothing the second time', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, fresh));
    expect(await counts(fresh)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
  });

  it('leaves a workspace’s own stages alone, and still fills what is empty', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, customised));
    expect(await counts(customised)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });
});
