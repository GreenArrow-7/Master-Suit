import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as logActivity } from '@/app/api/v1/activities/route';
import { post } from '../helpers/request';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * An activity logged offline is sent later, and perhaps twice (the answer to
 * the first send lost on a weak signal). Its request key makes the second send
 * a replay, and its own time is kept (Lead Eagle plan, gap 9).
 */
let fixture: Fixture;
let typeId: string;
const url = '/api/v1/activities';

beforeAll(async () => {
  fixture = await seedTwoTenants();
  typeId = (await prisma.activityType.create({ data: { tenantId: fixture.a.tenantId, key: 'call_out', name: 'Call' } }))
    .id;
});

afterAll(async () => {
  await fixture.cleanup();
});

const body = (extra: Record<string, unknown>) => ({
  typeId,
  leadId: fixture.a.leadIds[0]!,
  notes: 'Called back',
  ...extra,
});

describe('logging an activity later', () => {
  it('logs it once however many times it is sent, at the time it happened', async () => {
    const requestKey = randomUUID();
    const occurredAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const first = await post(logActivity, url, body({ requestKey, occurredAt }), fixture.a.cookie);
    const again = await post(logActivity, url, body({ requestKey, occurredAt }), fixture.a.cookie);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const rows = await prisma.activity.findMany({ where: { tenantId: fixture.a.tenantId, notes: 'Called back' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurredAt.toISOString()).toBe(occurredAt);
  });

  it('refuses the same key carrying something else', async () => {
    const requestKey = randomUUID();
    expect((await post(logActivity, url, body({ requestKey }), fixture.a.cookie)).status).toBe(200);
    expect((await post(logActivity, url, body({ requestKey, notes: 'Other' }), fixture.a.cookie)).status).toBe(409);
  });

  it('keeps a back-dated activity within the week, and not ahead', async () => {
    const tooOld = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    expect((await post(logActivity, url, body({ occurredAt: tooOld }), fixture.a.cookie)).status).toBe(422);
    expect((await post(logActivity, url, body({ occurredAt: ahead }), fixture.a.cookie)).status).toBe(422);
  });
});
