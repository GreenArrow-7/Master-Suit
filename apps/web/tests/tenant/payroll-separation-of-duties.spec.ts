import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ctxForUser } from '@/lib/auth/session';
import { approveRun, createRun } from '@/services/hr/payroll';
import { ROLE_TEMPLATES } from '@/lib/roles/templates';
import { createEmployee, grantPermissions, type Grants } from '../helpers/fixtures';

/**
 * Who may prepare a payroll run and who may sign it off, with the six-role
 * templates in place.
 *
 * The brief asks this not be taken on trust: an approval permission is not the
 * same thing as an identity check, and a role matrix that merely *looks*
 * separated is worth nothing. Two controls have to hold, and they are
 * independent of each other:
 *
 *   1. **The role.** The HR Administrator template grants `payroll:EDIT` and
 *      withholds `payroll:APPROVE`, so the person who prepares runs cannot
 *      decide them.
 *   2. **The record.** `approveRun` refuses `preparedById === actor.id`
 *      whatever the role holds — so even a workspace that grants one account
 *      both permissions cannot have it approve its own work.
 *
 * (2) is the one that matters when an administrator edits the templates, which
 * they are free to do. It is tested by granting exactly that combination.
 */
const suffix = randomBytes(4).toString('hex');
const tenantIds: string[] = [];

const template = (key: string) => ROLE_TEMPLATES.find((t) => t.key === key)!;

/** A role holding exactly the template's grants. */
async function roleFromTemplate(tenantId: string, key: string, rank: number) {
  const spec = template(key);
  const role = await prisma.role.create({
    data: { tenantId, key: `${key}-${suffix}`, name: spec.name, rank, defaultScope: spec.defaultScope },
  });
  await grantPermissions(
    tenantId,
    role.id,
    spec.grants.map((grant) => [grant.module, grant.action] as const) as Grants,
    'ORGANIZATION',
  );
  return role;
}

afterAll(async () => {
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
});

describe('payroll: who prepares and who approves', () => {
  it('the HR Administrator template prepares a run and cannot approve it; an independent approver can', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `sod-${suffix}`, legalName: `SoD ${suffix} LLC`, displayName: 'SoD', status: 'ACTIVE' },
    });
    tenantIds.push(tenant.id);

    const hrRole = await roleFromTemplate(tenant.id, 'hr_administrator', 35);
    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        key: `admin-${suffix}`,
        name: 'Company Administrator',
        rank: 10,
        defaultScope: 'ORGANIZATION',
      },
    });
    await grantPermissions(tenant.id, adminRole.id, [
      ['payroll', 'VIEW'],
      ['payroll', 'APPROVE'],
      ['employee', 'VIEW'],
    ]);

    const hr = await createEmployee({ tenantId: tenant.id, label: 'hr', suffix, roleId: hrRole.id });
    const boss = await createEmployee({ tenantId: tenant.id, label: 'boss', suffix, roleId: adminRole.id });
    const hrCtx = await ctxForUser(hr.userId, tenant.id, `sod-hr-${suffix}`);
    const bossCtx = await ctxForUser(boss.userId, tenant.id, `sod-boss-${suffix}`);

    // 1. HR prepares. This is the template's `payroll:CREATE`/`EDIT` at work.
    const run = await createRun(hrCtx, new Date('2026-01-01'), new Date('2026-01-31'), 'January');
    expect(run.preparedById).toBe(hr.employeeId);

    await prisma.hrPayrollRun.update({
      where: { tenantId: tenant.id, id: run.id },
      data: { status: 'PENDING_APPROVAL' },
    });

    // 2. HR cannot approve: the template withholds payroll:APPROVE.
    await expect(approveRun(hrCtx, run.id, true)).rejects.toThrow(/does not allow approving/i);

    // 3. The independent approver can.
    const approved = await approveRun(bossCtx, run.id, true);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedById).toBe(boss.employeeId);
  });

  it('refuses self-approval even when one account holds both permissions', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `sod2-${suffix}`, legalName: `SoD2 ${suffix} LLC`, displayName: 'SoD2', status: 'ACTIVE' },
    });
    tenantIds.push(tenant.id);

    // A workspace that has edited the template to grant both — which an
    // administrator may do, and which the role matrix alone would not catch.
    const bothRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        key: `both-${suffix}`,
        name: 'Payroll (both)',
        rank: 20,
        defaultScope: 'ORGANIZATION',
      },
    });
    await grantPermissions(tenant.id, bothRole.id, [
      ['payroll', 'VIEW'],
      ['payroll', 'CREATE'],
      ['payroll', 'EDIT'],
      ['payroll', 'APPROVE'],
      ['employee', 'VIEW'],
    ]);

    const maker = await createEmployee({ tenantId: tenant.id, label: 'maker', suffix, roleId: bothRole.id });
    const checker = await createEmployee({ tenantId: tenant.id, label: 'checker', suffix, roleId: bothRole.id });
    const makerCtx = await ctxForUser(maker.userId, tenant.id, `sod2-maker-${suffix}`);
    const checkerCtx = await ctxForUser(checker.userId, tenant.id, `sod2-checker-${suffix}`);

    const run = await createRun(makerCtx, new Date('2026-02-01'), new Date('2026-02-28'), 'February');
    await prisma.hrPayrollRun.update({
      where: { tenantId: tenant.id, id: run.id },
      data: { status: 'PENDING_APPROVAL' },
    });

    // Holds payroll:APPROVE, and is still refused — the control is on the
    // record, not the role.
    await expect(approveRun(makerCtx, run.id, true)).rejects.toThrow(/you prepared this run/i);

    // Someone else holding the same role may approve it, so the workflow is
    // not blocked — it needs a second person, which is the point.
    const approved = await approveRun(checkerCtx, run.id, true);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedById).toBe(checker.employeeId);
  });

  it('the template itself withholds the approval permission', () => {
    const held = template('hr_administrator').grants.map((g) => `${g.module}:${g.action}`);
    expect(held).toContain('payroll:EDIT');
    expect(held).not.toContain('payroll:APPROVE');
  });
});
