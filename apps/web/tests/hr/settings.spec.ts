import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, GROUP_LABELS, HR_SETTINGS, resolvePolicy } from '@/services/hr/settings';
import { annualLeaveAccrued, gratuityUae, workingDays } from '@/services/hr/rules';
import { verifyLiveness, type Detection } from '@/services/hr/face';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * The registry is the single source of truth for defaults, validation and the
 * admin form. These checks are what stop it drifting out of step with the
 * functions that consume it.
 */
describe('policy registry', () => {
  it('has a unique, non-empty key and help text for every parameter', () => {
    const keys = HR_SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const setting of HR_SETTINGS) {
      expect(setting.label.length, setting.key).toBeGreaterThan(0);
      expect(setting.help.length, setting.key).toBeGreaterThan(20);
      expect(Object.keys(GROUP_LABELS), setting.key).toContain(setting.group);
    }
  });

  it('gives every numeric default a value inside its own allowed range', () => {
    for (const setting of HR_SETTINGS) {
      if (setting.type !== 'number') continue;
      expect(setting.default, setting.key).toBeGreaterThanOrEqual(setting.min);
      expect(setting.default, setting.key).toBeLessThanOrEqual(setting.max);
    }
  });

  it('ships UAE statutory defaults', () => {
    expect(DEFAULT_POLICY.accrualMinMonthsService).toBe(6);
    expect(DEFAULT_POLICY.accrualDaysPerMonthAfterYear).toBe(2.5);
    expect(DEFAULT_POLICY.gratuityDaysFirstPeriod).toBe(21);
    expect(DEFAULT_POLICY.gratuityDaysAfterFirstPeriod).toBe(30);
    expect(DEFAULT_POLICY.gratuityCapMonths).toBe(24);
    expect(DEFAULT_POLICY.weekendDays).toEqual([0, 6]);
    expect(DEFAULT_POLICY.noticePayBasis).toBe('total');
  });
});

describe('resolving stored overrides', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(resolvePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(resolvePolicy({})).toEqual(DEFAULT_POLICY);
  });

  it('applies only the keys that were overridden', () => {
    const policy = resolvePolicy({ faceMatchThreshold: 0.72 });
    expect(policy.faceMatchThreshold).toBe(0.72);
    expect(policy.gratuityDaysFirstPeriod).toBe(DEFAULT_POLICY.gratuityDaysFirstPeriod);
  });

  it('falls back to the default when a stored value is out of range', () => {
    // A range tightened in a release must not leave a nonsense number in force.
    expect(resolvePolicy({ faceMatchThreshold: 9 }).faceMatchThreshold).toBe(DEFAULT_POLICY.faceMatchThreshold);
    expect(resolvePolicy({ faceMatchThreshold: 'nonsense' }).faceMatchThreshold).toBe(
      DEFAULT_POLICY.faceMatchThreshold,
    );
  });

  it('ignores keys that are not in the registry', () => {
    expect(resolvePolicy({ somethingRemovedLastYear: 42 })).toEqual(DEFAULT_POLICY);
  });

  it('normalises weekend days and agent departments', () => {
    expect(resolvePolicy({ weekendDays: ['5', '6', '5'] }).weekendDays).toEqual([5, 6]);
    expect(resolvePolicy({ agentDepartments: ' Brokerage , Leasing ' }).agentDepartments).toEqual([
      'brokerage',
      'leasing',
    ]);
  });
});

describe('policy actually changes the outcome', () => {
  it('moves the weekend, so a Friday–Saturday firm burns different days', () => {
    // Thursday 2026-01-08 to Sunday 2026-01-11.
    expect(workingDays(day('2026-01-08'), day('2026-01-11'), [], [0, 6])).toBe(2);
    expect(workingDays(day('2026-01-08'), day('2026-01-11'), [], [5, 6])).toBe(2);
    expect(workingDays(day('2026-01-08'), day('2026-01-11'), [], [])).toBe(4);
  });

  it('changes accrual when a workspace is more generous than the statutory floor', () => {
    const generous = {
      accrualMinMonthsService: 0,
      accrualDaysPerMonthUnderYear: 3,
      accrualDaysPerMonthAfterYear: 3,
      accrualAnnualCapDays: 40,
    };
    expect(annualLeaveAccrued(day('2025-01-15'), day('2025-06-15'))).toBe(0);
    expect(annualLeaveAccrued(day('2025-01-15'), day('2025-06-15'), generous)).toBe(15);
  });

  it('changes gratuity when the rate or cap is edited', () => {
    const joined = day('2018-01-01');
    const exited = day('2024-01-01');
    const statutory = gratuityUae(10_000, joined, exited);
    const richer = gratuityUae(10_000, joined, exited, {
      gratuityMinYears: 1,
      gratuityFirstPeriodYears: 5,
      gratuityDaysFirstPeriod: 30,
      gratuityDaysAfterFirstPeriod: 30,
      gratuityCapMonths: 24,
    });
    expect(richer.days).toBeGreaterThan(statutory.days);

    // A zero cap removes the ceiling rather than zeroing the payout.
    const uncapped = gratuityUae(10_000, day('1990-01-01'), day('2026-01-01'), {
      gratuityMinYears: 1,
      gratuityFirstPeriodYears: 5,
      gratuityDaysFirstPeriod: 21,
      gratuityDaysAfterFirstPeriod: 30,
      gratuityCapMonths: 0,
    });
    expect(uncapped.amount).toBeGreaterThan(240_000);
    expect(uncapped.cappedAtTwoYears).toBe(false);
  });

  it('changes how far the head must turn to satisfy a challenge', () => {
    const face = (over: Partial<Detection> = {}): Detection => ({
      ok: true,
      embedding: [1, 0, 0],
      detScore: 0.9,
      yaw: 0,
      pitch: 0,
      roll: 0,
      bboxAreaRatio: 0.2,
      blurScore: 200,
      ...over,
    });
    const frames = [face(), face({ yaw: 8 })];
    const strict = { livenessYawDegrees: 12, livenessPitchDegrees: 10, livenessSamePersonThreshold: 0.4 };
    const lenient = { ...strict, livenessYawDegrees: 6 };
    expect(verifyLiveness(frames, 'left', strict).passed).toBe(false);
    expect(verifyLiveness(frames, 'left', lenient).passed).toBe(true);
  });
});
