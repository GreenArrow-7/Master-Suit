import { prisma } from './db';
import { env } from './env';

/**
 * Operator-editable platform settings.
 *
 * The environment variable is the default; a PlatformSetting row overrides it at
 * runtime so the owner can change operational limits from the console without a
 * redeploy. Each entry declares its own validation so the PATCH endpoint and the
 * settings form cannot drift apart on what a legal value is.
 */
export const EDITABLE_SETTINGS = {
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
