import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// The transports are the owner's keys; the route's own logic is what is under test.
const push = vi.hoisted(() => ({ configured: false, sent: 0, stale: [] as string[] }));
vi.mock('@/lib/push/send', () => ({
  pushConfigured: () => push.configured,
  sendPush: vi.fn(async () => ({ sent: push.sent, stale: push.stale })),
}));

import { prisma } from '@/lib/db';
import { sendPush } from '@/lib/push/send';
import { POST as sendTest } from '@/app/api/v1/notification-preferences/test/route';
import { createWorkspaceUser } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { post } from '../helpers/request';

// M17-02 / M20-08: one tap confirms phone notifications end to end, and says which link is missing.
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let userId = '';
let cookie = '';

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `push-test-${suffix}`, legalName: 'Push LLC', displayName: 'Push', status: 'ACTIVE' },
    })
  ).id;
  const role = await prisma.role.create({
    data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  userId = (await createWorkspaceUser({ tenantId, roleId: role.id, email: `a@push-${suffix}.test`, fullName: 'Agent' }))
    .id;
  cookie = await createSessionToken(tenantId, userId);
});

afterAll(async () => {
  await prisma.deviceToken.deleteMany({ where: { userId } });
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

beforeEach(() => {
  vi.mocked(sendPush).mockClear();
});

it('says push is not set up when the server has no keys, and sends nothing', async () => {
  push.configured = false;
  const res = await post(sendTest, '/api/v1/notification-preferences/test', {}, cookie);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ configured: false, devices: 0, sent: 0 });
  expect(sendPush).not.toHaveBeenCalled();
});

it('says no phone is registered when the keys exist but the person has no device', async () => {
  push.configured = true;
  const res = await post(sendTest, '/api/v1/notification-preferences/test', {}, cookie);
  expect(res.body).toEqual({ configured: true, devices: 0, sent: 0 });
  expect(sendPush).not.toHaveBeenCalled();
});

it('sends to your own devices only and drops a token the transport rejects', async () => {
  push.configured = true;
  await prisma.deviceToken.createMany({
    data: [
      { userId, token: `good-${suffix}`, platform: 'android' },
      { userId, token: `gone-${suffix}`, platform: 'ios' },
    ],
  });
  push.sent = 1;
  push.stale = [`gone-${suffix}`];
  const res = await post(sendTest, '/api/v1/notification-preferences/test', {}, cookie);
  expect(res.body).toEqual({ configured: true, devices: 1, sent: 1 });
  const [targets] = vi.mocked(sendPush).mock.calls[0]!;
  expect(targets.map((t) => t.token).sort()).toEqual([`gone-${suffix}`, `good-${suffix}`]);
  expect(await prisma.deviceToken.count({ where: { userId } })).toBe(1);
});
