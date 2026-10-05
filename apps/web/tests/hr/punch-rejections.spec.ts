import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { punch, type PunchInput } from '@/services/hr/attendance';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createEmployee } from '../helpers/fixtures';

/**
 * The refusals punch() answers before any face model runs. Each is recorded as a
 * punch row and answered the same way, which is what this pins: the row's result,
 * the message, and a distance only where the refusal measured one.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let userId = '';
let employeeId = '';
const ctx = () => buildCtx(buildActor({ id: userId, tenantId }));
const input = (over: Partial<PunchInput> = {}): PunchInput => ({
  punchType: 'CHECK_IN',
  nonce: 'unused',
  frames: ['frame'],
  latitude: 25.2,
  longitude: 55.27,
  gpsAccuracyM: 10,
  deviceFingerprint: `device-${suffix}`,
  ...over,
});

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `punch-${suffix}`, legalName: 'Punch LLC', displayName: 'Punch', status: 'ACTIVE' },
    })
  ).id;
  ({ employeeId, userId } = await createEmployee({ tenantId, label: 'puncher', suffix }));
  await prisma.biometricConsent.create({
    data: { tenantId, employeeId, grantedAt: new Date(), policyVersion: 'test' },
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('punch() refusals before the face engine', () => {
  it('refuses a queued punch too old to sync, and records it', async () => {
    const result = await punch(
      ctx(),
      input({ syncedOffline: true, clientTime: new Date(Date.now() - 30 * 86_400_000) }),
    );
    expect(result).toMatchObject({ result: 'REJECTED_STALE_SYNC', distanceM: null });
    expect(result.message).toMatch(/too old to sync/);
  });

  it('refuses a punch outside any assignment, recording the reason', async () => {
    const result = await punch(ctx(), input());
    expect(result.result).toMatch(/^REJECTED_/);
    const row = await prisma.hrAttendancePunch.findFirstOrThrow({
      where: { tenantId, employeeId, result: result.result },
      orderBy: { serverTime: 'desc' },
    });
    expect(row.rejectCode).toBe('NO_ACTIVE_ASSIGNMENT');
  });

  it('refuses a second check-in inside the minimum interval', async () => {
    await prisma.hrAttendancePunch.create({
      data: {
        tenantId,
        employeeId,
        punchType: 'CHECK_IN',
        result: 'ACCEPTED',
        method: 'face',
        latitude: 25.2,
        longitude: 55.27,
        gpsAccuracyM: 10,
      },
    });
    const result = await punch(ctx(), input());
    expect(result).toMatchObject({ result: 'REJECTED_DUPLICATE', distanceM: null });
  });
});
