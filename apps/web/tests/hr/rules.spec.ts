import { describe, expect, it } from 'vitest';
import {
  annualLeaveAccrued, expirySeverity, gratuityUae, monthsOfService,
  noticePayInLieu, serviceYears, workingDays,
} from '@/services/hr/rules';

/**
 * The UAE calculations are the part of the HRMS port where being wrong costs
 * real money, so they are pure functions with no database and this is their
 * check. Figures follow Federal Decree-Law 33/2021.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('working days', () => {
  it('counts Monday to Friday as five days', () => {
    expect(workingDays(day('2026-01-05'), day('2026-01-09'))).toBe(5);
  });

  it('does not consume balance for the Saturday/Sunday weekend', () => {
    // Monday the 5th through Sunday the 11th: the weekend is not leave.
    expect(workingDays(day('2026-01-05'), day('2026-01-11'))).toBe(5);
  });

  it('does not consume balance for a public holiday', () => {
    expect(workingDays(day('2026-01-05'), day('2026-01-09'), [day('2026-01-07')])).toBe(4);
  });

  it('rejects an end date before the start date', () => {
    expect(() => workingDays(day('2026-01-09'), day('2026-01-05'))).toThrow();
  });
});

describe('annual leave accrual', () => {
  it('earns nothing in the first six months', () => {
    expect(monthsOfService(day('2025-01-15'), day('2025-06-15'))).toBe(5);
    expect(annualLeaveAccrued(day('2025-01-15'), day('2025-06-15'))).toBe(0);
  });

  it('earns two days a month between six and twelve months', () => {
    expect(annualLeaveAccrued(day('2025-01-15'), day('2025-09-15'))).toBe(16);
  });

  it('earns 2.5 days a month after a full year, capped at thirty', () => {
    expect(annualLeaveAccrued(day('2020-01-15'), day('2026-03-10'))).toBe(7.5);
    expect(annualLeaveAccrued(day('2020-01-15'), day('2026-12-10'))).toBe(30);
  });
});

describe('end-of-service gratuity', () => {
  it('pays nothing under one year of service', () => {
    const result = gratuityUae(10_000, day('2024-01-01'), day('2024-06-01'));
    expect(result.days).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('pays 21 days of basic pay per year for the first five years', () => {
    const result = gratuityUae(10_000, day('2020-01-01'), day('2023-01-01'));
    expect(serviceYears(day('2020-01-01'), day('2023-01-01'))).toBeCloseTo(3, 2);
    expect(result.days).toBeCloseTo(63, 0);
    expect(result.amount).toBeCloseTo(21_005, -1);
  });

  it('pays 30 days a year beyond the fifth year', () => {
    // Five years at 21 days plus one year at 30 = 135 days.
    const result = gratuityUae(10_000, day('2018-01-01'), day('2024-01-01'));
    expect(result.days).toBeCloseTo(135, 0);
    expect(result.cappedAtTwoYears).toBe(false);
  });

  it('caps total gratuity at two years of basic pay', () => {
    const result = gratuityUae(10_000, day('1990-01-01'), day('2026-01-01'));
    expect(result.amount).toBe(240_000);
    expect(result.cappedAtTwoYears).toBe(true);
  });
});

describe('notice pay in lieu', () => {
  it('defaults to total remuneration, not basic', () => {
    expect(noticePayInLieu(10_000, 15_000, 30).amount).toBe(15_000);
  });

  it('uses basic pay when the contract says so', () => {
    expect(noticePayInLieu(10_000, 15_000, 30, 'basic').amount).toBe(10_000);
  });

  it('charges nothing when the full notice was served', () => {
    expect(noticePayInLieu(10_000, 15_000, 0).amount).toBe(0);
  });
});

describe('document expiry severity', () => {
  it('escalates as the expiry date approaches', () => {
    expect(expirySeverity(-1)).toBe('expired');
    expect(expirySeverity(30)).toBe('urgent');
    expect(expirySeverity(31)).toBe('soon');
    expect(expirySeverity(61)).toBe('watch');
  });
});
