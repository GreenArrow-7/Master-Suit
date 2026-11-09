/**
 * Who may be named as somebody's reporting manager.
 *
 * The Add-user form offered every employee whose own record was not EXITED,
 * without looking at the login behind it, so deleted and suspended accounts —
 * and the accounts a test run had left behind — appeared in the picker and
 * could be saved. A manager approves leave and reads a payslip; an account
 * that cannot sign in cannot do either, and a leave request routed to one
 * waits forever with nobody able to act on it.
 *
 * The rule belongs on the server, not in the picker: the form sends an id, and
 * anything that sends an id reaches the same path.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setManager } from '@/services/identity/accounts';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createEmployee, seedTwoTenants } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

describe('setManager', () => {
  const suffix = randomBytes(4).toString('hex');
  let fixture: Awaited<ReturnType<typeof seedTwoTenants>>;
  let ctx: Ctx;
  let reportId: string;
  let managerId: string;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    const tenantId = fixture.a.tenantId;
    ctx = buildCtx(buildActor({ id: fixture.a.userId, tenantId, grants: [['employee', 'UPDATE']] as const }));
    const report = await createEmployee({ tenantId, label: 'report', suffix });
    const manager = await createEmployee({ tenantId, label: 'manager', suffix });
    reportId = report.employeeId;
    managerId = manager.employeeId;
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it('accepts a manager whose login is active', async () => {
    const updated = await setManager(ctx, reportId, managerId);
    expect(updated.managerMembershipId).toBeTruthy();
  });

  it('refuses a manager whose login is suspended', async () => {
    const manager = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: managerId },
      select: { membershipId: true },
    });
    await prisma.workspaceMembership.update({
      where: { tenantId: fixture.a.tenantId, id: manager.membershipId },
      data: { status: 'SUSPENDED' },
    });

    await expect(setManager(ctx, reportId, managerId)).rejects.toThrow(/not active/i);

    await prisma.workspaceMembership.update({
      where: { tenantId: fixture.a.tenantId, id: manager.membershipId },
      data: { status: 'ACTIVE' },
    });
  });

  it('refuses a manager whose login was removed', async () => {
    const manager = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: managerId },
      select: { membershipId: true },
    });
    await prisma.workspaceMembership.update({
      where: { tenantId: fixture.a.tenantId, id: manager.membershipId },
      data: { status: 'REMOVED' },
    });

    await expect(setManager(ctx, reportId, managerId)).rejects.toThrow(/not active/i);
  });
});
