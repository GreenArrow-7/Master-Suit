import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assignLead } from '@/services/distribution/assignLead';
import { assessEligibility, DEFAULT_POLICY } from '@/services/distribution/eligibility';
import { createEmployee, seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Lead Eagle plan, gap 6: automatic assignment passes over agents outside their
 * working hours — where their own schedule says so — and says why it chose the
 * one it chose. `respectWorkingHours` was on every rule and read by nothing.
 */
const suffix = randomBytes(4).toString('hex');
// 11:00 in Dubai, the fixture workspace's timezone.
const NOW = new Date('2026-10-07T07:00:00Z');
const TODAY = new Date('2026-10-07T00:00:00Z');

let fixture: Fixture;
let tenantId: string;
const agents: Record<'onShift' | 'evening' | 'checkedOut' | 'unscheduled', { userId: string; employeeId: string }> =
  {} as never;
const ids = () => [agents.onShift, agents.evening, agents.checkedOut, agents.unscheduled].map((a) => a.userId);
const withHours = { ...DEFAULT_POLICY, respectWorkingHours: true };

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  for (const label of ['onShift', 'evening', 'checkedOut', 'unscheduled'] as const) {
    agents[label] = await createEmployee({ tenantId, label, suffix });
  }
  const shift = (code: string, startTime: string, endTime: string) =>
    prisma.hrShift.create({ data: { tenantId, name: code, code: `${code}-${suffix}`, startTime, endTime } });
  const day = await shift('DAY', '09:00', '18:00');
  const evening = await shift('EVE', '19:00', '23:00');
  await prisma.hrRosterEntry.createMany({
    data: [
      { tenantId, employeeId: agents.onShift.employeeId, shiftId: day.id, workDate: TODAY },
      { tenantId, employeeId: agents.evening.employeeId, shiftId: evening.id, workDate: TODAY },
    ],
  });
  await prisma.hrAttendanceRecord.create({
    data: {
      tenantId,
      employeeId: agents.checkedOut.employeeId,
      workDate: TODAY,
      checkInAt: new Date('2026-10-07T05:00:00Z'),
      checkOutAt: new Date('2026-10-07T06:30:00Z'),
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('working hours', () => {
  it('passes over an agent rostered off shift or checked out, and nobody without a schedule', async () => {
    const verdicts = await assessEligibility(tenantId, ids(), withHours, NOW);
    expect(verdicts.map((v) => [v.eligible, v.blockers.map((b) => b.detail)])).toEqual([
      [true, []],
      [false, ['off shift (19:00–23:00)']],
      [false, ['checked out for the day']],
      [true, []],
    ]);
  });

  it('takes a check-in after the check-out as back at work', async () => {
    await prisma.hrAttendanceRecord.updateMany({
      where: { tenantId, employeeId: agents.checkedOut.employeeId },
      data: { checkInAt: new Date('2026-10-07T06:45:00Z') },
    });
    const [verdict] = await assessEligibility(tenantId, [agents.checkedOut.userId], withHours, NOW);
    expect(verdict!.eligible).toBe(true);
    await prisma.hrAttendanceRecord.updateMany({
      where: { tenantId, employeeId: agents.checkedOut.employeeId },
      data: { checkInAt: new Date('2026-10-07T05:00:00Z') },
    });
  });

  it('is ignored when the rule does not ask for it', async () => {
    const verdicts = await assessEligibility(tenantId, ids(), DEFAULT_POLICY, NOW);
    expect(verdicts.every((v) => v.eligible)).toBe(true);
  });

  it('assigns past the off-shift agent and says why on the assignment', async () => {
    await prisma.distributionRule.create({
      data: {
        tenantId,
        name: 'Portal leads',
        objectType: 'LEAD',
        method: 'ROUND_ROBIN',
        isActive: true,
        candidatePool: { userIds: [agents.evening.userId, agents.onShift.userId] },
        respectWorkingHours: true,
      },
    });
    const lead = await prisma.lead.create({
      data: { tenantId, reference: `WH-${suffix}`, fullName: 'Evening enquiry', stageId: fixture.a.stageId },
    });

    const outcome = await assignLead(tenantId, lead.id, NOW);
    expect(outcome).toMatchObject({ outcome: 'assigned', userId: agents.onShift.userId });
    const history = await prisma.leadAssignmentHistory.findFirstOrThrow({ where: { tenantId, leadId: lead.id } });
    expect(history.note).toBe('Next in turn on Portal leads; passed over evening (off shift (19:00–23:00)).');
  });
});
