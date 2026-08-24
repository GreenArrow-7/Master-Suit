/**
 * The compliance register (real-estate HRMS §11): it must fold the RERA broker
 * card — which lives on the profile, not the documents table — into the same
 * expiry sweep as visas and labour cards, flag contractors, sort worst-first,
 * and refuse anyone without the authority to read employees.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { complianceRegister } from '@/services/hr/compliance';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Scope } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let brokerId = '';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

const hrCtx = () =>
  buildCtx(
    buildActor({ id: `hr-${suffix}`, tenantId, permissions: new Map([['employee:EDIT', 'ORGANIZATION']]) as never }),
  );
const plainCtx = () =>
  buildCtx(
    buildActor({ id: `p-${suffix}`, tenantId, permissions: new Map([['attendance:VIEW', 'OWN' as Scope]]) as never }),
  );

async function employee(name: string, opts: { employmentType?: string; reraExpiry?: Date; reraBrn?: string } = {}) {
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `${name}-${suffix}@comp.test`,
      normalizedEmail: `${name}-${suffix}@comp.test`,
      fullName: name,
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${name.slice(0, 3).toUpperCase()}-${suffix}`,
      employmentStatus: 'ACTIVE',
      employmentType: opts.employmentType ?? 'full_time',
      reraExpiry: opts.reraExpiry ?? null,
      reraBrn: opts.reraBrn ?? null,
    },
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `comp-${suffix}`, legalName: 'Comp LLC', displayName: 'Comp', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  // A broker whose RERA card lapsed last week (profile field, expired).
  const broker = await employee('Broker', { reraExpiry: inDays(-7), reraBrn: `BRN${suffix}` });
  brokerId = broker.id;
  // A staffer with a visa expiring in 20 days (document row).
  const staff = await employee('Staffer');
  await prisma.hrEmployeeDocument.create({
    data: {
      tenantId,
      employeeId: staff.id,
      kind: 'Residence visa',
      name: 'Residence visa',
      number: `V${suffix}`,
      expiresAt: inDays(20),
    },
  });
  // A contractor with a labour card expiring in 80 days.
  const contractor = await employee('Contractor', { employmentType: 'contractor' });
  await prisma.hrEmployeeDocument.create({
    data: {
      tenantId,
      employeeId: contractor.id,
      kind: 'Labour card',
      name: 'Labour card',
      number: `L${suffix}`,
      expiresAt: inDays(80),
    },
  });
  // Something far out that must not appear in a 90-day window.
  const future = await employee('Future');
  await prisma.hrEmployeeDocument.create({
    data: {
      tenantId,
      employeeId: future.id,
      kind: 'Passport',
      name: 'Passport',
      number: `P${suffix}`,
      expiresAt: inDays(400),
    },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('complianceRegister', () => {
  it('unions the RERA card with document expiries, worst first', async () => {
    const rows = await complianceRegister(hrCtx(), { withinDays: 90 });
    // Broker RERA (expired), staff visa (20d), contractor labour card (80d) —
    // the 400-day passport is out of window.
    expect(rows.map((r) => r.credential)).toEqual(['RERA broker card', 'Residence visa', 'Labour card']);
    expect(rows[0].severity).toBe('expired');
    expect(rows[0].employeeId).toBe(brokerId);
    expect(rows[0].reference).toBe(`BRN${suffix}`);
  });

  it('a 30-day window drops the ones further out', async () => {
    const rows = await complianceRegister(hrCtx(), { withinDays: 30 });
    expect(rows.map((r) => r.credential)).toEqual(['RERA broker card', 'Residence visa']);
  });

  it('the contractor filter keeps only contractors', async () => {
    const rows = await complianceRegister(hrCtx(), { withinDays: 90, contractorsOnly: true });
    expect(rows.length).toBe(1);
    expect(rows[0].credential).toBe('Labour card');
    expect(rows[0].isContractor).toBe(true);
  });

  it('refuses someone without authority to read employees', async () => {
    await expect(complianceRegister(plainCtx())).rejects.toThrow(/access to the compliance register/);
  });
});
