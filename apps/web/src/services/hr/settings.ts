/**
 * Every tunable HR parameter, in one place, editable by a workspace administrator.
 *
 * These numbers were hardcoded constants ported from the original HRMS, and
 * hardcoding them was wrong for a multi-workspace product: a face threshold that
 * suits one company's staff, lighting and phones does not suit another's, and a
 * UAE company on a Friday-Saturday weekend cannot use a Saturday-Sunday default.
 *
 * The registry below is the single source of truth for three things at once —
 * the default value, the validation rule, and how the admin screen renders the
 * field. They cannot drift apart, because there is only one definition. Adding a
 * parameter here makes it editable, validated and documented in the UI with no
 * other change.
 *
 * Only overridden keys are persisted. A workspace that never touched a setting
 * keeps following the default, including when a release changes it.
 */
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { Forbidden, Invalid } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { isHrAdmin } from './access';
import type { Ctx } from '@/lib/security/rbac';

export type SettingGroup = 'face' | 'liveness' | 'attendance' | 'leave' | 'gratuity' | 'lifecycle';

interface BaseDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  /** Marks a value with legal weight, so the UI can warn before it is changed. */
  statutory?: boolean;
}

type Definition =
  | (BaseDefinition & { type: 'number'; default: number; min: number; max: number; step?: number; unit?: string })
  | (BaseDefinition & { type: 'boolean'; default: boolean })
  | (BaseDefinition & { type: 'select'; default: string; options: { value: string; label: string }[] })
  | (BaseDefinition & { type: 'days'; default: number[] })
  | (BaseDefinition & { type: 'strings'; default: string[] });

/**
 * Defaults come from the environment where one already existed, so an existing
 * deployment's tuning is not silently discarded the first time this loads.
 */
export const HR_SETTINGS: Definition[] = [
  // ── Face matching ────────────────────────────────────────────────────────
  { key: 'faceMatchThreshold', group: 'face', type: 'number', default: env.FACE_MATCH_THRESHOLD, min: 0.3, max: 0.95, step: 0.01,
    label: 'Face match threshold',
    help: 'Cosine similarity a live frame must reach against the enrolled templates. Higher is stricter: fewer impostors accepted, more genuine staff rejected. Enrol ten people, let them check in for a week, look at the score distribution in the review queue, then set this.' },
  { key: 'faceSamplesRequired', group: 'face', type: 'number', default: env.FACE_SAMPLES_REQUIRED, min: 1, max: 10, step: 1, unit: 'samples',
    label: 'Enrolment samples required',
    help: 'How many angles HR must capture before an employee can check in. Fewer samples make a brittle template that fails when the person tilts their head.' },
  { key: 'faceEnrolmentMinSpread', group: 'face', type: 'number', default: env.FACE_ENROLMENT_MIN_SPREAD, min: 0, max: 0.5, step: 0.005,
    label: 'Minimum enrolment spread',
    help: 'How much the enrolment samples must differ from each other. Set to 0 to allow four shots of the same pose, which produces a template that only works when the employee sits exactly as they did at enrolment.' },
  { key: 'minDetectionScore', group: 'face', type: 'number', default: 0.6, min: 0.1, max: 0.95, step: 0.05,
    label: 'Minimum detector confidence',
    help: 'How sure the detector must be that it found a face at all. Lower values accept poorer frames and push more of the decision onto the match threshold.' },
  { key: 'minFaceAreaRatio', group: 'face', type: 'number', default: 0.02, min: 0.002, max: 0.4, step: 0.005,
    label: 'Minimum face size',
    help: 'The fraction of the frame the face must fill. This is what rejects someone standing far from the camera, where the embedding is unreliable.' },
  { key: 'minBlurScore', group: 'face', type: 'number', default: 45, min: 0, max: 400, step: 5,
    label: 'Minimum sharpness',
    help: 'Variance of the Laplacian on the face crop. A printed photo or a phone screen usually loses on sharpness even when it passes the pose check, so raising this is one of the few cheap wins against replay attacks.' },

  // ── Liveness ─────────────────────────────────────────────────────────────
  { key: 'livenessYawDegrees', group: 'liveness', type: 'number', default: 12, min: 3, max: 45, step: 1, unit: '°',
    label: 'Head turn required (left/right)',
    help: 'How far the head must turn to satisfy a left or right challenge. Too high and staff struggle in a doorway; too low and small camera shake reads as a turn.' },
  { key: 'livenessPitchDegrees', group: 'liveness', type: 'number', default: 10, min: 3, max: 45, step: 1, unit: '°',
    label: 'Head tilt required (up)',
    help: 'The same, for the upward-tilt challenge.' },
  { key: 'livenessSamePersonThreshold', group: 'liveness', type: 'number', default: 0.4, min: 0.1, max: 0.9, step: 0.05,
    label: 'Same-person threshold between frames',
    help: 'How similar the neutral and moved frames must be to count as one person. This is what stops a face being swapped between the two frames.' },
  { key: 'challengeTtlSeconds', group: 'liveness', type: 'number', default: 90, min: 20, max: 600, step: 10, unit: 's',
    label: 'Challenge lifetime',
    help: 'How long an issued challenge stays valid. It is single use regardless — a replayed nonce is refused even inside this window.' },

  // ── Attendance ───────────────────────────────────────────────────────────
  { key: 'maxGpsAccuracyM', group: 'attendance', type: 'number', default: env.MAX_GPS_ACCURACY_M, min: 5, max: 1000, step: 5, unit: 'm',
    label: 'Worst acceptable GPS accuracy',
    help: 'Used when a work location does not set its own ceiling. A punch with a fix worse than this is refused rather than measured, because a ±500 m fix cannot tell inside a geofence from outside it.' },
  { key: 'geofenceDefaultRadiusM', group: 'attendance', type: 'number', default: 150, min: 10, max: 5000, step: 10, unit: 'm',
    label: 'Default geofence radius',
    help: 'Pre-filled when creating a work location. Existing locations keep their own radius.' },
  { key: 'minPunchIntervalSeconds', group: 'attendance', type: 'number', default: env.MIN_PUNCH_INTERVAL_SECONDS, min: 0, max: 3600, step: 10, unit: 's',
    label: 'Minimum time between punches',
    help: 'Stops a double tap recording twice. Raising it also slows down anyone testing the system repeatedly.' },
  { key: 'maxOfflineSyncHours', group: 'attendance', type: 'number', default: env.MAX_OFFLINE_SYNC_HOURS, min: 1, max: 336, step: 1, unit: 'h',
    label: 'Maximum age of a queued punch',
    help: 'A punch captured offline and synced later than this is refused, so a queued check-in from last week cannot land as today’s attendance.' },
  { key: 'captureRetentionDays', group: 'attendance', type: 'number', default: env.ATTENDANCE_CAPTURE_RETENTION_DAYS, min: 1, max: 3650, step: 1, unit: 'days',
    label: 'Capture frame retention',
    help: 'How long the encrypted capture frame from each punch is kept as evidence before the retention job deletes it. Biometric images should not accumulate forever; keep this as short as your dispute process allows.' },

  // ── Leave ────────────────────────────────────────────────────────────────
  { key: 'weekendDays', group: 'leave', type: 'days', default: [0, 6],
    label: 'Weekend days',
    help: 'Days that never consume leave balance. The UAE moved to Saturday–Sunday in 2022, but plenty of firms still run a Friday-half/Saturday week — set what your contracts actually say.' },
  { key: 'leaveMaxBackdateDays', group: 'leave', type: 'number', default: 30, min: 0, max: 365, step: 1, unit: 'days',
    label: 'How far back staff may self-record leave',
    help: 'Beyond this an employee must ask HR to record it. HR is never subject to this limit.' },
  { key: 'accrualMinMonthsService', group: 'leave', type: 'number', default: 6, min: 0, max: 24, step: 1, unit: 'months', statutory: true,
    label: 'Months of service before leave accrues',
    help: 'UAE statutory baseline is 6 months. Company policy may be more generous, never less.' },
  { key: 'accrualDaysPerMonthUnderYear', group: 'leave', type: 'number', default: 2, min: 0, max: 5, step: 0.5, unit: 'days', statutory: true,
    label: 'Days accrued per month (6–12 months)',
    help: 'UAE statutory baseline is 2 days per month between six and twelve months of service.' },
  { key: 'accrualDaysPerMonthAfterYear', group: 'leave', type: 'number', default: 2.5, min: 0, max: 5, step: 0.5, unit: 'days', statutory: true,
    label: 'Days accrued per month (after one year)',
    help: 'UAE statutory baseline is 2.5 days per month, giving 30 days a year.' },
  { key: 'accrualAnnualCapDays', group: 'leave', type: 'number', default: 30, min: 0, max: 60, step: 1, unit: 'days', statutory: true,
    label: 'Annual leave cap',
    help: 'The most that can accrue in one entitlement year.' },

  // ── Gratuity and settlement ──────────────────────────────────────────────
  { key: 'gratuityMinYears', group: 'gratuity', type: 'number', default: 1, min: 0, max: 5, step: 0.5, unit: 'years', statutory: true,
    label: 'Service before any gratuity is due',
    help: 'Under Decree-Law 33/2021, less than one year of service earns nothing.' },
  { key: 'gratuityDaysFirstPeriod', group: 'gratuity', type: 'number', default: 21, min: 0, max: 60, step: 1, unit: 'days', statutory: true,
    label: 'Gratuity days per year (first five years)',
    help: '21 days of basic pay per year of service for the first five years.' },
  { key: 'gratuityDaysAfterFirstPeriod', group: 'gratuity', type: 'number', default: 30, min: 0, max: 60, step: 1, unit: 'days', statutory: true,
    label: 'Gratuity days per year (beyond five years)',
    help: '30 days of basic pay per year of service after the fifth year.' },
  { key: 'gratuityFirstPeriodYears', group: 'gratuity', type: 'number', default: 5, min: 1, max: 20, step: 1, unit: 'years', statutory: true,
    label: 'Length of the first gratuity period',
    help: 'Where the rate changes from the first figure to the second.' },
  { key: 'gratuityCapMonths', group: 'gratuity', type: 'number', default: 24, min: 0, max: 120, step: 1, unit: 'months', statutory: true,
    label: 'Gratuity cap',
    help: 'Total gratuity may not exceed this many months of basic pay. Set 0 to remove the cap.' },
  { key: 'noticePayBasis', group: 'gratuity', type: 'select', default: 'total',
    options: [{ value: 'total', label: 'Total remuneration' }, { value: 'basic', label: 'Basic salary' }],
    label: 'Notice pay in lieu is calculated on',
    help: 'UAE practice pays notice in lieu on total remuneration — the opposite of the gratuity basis, which catches people out. A minority of contracts specify basic. Read the contract.' },

  // ── Lifecycle ────────────────────────────────────────────────────────────
  { key: 'defaultNoticeDays', group: 'lifecycle', type: 'number', default: 30, min: 0, max: 180, step: 1, unit: 'days',
    label: 'Default notice period',
    help: 'Pre-filled when starting offboarding. Contracts may specify 30–90 days; the contract wins.' },
  { key: 'documentExpiryHorizonDays', group: 'lifecycle', type: 'number', default: 90, min: 7, max: 365, step: 1, unit: 'days',
    label: 'Document expiry warning horizon',
    help: 'How far ahead the expiring-documents list looks. A UAE residence visa renewal realistically needs 30+ days of runway.' },
  { key: 'agentDepartments', group: 'lifecycle', type: 'strings', default: ['brokerage', 'sales', 'leasing'],
    label: 'Departments on the RERA agent track',
    help: 'Staff in these departments get the extra BRN and RERA onboarding steps. If your departments are named differently, agents silently miss those steps — which is a regulatory exposure, not a cosmetic one.' },
];

export type HrPolicy = {
  faceMatchThreshold: number; faceSamplesRequired: number; faceEnrolmentMinSpread: number;
  minDetectionScore: number; minFaceAreaRatio: number; minBlurScore: number;
  livenessYawDegrees: number; livenessPitchDegrees: number; livenessSamePersonThreshold: number; challengeTtlSeconds: number;
  maxGpsAccuracyM: number; geofenceDefaultRadiusM: number; minPunchIntervalSeconds: number;
  maxOfflineSyncHours: number; captureRetentionDays: number;
  weekendDays: number[]; leaveMaxBackdateDays: number;
  accrualMinMonthsService: number; accrualDaysPerMonthUnderYear: number; accrualDaysPerMonthAfterYear: number; accrualAnnualCapDays: number;
  gratuityMinYears: number; gratuityDaysFirstPeriod: number; gratuityDaysAfterFirstPeriod: number;
  gratuityFirstPeriodYears: number; gratuityCapMonths: number; noticePayBasis: 'total' | 'basic';
  defaultNoticeDays: number; documentExpiryHorizonDays: number; agentDepartments: string[];
};

export const DEFAULT_POLICY = Object.fromEntries(HR_SETTINGS.map((setting) => [setting.key, setting.default])) as HrPolicy;

export const GROUP_LABELS: Record<SettingGroup, string> = {
  face: 'Face matching',
  liveness: 'Liveness challenge',
  attendance: 'Attendance and geofence',
  leave: 'Leave and accrual',
  gratuity: 'Gratuity and final settlement',
  lifecycle: 'Employee lifecycle',
};

/**
 * The workspace's effective policy: defaults with its overrides applied.
 *
 * Deliberately not cached. These are read once per request on paths that already
 * make several database round trips, and a stale threshold after an admin
 * changes it is a support call nobody can diagnose.
 */
export async function getHrPolicy(ctx: Ctx): Promise<HrPolicy> {
  const settings = await prisma.organizationSetting.findUnique({
    where: { tenantId: ctx.tenantId },
    select: { hrPolicy: true },
  });
  return resolvePolicy(settings?.hrPolicy);
}

/** Exported for the pure tests: merging is validated without a database. */
export function resolvePolicy(stored: unknown): HrPolicy {
  const overrides = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const resolved = { ...DEFAULT_POLICY } as Record<string, unknown>;
  for (const setting of HR_SETTINGS) {
    if (!(setting.key in overrides)) continue;
    const parsed = coerce(setting, overrides[setting.key]);
    if (parsed.ok) resolved[setting.key] = parsed.value;
    // A stored value that no longer validates (a range tightened in a release)
    // falls back to the default rather than propagating a nonsense number.
  }
  return resolved as HrPolicy;
}

function coerce(setting: Definition, raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (setting.type) {
    case 'number': {
      const value = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, message: 'must be a number' };
      if (value < setting.min || value > setting.max) return { ok: false, message: `must be between ${setting.min} and ${setting.max}` };
      return { ok: true, value };
    }
    case 'boolean':
      return { ok: true, value: raw === true || raw === 'true' || raw === 'on' };
    case 'select':
      return setting.options.some((option) => option.value === raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `must be one of ${setting.options.map((option) => option.value).join(', ')}` };
    case 'days': {
      const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',').map((part) => part.trim()).filter(Boolean);
      const days = list.map(Number);
      if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        return { ok: false, message: 'must be day numbers 0 (Sunday) to 6 (Saturday)' };
      }
      return { ok: true, value: [...new Set(days)].sort() };
    }
    case 'strings': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(',');
      return { ok: true, value: list.map((item) => item.trim().toLowerCase()).filter(Boolean) };
    }
  }
}

/**
 * Applies an admin's changes. Each changed key is audited with its before and
 * after value: a face threshold quietly loosened to 0.31 is indistinguishable
 * from a working system until you read the audit log.
 */
export async function updateHrPolicy(ctx: Ctx, patch: Record<string, unknown>) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only administrators can change HR policy.');

  const existing = await prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { hrPolicy: true } });
  const before = resolvePolicy(existing?.hrPolicy) as Record<string, unknown>;
  const stored = { ...(existing?.hrPolicy as Record<string, unknown> ?? {}) };

  const errors: { field: string; code: string; message: string }[] = [];
  const changed: string[] = [];

  for (const setting of HR_SETTINGS) {
    if (!(setting.key in patch)) continue;
    const raw = patch[setting.key];

    // An empty field means "go back to the default", which is how an admin
    // undoes a change without having to remember what the default was.
    if (raw === '' || raw === null) {
      if (setting.key in stored) { delete stored[setting.key]; changed.push(setting.key); }
      continue;
    }

    const parsed = coerce(setting, raw);
    if (!parsed.ok) { errors.push({ field: setting.key, code: 'invalid', message: `${setting.label} ${parsed.message}.` }); continue; }
    if (JSON.stringify(parsed.value) === JSON.stringify(before[setting.key])) continue;
    stored[setting.key] = parsed.value;
    changed.push(setting.key);
  }

  if (errors.length) throw Invalid(errors);

  await prisma.organizationSetting.upsert({
    where: { tenantId: ctx.tenantId },
    update: { hrPolicy: stored as never },
    create: { tenantId: ctx.tenantId, hrPolicy: stored as never },
  });

  const after = resolvePolicy(stored) as Record<string, unknown>;
  for (const key of changed) {
    await audit(ctx, {
      event: 'PERMISSION_CHANGED',
      objectType: 'hr_policy',
      fieldKey: key,
      previousValue: before[key],
      newValue: after[key],
      metadata: { action: 'hr.policy.changed' },
    });
  }

  return { changed, policy: after as HrPolicy };
}
