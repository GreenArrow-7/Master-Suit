/**
 * Notifications: does the person who has to act actually get told?
 *
 * The gap this closed was that every HR approval queue was pull-only. So the
 * cases below are about reach rather than about wording:
 *
 *   1. a request reaches whoever holds the permission to decide it — resolved
 *      through RolePermission, so a workspace with its own role names works;
 *   2. a decision reaches the person who asked;
 *   3. the actor is never notified about their own action;
 *   4. a notification failure never rolls back the decision that caused it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { notifyHr } from '@/services/hr/notify';
import { decideOvertime, requestOvertime } from '@/services/hr/overtime';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `ntf-${suffix}`;

let tenantId = '';
let approverRoleId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[]) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, 'ORGANIZATION'])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants) }));

const STAFF = [['employee', 'VIEW']] as const;
const APPROVER = [
  ['overtime', 'APPROVE'],
  ['employee', 'VIEW'],
] as const;

async function makeEmployee(label: string, roleId: string) {
  const email = `${label}-${suffix}@notify.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${label.toUpperCase()}-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date('2020-01-01'),
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
}

const inboxOf = (label: string) =>
  prisma.notification.findMany({ where: { tenantId, userId: userIds[label]! }, orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Notify LLC', displayName: 'Notify', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  // A plain role, and a role that actually holds overtime:APPROVE. Recipients
  // are resolved from the grant, not from a role name, so this is what makes the
  // approver reachable.
  const plain = await prisma.role.create({
    data: { tenantId, key: `plain-${suffix}`, name: 'Plain', rank: 90, defaultScope: 'OWN' },
  });
  const approverRole = await prisma.role.create({
    data: { tenantId, key: `approver-${suffix}`, name: 'Overtime Approver', rank: 20, defaultScope: 'ORGANIZATION' },
  });
  approverRoleId = approverRole.id;
  const permission = await prisma.permission.upsert({
    where: { module_action: { module: 'overtime', action: 'APPROVE' } },
    update: {},
    create: { module: 'overtime', action: 'APPROVE' },
  });
  await prisma.rolePermission.create({
    data: { tenantId, roleId: approverRole.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
  });

  await makeEmployee('worker', plain.id);
  await makeEmployee('manager', approverRole.id);
  await makeEmployee('bystander', plain.id);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('reaching the right people', () => {
  let claimId = '';

  it('tells whoever holds the deciding permission, and nobody else', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-02'),
      minutes: 90,
      reason: 'Month end',
    });
    claimId = claim.id;

    const manager = await inboxOf('manager');
    expect(manager).toHaveLength(1);
    expect(manager[0]!.kind).toBe('overtime.requested');
    expect(manager[0]!.actionUrl).toBe('/people/overtime');

    // Resolved through the permission grant, so somebody on a role without it
    // hears nothing — the whole point of not keying on role names.
    expect(await inboxOf('bystander')).toHaveLength(0);
  });

  it('does not notify the person who took the action', async () => {
    // The requester raised it; being told about your own request is the noise
    // that makes people mute a queue.
    expect(await inboxOf('worker')).toHaveLength(0);
  });

  it('tells the requester when the decision lands', async () => {
    await decideOvertime(ctxFor('manager', APPROVER), claimId, true);

    const worker = await inboxOf('worker');
    expect(worker).toHaveLength(1);
    expect(worker[0]!.kind).toBe('overtime.decided');
    expect(worker[0]!.title).toMatch(/approved/i);

    // And the approver is not told about their own decision.
    expect(await inboxOf('manager')).toHaveLength(1);
  });

  it('queues the email rather than sending it inline', async () => {
    const rows = await prisma.notification.findMany({ where: { tenantId, kind: 'overtime.decided' } });
    // Written unsent: the worker stamps emailedAt. A payroll approval must not
    // wait on an SMTP host.
    expect(rows.every((row) => row.emailedAt === null)).toBe(true);
    expect(rows.every((row) => row.channels.includes('email'))).toBe(true);
  });
});

describe('failure containment', () => {
  it('never lets a notification failure roll back the decision', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-03'),
      minutes: 60,
      reason: 'Deployment',
    });

    // The queue is the part most likely to be unavailable in production — Redis
    // down, or simply not running in a test environment.
    const queue = await import('@/lib/queue');
    const spy = vi.spyOn(queue, 'enqueue').mockRejectedValue(new Error('redis is down'));
    try {
      const decided = await decideOvertime(ctxFor('manager', APPROVER), claim.id, true);
      // The decision is the durable thing. A missing email is a smaller problem
      // than an approval that silently did not happen.
      expect(decided.status).toBe('APPROVED');
    } finally {
      spy.mockRestore();
    }

    const persisted = await prisma.hrOvertimeRequest.findFirstOrThrow({ where: { tenantId, id: claim.id } });
    expect(persisted.status).toBe('APPROVED');
  });

  it('returns zero recipients rather than throwing when nobody holds the permission', async () => {
    const result = await notifyHr(ctxFor('worker', STAFF), {
      event: 'payroll.submitted',
      audience: { permission: ['payroll', 'APPROVE'] },
      title: 'Nobody can approve payroll here',
    });
    expect(result.recipients).toBe(0);
  });
});

describe('permission-resolved audiences', () => {
  it('follows a grant moved to another role rather than a fixed role name', async () => {
    const newRole = await prisma.role.create({
      data: { tenantId, key: `moved-${suffix}`, name: 'Moved', rank: 20, defaultScope: 'ORGANIZATION' },
    });
    const permission = await prisma.permission.findFirstOrThrow({
      where: { module: 'overtime', action: 'APPROVE' },
    });
    // Take the authority off the original role and give it to a new one.
    await prisma.rolePermission.deleteMany({ where: { tenantId, roleId: approverRoleId } });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: newRole.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
    await prisma.user.update({ where: { tenantId, id: userIds.bystander! }, data: { roleId: newRole.id } });

    await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-04'),
      minutes: 45,
      reason: 'Stock count',
    });

    // The bystander now holds the authority, so they are the one told.
    const bystander = await inboxOf('bystander');
    expect(bystander.some((row) => row.kind === 'overtime.requested')).toBe(true);
  });
});
