import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as createActivity } from '@/app/api/v1/activities/route';
import { POST as createCall } from '@/app/api/v1/calls/route';
import { PATCH as patchCall } from '@/app/api/v1/calls/[id]/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { patch, post } from '../helpers/request';

/**
 * Working a lead — logging an activity, placing or finishing a call — stamps
 * `lastActivityAt`, which the untouched count and the work-gated check-out read.
 * Nothing wrote it before 19 Sep 2026.
 */
let fixture: Fixture;
const stamp = (id: string, tenantId: string) =>
  prisma.lead
    .findFirstOrThrow({ where: { tenantId, id }, select: { lastActivityAt: true } })
    .then((l) => l.lastActivityAt);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  await prisma.lead.updateMany({ where: { tenantId: fixture.a.tenantId }, data: { lastActivityAt: null } });
});
afterAll(async () => {
  await fixture.cleanup();
});

describe('lead.lastActivityAt', () => {
  it('is set when an activity is logged against the lead', async () => {
    const leadId = fixture.a.leadIds[0];
    const type = await prisma.activityType.upsert({
      where: { tenantId_key: { tenantId: fixture.a.tenantId, key: 'note' } },
      update: {},
      create: { tenantId: fixture.a.tenantId, key: 'note', name: 'Note' },
    });
    expect(await stamp(leadId, fixture.a.tenantId)).toBeNull();
    const res = await post(
      createActivity,
      '/api/v1/activities',
      { typeId: type.id, leadId, notes: 'called' },
      fixture.a.cookie,
    );
    expect(res.status).toBe(200);
    expect(await stamp(leadId, fixture.a.tenantId)).not.toBeNull();
  });

  it('is set when a call is placed and again when it is completed', async () => {
    const leadId = fixture.a.leadIds[1];
    const created = await post(
      createCall,
      '/api/v1/calls',
      { leadId, recipientNumber: '+971501112233' },
      fixture.a.cookie,
    );
    expect(created.status).toBe(200);
    const first = await stamp(leadId, fixture.a.tenantId);
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const done = await patch(
      patchCall,
      `/api/v1/calls/${created.body.id}`,
      { status: 'COMPLETED', outcome: 'INTERESTED' },
      fixture.a.cookie,
      { id: created.body.id },
    );
    expect(done.status).toBe(200);
    expect((await stamp(leadId, fixture.a.tenantId))!.getTime()).toBeGreaterThan(first!.getTime());
  });
});
