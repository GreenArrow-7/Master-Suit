import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { mockOutbox } from '@/lib/mailer';
import { readPrefs } from '@/lib/notificationPrefs';
import { pushRecord } from '@/workers/notifications';
import { GET as readMine, PUT as saveMine } from '@/app/api/v1/notification-preferences/route';
import { createWorkspaceUser } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, put } from '../helpers/request';

// Audit M17-11, M17-03: each person chooses phone and email copies; email is opt-in.
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const people: Record<'wants' | 'quiet', { id: string; email: string; cookie: string }> = {} as never;

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `prefs-${suffix}`, legalName: 'Prefs LLC', displayName: 'Prefs', status: 'ACTIVE' },
    })
  ).id;
  const role = await prisma.role.create({
    data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  for (const label of ['wants', 'quiet'] as const) {
    const email = `${label}-${suffix}@prefs.test`;
    const user = await createWorkspaceUser({ tenantId, roleId: role.id, email, fullName: label });
    people[label] = { id: user.id, email, cookie: await createSessionToken(tenantId, user.id) };
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

beforeEach(() => mockOutbox.clear());

it('defaults to push on and email off', () => {
  expect(readPrefs(undefined)).toEqual({ push: true, email: false });
  expect(readPrefs({ push: false, email: true })).toEqual({ push: false, email: true });
});

it('saves your own choice and reads it back', async () => {
  const saved = await put(
    saveMine,
    '/api/v1/notification-preferences',
    { push: true, email: true },
    people.wants.cookie,
  );
  expect(saved.status).toBe(200);
  expect((await get(readMine, '/api/v1/notification-preferences', people.wants.cookie)).body).toEqual({
    push: true,
    email: true,
  });
});

it('emails only the person who asked for email copies', async () => {
  await prisma.user.updateMany({
    where: { tenantId, id: people.wants.id },
    data: { notificationPrefs: { push: true, email: true } },
  });
  const result = await pushRecord({
    tenantId,
    userIds: [people.wants.id, people.quiet.id],
    title: 'Follow-up due: Marco Haddad',
    body: 'Due soon',
    objectType: 'lead',
    recordId: 'lead-1',
  });
  expect(result.emailed).toBe(1);
  expect(mockOutbox.all().map((mail) => [mail.to, mail.subject])).toEqual([
    [people.wants.email, 'Follow-up due: Marco Haddad'],
  ]);
});
