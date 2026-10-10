/**
 * A high-priority notification has to look and sort like one.
 *
 * `services/leads/intake.ts` writes "X enquired again" with priority HIGH, and
 * the CRM and HR notifiers write HIGH rows of their own, but the feed ordered
 * by `createdAt` alone and neither the bell nor the Inbox read `priority`, so a
 * HIGH row looked like every other entry and sank under newer MEDIUM ones.
 *
 * Both screens now read through `listFeed`: unread HIGH/URGENT rows come
 * first, everything else keeps its recency order, and a row drops back once it
 * is read. The API and the Inbox are asserted to agree, because they used to
 * run two copies of the same query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET, PATCH } from '@/app/api/v1/notifications/route';
import { listFeed } from '@/services/notifications/feed';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { get, patch } from '../helpers/request';

let fixture: Fixture;
let oldHighId = '';

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const now = Date.now();
  const { tenantId, userId } = fixture.a;
  const oldHigh = await prisma.notification.create({
    data: {
      tenantId,
      userId,
      kind: 'lead.enquiry',
      title: 'old high',
      priority: 'HIGH',
      createdAt: new Date(now - 3 * HOUR),
    },
  });
  oldHighId = oldHigh.id;
  await prisma.notification.createMany({
    data: [
      {
        tenantId,
        userId,
        kind: 'lead.assigned',
        title: 'read urgent',
        priority: 'URGENT',
        createdAt: new Date(now - 2 * HOUR),
        readAt: new Date(now),
      },
      { tenantId, userId, kind: 'HR', title: 'new medium', priority: 'MEDIUM', createdAt: new Date(now - 1 * HOUR) },
    ],
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

const titles = (rows: { title: string }[]) => rows.map((n) => n.title);

describe('the notification feed', () => {
  it('returns priority and lifts unread HIGH/URGENT above newer rows', async () => {
    const response = await get(GET, '/api/v1/notifications', fixture.a.cookie);
    expect(response.status).toBe(200);
    expect(titles(response.body.data)).toEqual(['old high', 'new medium', 'read urgent']);
    expect(response.body.data[0].priority).toBe('HIGH');
    for (const row of response.body.data) expect(typeof row.priority).toBe('string');
  });

  it('does not lift a read URGENT row', async () => {
    const response = await get(GET, '/api/v1/notifications', fixture.a.cookie);
    const order = titles(response.body.data);
    expect(order.indexOf('read urgent')).toBeGreaterThan(order.indexOf('new medium'));
  });

  it('gives the Inbox the same order as the bell', async () => {
    const response = await get(GET, '/api/v1/notifications', fixture.a.cookie);
    const inbox = await listFeed(fixture.a.tenantId, fixture.a.userId, 100);
    expect(titles(inbox)).toEqual(titles(response.body.data));
  });

  it('drops a row back to recency once it is read', async () => {
    const marked = await patch(PATCH, '/api/v1/notifications', { ids: [oldHighId] }, fixture.a.cookie);
    expect(marked.status).toBe(200);
    const response = await get(GET, '/api/v1/notifications', fixture.a.cookie);
    expect(titles(response.body.data)).toEqual(['new medium', 'read urgent', 'old high']);
  });
});
