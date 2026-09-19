import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { workspaceValue } from '@/services/leadership/rollups';
import { MINUTES_PER_ACTION } from '@/lib/value/platformValue';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/** §16: the workspace value view counts real rows and converts them with the stated minutes. */
let fixture: Fixture;
const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const at = new Date('2026-09-10T10:00:00Z');

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;
  await prisma.lead.updateMany({
    where: { tenantId: T, id: { in: fixture.a.leadIds.slice(0, 2) } },
    data: { source: 'IMPORT', createdAt: at },
  });
  const call = await prisma.call.create({
    data: { tenantId: T, leadId: fixture.a.leadIds[0], callerId: fixture.a.userId, status: 'COMPLETED', createdAt: at },
  });
  await prisma.aIAnalysis.create({
    data: {
      tenantId: T,
      callId: call.id,
      status: 'COMPLETED',
      modelId: 'gemini-test',
      humanCorrected: true,
      createdAt: at,
    },
  });
});
afterAll(async () => {
  await fixture.cleanup();
});

describe('workspace value', () => {
  it('counts imported leads and model analyses, converts to hours, and rates human correction', async () => {
    const v = await workspaceValue(fixture.a.tenantId, RANGE);
    expect(v.leadsImported).toBe(2);
    expect(v.callsAnalysed).toBe(1);
    expect(v.humanInterventionRate).toBe(100);
    const minutes = 2 * MINUTES_PER_ACTION.leadsImported + 1 * MINUTES_PER_ACTION.callsAnalysed;
    expect(v.hoursSaved).toBe(Math.round(minutes / 60));
    expect(v.dealTurnaroundDays).toBeNull();
  });

  it('stays inside the tenant', async () => {
    const v = await workspaceValue(fixture.b.tenantId, RANGE);
    expect(v.leadsImported).toBe(0);
    expect(v.callsAnalysed).toBe(0);
  });
});
