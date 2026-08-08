/**
 * UAE labour rules: leave accrual, working days, gratuity, notice in lieu.
 *
 * Ported from the original HRMS `app/services/rules.py`. Figures follow Federal
 * Decree-Law 33/2021 as a baseline — company policy may be more generous, never
 * less. Verify against the signed MOHRE contract before any payout.
 *
 * Every function here is pure and calendar-only. All date arithmetic is done in
 * UTC on purpose: a leave day is a date, not an instant, and doing it in local
 * time makes the answer depend on the server's timezone.
 */

const DAY_MS = 86_400_000;

/** UAE weekend, as JS `getUTCDay()` values: Sunday 0, Saturday 6. */
export const UAE_WEEKEND = [0, 6] as const;

/** Midnight UTC on the same calendar date — the canonical form for a leave day. */
export function toDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export const dayKey = (value: Date) => toDay(value).toISOString().slice(0, 10);

/**
 * Days that actually consume leave balance. Weekends and public holidays do not:
 * an employee taking Thu–Mon burns three days, not five.
 */
export function workingDays(
  start: Date,
  end: Date,
  holidays: Date[] = [],
  weekend: readonly number[] = UAE_WEEKEND,
): number {
  const from = toDay(start);
  const to = toDay(end);
  if (to < from) throw new Error('End date must be on or after the start date.');

  const off = new Set(holidays.map(dayKey));
  const rest = new Set(weekend);
  let days = 0;
  for (let cursor = from; cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
    if (!rest.has(cursor.getUTCDay()) && !off.has(dayKey(cursor))) days += 1;
  }
  return days;
}

/** Whole months of service completed on `asOf`. */
export function monthsOfService(joined: Date, asOf: Date): number {
  const from = toDay(joined);
  const to = toDay(asOf);
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

/**
 * Annual-leave days accrued in the current entitlement year.
 *
 * The defaults are the UAE statutory baseline: nothing under 6 months, 2 days
 * per month between 6 and 12 months, then 2.5 a month capped at 30 a year. A
 * workspace can be more generous through its HR policy, never less.
 */
export interface AccrualPolicy {
  accrualMinMonthsService: number;
  accrualDaysPerMonthUnderYear: number;
  accrualDaysPerMonthAfterYear: number;
  accrualAnnualCapDays: number;
}

const STATUTORY_ACCRUAL: AccrualPolicy = {
  accrualMinMonthsService: 6,
  accrualDaysPerMonthUnderYear: 2,
  accrualDaysPerMonthAfterYear: 2.5,
  accrualAnnualCapDays: 30,
};

export function annualLeaveAccrued(joined: Date, asOf: Date, policy: AccrualPolicy = STATUTORY_ACCRUAL): number {
  const months = monthsOfService(joined, asOf);
  if (months < policy.accrualMinMonthsService) return 0;
  if (months < 12) return round2(months * policy.accrualDaysPerMonthUnderYear);
  const monthsThisYear = toDay(asOf).getUTCMonth() + 1;
  return round2(Math.min(monthsThisYear * policy.accrualDaysPerMonthAfterYear, policy.accrualAnnualCapDays));
}

export function serviceYears(joined: Date, exited: Date): number {
  return (toDay(exited).getTime() - toDay(joined).getTime()) / DAY_MS / 365.25;
}

export interface Gratuity {
  years: number;
  days: number;
  amount: number;
  cappedAtTwoYears: boolean;
  note: string;
}

export interface GratuityPolicy {
  gratuityMinYears: number;
  gratuityFirstPeriodYears: number;
  gratuityDaysFirstPeriod: number;
  gratuityDaysAfterFirstPeriod: number;
  /** Months of basic pay the total may not exceed. Zero removes the cap. */
  gratuityCapMonths: number;
}

const STATUTORY_GRATUITY: GratuityPolicy = {
  gratuityMinYears: 1,
  gratuityFirstPeriodYears: 5,
  gratuityDaysFirstPeriod: 21,
  gratuityDaysAfterFirstPeriod: 30,
  gratuityCapMonths: 24,
};

/**
 * End-of-service gratuity. The defaults are the Decree-Law 33/2021 baseline: 21
 * days of basic pay per year for the first five years, 30 per year after that,
 * capped at two years' basic, and nothing at all under one year of service.
 *
 * The old unlimited-contract resignation reduction no longer applies under that
 * law, so there is deliberately no `resigned` discount here.
 */
export function gratuityUae(
  basicMonthly: number,
  joined: Date,
  exited: Date,
  policy: GratuityPolicy = STATUTORY_GRATUITY,
): Gratuity {
  const years = serviceYears(joined, exited);
  if (years < policy.gratuityMinYears) {
    return {
      years: round3(years),
      days: 0,
      amount: 0,
      cappedAtTwoYears: false,
      note: `Under ${policy.gratuityMinYears} year of service — no gratuity entitlement.`,
    };
  }

  const basic = Math.max(basicMonthly, 0);
  const first = policy.gratuityFirstPeriodYears;
  const days =
    Math.min(years, first) * policy.gratuityDaysFirstPeriod +
    Math.max(years - first, 0) * policy.gratuityDaysAfterFirstPeriod;
  const amount = days * (basic / 30);
  const cap = policy.gratuityCapMonths > 0 ? basic * policy.gratuityCapMonths : Infinity;

  return {
    years: round3(years),
    days: round2(days),
    amount: round2(Math.min(amount, cap)),
    cappedAtTwoYears: amount > cap,
    note: 'Verify against the signed MOHRE contract before payout.',
  };
}

export type NoticeBasis = 'total' | 'basic';

/**
 * Compensation for notice not served. UAE practice pays this on TOTAL
 * remuneration — the opposite of the gratuity basis, which catches people out.
 * `basis` is settable because a minority of contracts specify basic pay.
 */
export function noticePayInLieu(
  basicMonthly: number,
  totalMonthly: number,
  shortfallDays: number,
  basis: NoticeBasis = 'total',
) {
  if (shortfallDays <= 0) return { days: 0, basis, amount: 0 };
  const monthly = Math.max(basis === 'total' ? totalMonthly : basicMonthly, 0);
  return { days: shortfallDays, basis, amount: round2((monthly / 30) * shortfallDays) };
}

// ── Geofence ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * GPS accuracy is subtracted so someone genuinely standing at the edge of the
 * fence is not rejected by sensor noise. A client-reported "I am inside" flag is
 * never trusted — only the coordinates, measured here.
 */
export function insideGeofence(distanceM: number, radiusM: number, gpsAccuracyM = 0): boolean {
  return distanceM - Math.max(gpsAccuracyM, 0) <= radiusM;
}

/**
 * Weekday and minute-of-day in a named timezone. Opening hours are a wall-clock
 * concept in the workspace's own timezone; evaluating them against server-local
 * time silently shifts everyone's shift when the server moves region.
 *
 * `weekday` uses the JavaScript convention: Sunday 0 … Saturday 6.
 */
export function zonedParts(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** "HH:MM" to minutes past midnight. Windows may wrap past midnight. */
export function withinTimeWindow(start: string | null, end: string | null, minutes: number): boolean {
  if (!start || !end) return true;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return true;
  return from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
}

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** How urgently a document expiry needs acting on. A UAE visa renewal needs 30+ days of runway. */
export function expirySeverity(daysRemaining: number): 'expired' | 'urgent' | 'soon' | 'watch' {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 30) return 'urgent';
  if (daysRemaining <= 60) return 'soon';
  return 'watch';
}

export const daysBetween = (from: Date, to: Date) => Math.round((toDay(to).getTime() - toDay(from).getTime()) / DAY_MS);
export const addDays = (value: Date, days: number) => new Date(toDay(value).getTime() + days * DAY_MS);

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
