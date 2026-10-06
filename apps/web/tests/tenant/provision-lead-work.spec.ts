import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

/**
 * The migration that repairs workspaces already created without the lists. Run
 * here as written, with one condition added: only this spec's workspaces, so a
 * parallel spec's tenants are never touched.
 */
describe('the repair migration 20261006000000_provision_lead_work', () => {
  const sql = readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations', '20261006000000_provision_lead_work', 'migration.sql'),
    'utf8',
  );
  const run = (ids: string[]) =>
    withPlatformTx(async (tx) => {
      const scoped = sql.replaceAll(
        'WHERE t."deletedAt" IS NULL',
        `WHERE t."deletedAt" IS NULL AND t."id" IN (${ids.map((id) => `'${id}'`).join(', ')})`,
      );
      for (const statement of scoped.split(/;\s*\n/).filter((part) => /INSERT INTO/.test(part))) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  const entitle = (tenantId: string, module: 'SALES' | 'REAL_ESTATE' | 'HRMS', state: 'ACTIVE' | 'CANCELED') =>
    prisma.moduleEntitlement.create({ data: { tenantId, module, state } });

  let realtyOnly = '';
  let ownStages = '';
  let hrOnly = '';
  let cancelled = '';

  beforeAll(async () => {
    realtyOnly = await workspace('m-realty');
    ownStages = await workspace('m-own');
    hrOnly = await workspace('m-hr');
    cancelled = await workspace('m-cancelled');
    await entitle(realtyOnly, 'REAL_ESTATE', 'ACTIVE');
    await entitle(ownStages, 'SALES', 'ACTIVE');
    await prisma.leadStage.create({ data: { tenantId: ownStages, key: 'enquiry', name: 'Enquiry', position: 1 } });
    await entitle(hrOnly, 'HRMS', 'ACTIVE');
    await entitle(cancelled, 'REAL_ESTATE', 'CANCELED');
    await run([realtyOnly, ownStages, hrOnly, cancelled]);
  });

  it('repairs a Real-Estate-only workspace that has no lists', async () => {
    expect(await counts(realtyOnly)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await prisma.leadStage.count({ where: { tenantId: realtyOnly, isDefault: true } })).toBe(1);
  });

  it('keeps a workspace’s own stages, and fills only its empty lists', async () => {
    expect(await counts(ownStages)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });

  it('touches neither an HR-only workspace nor one whose lead module is cancelled', async () => {
    expect(await counts(hrOnly)).toEqual({ stages: 0, activityTypes: 0, taskTypes: 0 });
    expect(await counts(cancelled)).toEqual({ stages: 0, activityTypes: 0, taskTypes: 0 });
  });

  it('adds nothing when it runs again', async () => {
    await run([realtyOnly, ownStages]);
    expect(await counts(realtyOnly)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await counts(ownStages)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });
});
