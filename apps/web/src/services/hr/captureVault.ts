/**
 * Encrypted storage for attendance capture frames.
 *
 * Every accepted and rejected face punch keeps the frame that was actually
 * presented to the camera. That is the evidence trail: without it a disputed
 * punch is one person's word against a row in a table. A rejected punch is
 * exactly when the picture matters most — it is the record of who tried.
 *
 * Raw JPEGs on disk would be a serious problem: they are biometric data about
 * identifiable people, readable by anyone with filesystem or backup access. Each
 * frame is encrypted with AES-256-GCM before it touches the disk, under a key
 * derived from FIELD_ENCRYPTION_KEY.
 *
 * What this protects against: stolen disks, leaked backups, support exports,
 * anyone browsing the storage volume. What it does NOT protect against: an
 * attacker who already holds FIELD_ENCRYPTION_KEY. Rotating that key makes
 * existing captures unreadable.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { resolvePolicy } from './settings';

const SUFFIX = '.jpg.enc';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const root = () => path.resolve(env.ATTENDANCE_CAPTURE_DIR);

/**
 * Derived with a capture-specific salt so a capture key and a field-encryption
 * key are never the same value even though both come from one secret.
 */
function key(): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.FIELD_ENCRYPTION_KEY),
      Buffer.from('master-saas-attendance-capture-v1'),
      Buffer.from(''),
      32,
    ),
  );
}

/**
 * Sharded tenant, then employee, then month.
 *
 * Tenant first is what lets the retention job apply each workspace's own
 * retention window instead of one global number, and it keeps a workspace's
 * biometric captures in a single subtree — which is what a deletion request
 * under PDPL actually needs to be able to act on.
 */
function pathFor(tenantId: string, employeeId: string, punchId: string, when: Date) {
  const month = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`);
}

/**
 * Encrypt and write one frame. Returns the relative path, or null.
 *
 * Never throws: a storage fault must not turn a valid attendance punch into an
 * error for the employee standing at the door. Losing the capture is bad;
 * blocking the punch is worse, and the punch row is written either way.
 */
export async function storeCapture(
  tenantId: string,
  employeeId: string,
  punchId: string,
  frame: Buffer,
  when = new Date(),
): Promise<string | null> {
  if (!frame.length) return null;
  try {
    const relative = pathFor(tenantId, employeeId, punchId, when);
    const full = path.join(root(), relative);
    await mkdir(path.dirname(full), { recursive: true });

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const payload = Buffer.concat([iv, cipher.update(frame), cipher.final(), cipher.getAuthTag()]);

    // Write then rename: a crash mid-write leaves no half-readable capture.
    const temporary = `${full}.tmp`;
    await writeFile(temporary, payload, { mode: 0o600 });
    await rename(temporary, full);
    return relative;
  } catch (error) {
    logger.error({ err: error, tenantId, employeeId, punchId }, 'attendance capture could not be stored');
    return null;
  }
}

/** HR and audit use only — the caller must have checked permissions already. */
export async function loadCapture(relative: string): Promise<Buffer> {
  const full = path.resolve(root(), relative);
  if (full !== root() && !full.startsWith(root() + path.sep)) {
    throw new Error('Refusing to read outside the attendance capture vault.');
  }
  const payload = await readFile(full);
  const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)), decipher.final()]);
}

/**
 * Biometric images must not accumulate forever. Call from a scheduled job.
 *
 * Each workspace's own `captureRetentionDays` governs its own subtree, so a
 * company that wants thirty days is not held to another's hundred and eighty.
 * A shard with no settings row falls back to the registry default rather than
 * being skipped — an unconfigured workspace must still have its biometrics aged
 * out.
 */
export async function purgeExpiredCaptures(): Promise<{ removed: number; workspaces: number }> {
  let removed = 0;
  let workspaces = 0;

  async function walk(directory: string, cutoff: number) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full, cutoff);
        continue;
      }
      if (!entry.name.endsWith(SUFFIX)) continue;
      try {
        if ((await stat(full)).mtimeMs < cutoff) {
          await unlink(full);
          removed += 1;
        }
      } catch {
        /* a file that vanished under us was already purged */
      }
    }
  }

  let shards;
  try {
    shards = await readdir(root(), { withFileTypes: true });
  } catch {
    return { removed: 0, workspaces: 0 };
  }

  for (const shard of shards) {
    if (!shard.isDirectory() || !shard.name.startsWith('t-')) continue;
    const tenantId = shard.name.slice(2);
    const settings = await prisma.organizationSetting
      .findUnique({ where: { tenantId }, select: { hrPolicy: true } })
      .catch(() => null);
    const days = resolvePolicy(settings?.hrPolicy).captureRetentionDays;
    await walk(path.join(root(), shard.name), Date.now() - days * 86_400_000);
    workspaces += 1;
  }
  return { removed, workspaces };
}
