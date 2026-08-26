/**
 * P1-13 — a People-only workspace could not read its own notifications.
 *
 * `services/hr/notify.ts` writes an in-app row for eighteen HR events: leave and
 * overtime decisions, payroll submissions, requisitions, interviews, offers,
 * reviews, improvement plans. `/api/v1/notifications` was gated on
 * `leads:VIEW` — a Sales permission — so every one of those rows was written for
 * people who got a 403 when they went to read it.
 *
 * The screen made it worse by looking correct: the page declares `SELF_SERVICE`,
 * so it rendered, and only the fetch behind it failed.
 *
 * These tests pin the rule the API kernel's own docstring states: self-service is
 * not a privilege. A user holding no Sales permission at all must be able to read
 * and clear their own notifications, and must still see nobody else's.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listNotifications, PATCH as markRead } from '@/app/api/v1/notifications/route';
import { createSessionToken } from '../helpers/session';
import { get, patch } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `notif-${suffix}`;

let tenantId = '';
const users: Record<string, { id: string; cookie: string }> = {};

/** A member holding exactly these `module:ACTION` grants at ORGANIZATION scope. */
async function member(label: string, grants: readonly (readonly [string, string])[]) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action: action as never } },
      update: {},
      create: { module, action: action as never },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const user = await prisma.user.create({
    data: { tenantId, email: `${label}-${suffix}@notif.test`, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `${label}-${suffix}@notif.test`,
      normalizedEmail: `${label}-${suffix}@notif.test`,
      fullName: label,
      status: 'ACTIVE',
    },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  users[label] = { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Notif LLC', displayName: 'Notif', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  // Both modules entitled, so the failure this pins can only be the permission
  // gate and never the entitlement check.
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId, module: 'HRMS', state: 'ACTIVE' },
      { tenantId, module: 'SALES', state: 'ACTIVE' },
    ],
  });

  // The person the bug was about: HR only, no Sales permission of any kind.
  await member('hronly', [
    ['employee', 'VIEW'],
    ['leave', 'APPROVE'],
  ]);
  // Someone else in the same workspace, to prove scoping still holds.
  await member('colleague', [['employee', 'VIEW']]);

  await prisma.notification.createMany({
    data: [
      { tenantId, userId: users.hronly!.id, kind: 'HR', title: 'Leave approved', body: 'Your leave was approved.' },
      { tenantId, userId: users.hronly!.id, kind: 'HR', title: 'Overtime decided', body: 'Your claim was decided.' },
      { tenantId, userId: users.colleague!.id, kind: 'HR', title: 'Not yours', body: 'Belongs to someone else.' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('own notifications', () => {
  it('are readable by a user holding no Sales permission at all', async () => {
    const response = await get(listNotifications, '/api/v1/notifications', users.hronly!.cookie);
    // The whole point: this was 403 while `notify.ts` filled the table.
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.unreadCount).toBe(2);
  });

  it('never include another member’s, whatever the caller’s scope', async () => {
    const response = await get(listNotifications, '/api/v1/notifications', users.hronly!.cookie);
    expect(response.body.data.map((n: { title: string }) => n.title)).not.toContain('Not yours');
  });

  it('can be marked read without a Sales permission', async () => {
    const mine = await prisma.notification.findMany({
      where: { tenantId, userId: users.hronly!.id },
      select: { id: true },
    });
    const response = await patch(
      markRead,
      '/api/v1/notifications',
      { ids: mine.map((n) => n.id) },
      users.hronly!.cookie,
    );
    expect(response.status).toBe(200);
    expect(response.body.unreadCount).toBe(0);
  });

  it('refuses to mark someone else’s read, even by explicit id', async () => {
    const theirs = await prisma.notification.findFirst({
      where: { tenantId, userId: users.colleague!.id },
      select: { id: true },
    });
    const response = await patch(markRead, '/api/v1/notifications', { ids: [theirs!.id] }, users.hronly!.cookie);
    // Accepted as a no-op rather than refused — the update is scoped by userId,
    // so it matches nothing. What matters is that the row stays unread.
    expect(response.status).toBe(200);
    const after = await prisma.notification.findFirst({ where: { tenantId, id: theirs!.id } });
    expect(after?.readAt).toBeNull();
  });
});
