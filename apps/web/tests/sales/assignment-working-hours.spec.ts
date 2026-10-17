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

/**
 * M15-05: attendance feeds assignment. Someone not checked in by the workspace's
 * cut-off is passed over as absent (a workspace with no cut-off keeps "a missing
 * check-in is not an absence"), and a standing shift (HrEmployeeShift) counts as
 * a schedule where no roster entry names the day.
 */
describe('attendance feeds assignment', () => {
  const setCutOff = (assignmentCheckInBy: string) =>
    prisma.organizationSetting.upsert({
      where: { tenantId },
      create: { tenantId, hrPolicy: { assignmentCheckInBy } },
      update: { hrPolicy: { assignmentCheckInBy } },
    });
  afterAll(() => setCutOff(''));

  it("passes over anyone not checked in once the workspace's cut-off has passed: 'not checked in'", async () => {
    await setCutOff('10:00'); // NOW is 11:00 in Dubai
    const verdicts = await assessEligibility(tenantId, ids(), withHours, NOW);
    expect(verdicts.map((v) => [v.eligible, v.blockers.map((b) => `${b.code}: ${b.detail}`)])).toEqual([
      [false, ['OFF_SHIFT: not checked in']],
      [false, ['OFF_SHIFT: off shift (19:00–23:00)']],
      [false, ['OFF_SHIFT: checked out for the day']],
      [false, ['OFF_SHIFT: not checked in']],
    ]);
  });

  it('before the cut-off a missing check-in is not an absence, and a check-in today is at work', async () => {
    await setCutOff('12:00');
    expect((await assessEligibility(tenantId, ids(), withHours, NOW)).map((v) => v.eligible)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    await setCutOff('10:00');
    await prisma.hrAttendanceRecord.create({
      data: {
        tenantId,
        employeeId: agents.onShift.employeeId,
        workDate: TODAY,
        checkInAt: new Date('2026-10-07T05:10:00Z'),
      },
    });
    const [verdict] = await assessEligibility(tenantId, [agents.onShift.userId], withHours, NOW);
    expect(verdict!.eligible).toBe(true);
    // Only where the rule asks for working hours.
    expect((await assessEligibility(tenantId, ids(), DEFAULT_POLICY, NOW)).every((v) => v.eligible)).toBe(true);
  });

  it('reads a standing shift where no roster entry names today', async () => {
    await setCutOff('');
    const weekdays = await prisma.hrShift.create({
      data: {
        tenantId,
        name: 'Weekdays',
        code: `WK-${suffix}`,
        startTime: '09:00',
        endTime: '18:00',
        workingDays: [1, 2, 3, 4, 5],
      },
    });
    const weekend = await prisma.hrShift.create({
      data: {
        tenantId,
        name: 'Weekend',
        code: `WE-${suffix}`,
        startTime: '09:00',
        endTime: '18:00',
        workingDays: [5, 6],
      },
    });
    const nights = await prisma.hrShift.create({
      data: { tenantId, name: 'Nights', code: `NT-${suffix}`, startTime: '19:00', endTime: '23:00' },
    });
    const standing = {
      weekdays: await createEmployee({ tenantId, label: 'standing-weekdays', suffix }),
      weekend: await createEmployee({ tenantId, label: 'standing-weekend', suffix }),
      nights: await createEmployee({ tenantId, label: 'standing-nights', suffix }),
    };
    const since = new Date('2026-09-01T00:00:00Z');
    await prisma.hrEmployeeShift.createMany({
      data: [
        { tenantId, employeeId: standing.weekdays.employeeId, shiftId: weekdays.id, effectiveOn: since },
        { tenantId, employeeId: standing.weekend.employeeId, shiftId: weekend.id, effectiveOn: since },
        { tenantId, employeeId: standing.nights.employeeId, shiftId: nights.id, effectiveOn: since },
        // The day's roster entry wins over the standing shift: on shift today.
        { tenantId, employeeId: agents.onShift.employeeId, shiftId: nights.id, effectiveOn: since },
      ],
    });
    const verdicts = await assessEligibility(
      tenantId,
      [standing.weekdays.userId, standing.weekend.userId, standing.nights.userId, agents.onShift.userId],
      withHours,
      NOW, // a Wednesday
    );
    expect(verdicts.map((v) => [v.eligible, v.blockers.map((b) => b.detail)])).toEqual([
      [true, []],
      [false, ['off shift (not a working day)']],
      [false, ['off shift (19:00–23:00)']],
      [true, []],
    ]);
  });

  it('reads an overnight standing shift on the day it starts', async () => {
    await setCutOff('');
    const overnight = await prisma.hrShift.create({
      data: {
        tenantId,
        name: 'Overnight',
        code: `ON-${suffix}`,
        startTime: '22:00',
        endTime: '06:00',
        workingDays: [1, 2, 3, 4, 5],
      },
    });
    const agent = await createEmployee({ tenantId, label: 'standing-overnight', suffix });
    await prisma.hrEmployeeShift.create({
      data: { tenantId, employeeId: agent.employeeId, shiftId: overnight.id, effectiveOn: new Date('2026-09-01') },
    });
    const at = async (iso: string) =>
      (await assessEligibility(tenantId, [agent.userId], withHours, new Date(iso)))[0]!.blockers.map((b) => b.detail);
    expect(await at('2026-10-09T22:00:00Z')).toEqual([]); // 02:00 Saturday in Dubai: Friday night's shift
    expect(await at('2026-10-11T22:00:00Z')).toEqual(['off shift (not a working day)']); // 02:00 Monday: no Sunday night
    expect(await at('2026-10-12T19:00:00Z')).toEqual([]); // 23:00 Monday: Monday night's shift
  });

  it("decides 'checked in today' on the workspace's day, not the UTC day", async () => {
    // Sydney is UTC+11 on 18 Oct: a check-in at 08:45 there is 21:45Z on the
    // 17th, and the attendance day is filed under its UTC date, the 17th.
    await prisma.tenant.updateMany({ where: { id: tenantId }, data: { timezone: 'Australia/Sydney' } });
    await setCutOff('10:00');
    const early = await createEmployee({ tenantId, label: 'sydney-early', suffix });
    const yesterday = await createEmployee({ tenantId, label: 'sydney-yesterday', suffix });
    const filedUnder = new Date('2026-10-17T00:00:00Z');
    await prisma.hrAttendanceRecord.createMany({
      data: [
        { tenantId, employeeId: early.employeeId, workDate: filedUnder, checkInAt: new Date('2026-10-17T21:45:00Z') },
        // 12:00 on the 17th in Sydney: the same UTC date, but yesterday there.
        {
          tenantId,
          employeeId: yesterday.employeeId,
          workDate: filedUnder,
          checkInAt: new Date('2026-10-17T01:00:00Z'),
        },
      ],
    });
    try {
      const verdicts = await assessEligibility(
        tenantId,
        [early.userId, yesterday.userId],
        withHours,
        new Date('2026-10-18T00:30:00Z'), // 11:30 in Sydney
      );
      expect(verdicts.map((v) => [v.eligible, v.blockers.map((b) => b.detail)])).toEqual([
        [true, []],
        [false, ['not checked in']],
      ]);
    } finally {
      await prisma.tenant.updateMany({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    }
  });
});
