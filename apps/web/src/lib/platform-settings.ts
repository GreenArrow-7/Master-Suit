import { prisma } from './db';
import { cached } from './redis';
import { env } from './env';

/**
 * Operator-editable platform settings.
 *
 * The environment variable is the default; a PlatformSetting row overrides it at
 * runtime so the owner can change operational limits from the console without a
 * redeploy. Each entry declares its own validation so the PATCH endpoint and the
 * settings form cannot drift apart on what a legal value is.
 */
/** Shared validator: the message names the field so the form can show it verbatim. */
function wholeNumber(raw: string, min: number, max: number, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

export const EDITABLE_SETTINGS = {
  sessionTtlMinutes: {
    label: 'Session lifetime (minutes)',
    description: 'How long a sign-in lasts before it must be renewed.',
    fallback: () => env.SESSION_TTL_MINUTES,
    // 5 minutes keeps a session usable; 43 200 is 30 days, past which a
    // "session" is really a remembered device and should be designed as one.
    parse: (raw: string) => wholeNumber(raw, 5, 43_200, 'Session lifetime'),
  },
  sessionIdleTimeoutMinutes: {
    label: 'Idle timeout (minutes)',
    description: 'How long an unused session survives before it is refused.',
    fallback: () => env.SESSION_IDLE_TIMEOUT_MINUTES,
    parse: (raw: string) => wholeNumber(raw, 1, 10_080, 'Idle timeout'),
  },
  maxFailedLogins: {
    label: 'Failed sign-ins before lockout',
    description: 'Consecutive wrong passwords that lock an account.',
    // A floor of 3 rather than 1: locking on the first typo is a denial of
    // service anyone can perform against any account by guessing once.
    fallback: () => env.MAX_FAILED_LOGINS,
    parse: (raw: string) => wholeNumber(raw, 3, 100, 'Failed sign-in limit'),
  },
  lockoutMinutes: {
    label: 'Lockout duration (minutes)',
    description: 'How long a locked account stays locked.',
    fallback: () => env.LOCKOUT_MINUTES,
    parse: (raw: string) => wholeNumber(raw, 1, 1_440, 'Lockout duration'),
  },
  uploadMaxMb: {
    label: 'Upload limit (MB)',
    description: 'Largest file any workspace may upload. Applies to HR documents and attachments.',
    fallback: () => env.UPLOAD_MAX_MB,
    // 1 MB floor keeps uploads possible; 500 MB ceiling keeps a typo from
    // letting someone stream a disk image into object storage.
    parse: (raw: string): number => {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error('Upload limit must be a whole number between 1 and 500 MB.');
      }
      return value;
    },
  },
} as const;

export type EditableSettingKey = keyof typeof EDITABLE_SETTINGS;

export const isEditableSetting = (key: string): key is EditableSettingKey => key in EDITABLE_SETTINGS;

/** The effective value: DB override when present and valid, env default otherwise. */
export async function getUploadMaxMb(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'uploadMaxMb' } }).catch(() => null);
  if (!row) return env.UPLOAD_MAX_MB;
  try {
    return EDITABLE_SETTINGS.uploadMaxMb.parse(row.value);
  } catch {
    // A hand-edited bad row must not brick uploads; fall back and let the
    // console show the stored value for correction.
    return env.UPLOAD_MAX_MB;
  }
}

/**
 * The effective value of any numeric operator setting: the stored override when
 * present and valid, the environment default otherwise.
 *
 * Cached for a minute. Session lifetime, idle timeout and the lockout thresholds
 * are read on the authentication path — `resolvePlatformCtx` runs on every
 * request — so an uncached lookup would add a query per request to save an
 * operator a redeploy. A minute is short enough that a change feels immediate
 * and long enough that the query disappears; the console invalidates the key on
 * write, so the wait is usually zero.
 *
 * `cached` is the config-only cache this codebase already reserves for exactly
 * this (see lib/redis.ts and docs/00-ARCHITECTURE.md §6). A Redis outage falls
 * through to the environment default rather than failing the request.
 */
export async function getNumericSetting(key: EditableSettingKey): Promise<number> {
  const spec = EDITABLE_SETTINGS[key];
  const fallback = () => spec.fallback() as number;
  try {
    return await cached(settingCacheKey(key), 60, async () => {
      const row = await prisma.platformSetting.findUnique({ where: { key } }).catch(() => null);
      if (!row) return fallback();
      try {
        return spec.parse(row.value) as number;
      } catch {
        // A hand-edited bad row must not brick authentication; the console still
        // shows the stored value so it can be corrected.
        return fallback();
      }
    });
  } catch {
    return fallback();
  }
}

/** Where a setting's cached value lives, so the writer can drop it. */
export const settingCacheKey = (key: string) => `cfg:setting:${key}`;
