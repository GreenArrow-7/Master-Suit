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
 * anyone browsing the storage volume or the bucket. What it does NOT protect
 * against: an attacker who already holds FIELD_ENCRYPTION_KEY. Rotating that key
 * makes existing captures unreadable.
 *
 * ── Object storage, not the container's disk ────────────────────────────────
 *
 * Captures used to be written to ATTENDANCE_CAPTURE_DIR, a local directory. That
 * made the web tier stateful: a second replica would take punches whose evidence
 * only the first replica could read, and the assessment names it as the one
 * blocker to running more than one. They go to the same S3-compatible bucket as
 * every other uploaded object now, still encrypted before they leave this
 * process.
 *
 * Reads fall back to the old directory when the object is absent, because a
 * deployment upgrading into this has captures on disk with a retention window of
 * up to 180 days, and a disputed punch from last month must not become
 * unreadable on deploy day. `scripts/migrate-attendance-captures.mjs` copies
 * them across; the fallback can go once it has run everywhere.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { deleteObjects, getObject, listObjects, listPrefixes, putObject } from '@/lib/storage';
import { resolvePolicy } from './settings';

const SUFFIX = '.jpg.enc';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Everything this vault owns lives under one prefix, so a retention sweep can
 * list captures without walking recordings and HR documents in the same bucket.
 */
const PREFIX = 'attendance/';

/** The legacy on-disk vault, still read (and still purged) until migrated. */
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

/** Ciphertext, not an image. Labelling it image/jpeg would be a lie a browser acts on. */
const CONTENT_TYPE = 'application/octet-stream';

const objectKey = (relative: string) => PREFIX + relative.split(path.sep).join('/');

/**
 * Encrypt and store one frame. Returns the relative path, or null.
 *
 * The return value is the same shape it always was — `t-x/emp-y/2026-08/punch-z.jpg.enc`
 * — because it is written to `HrAttendancePunch.capturePath` and existing rows
 * hold it. The bucket prefix is added on the way in and out, so no migration of
 * the column is needed.
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

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const payload = Buffer.concat([iv, cipher.update(frame), cipher.final(), cipher.getAuthTag()]);

    // A single PUT is atomic — there is no half-written object for a reader to
    // find, which is what the old write-then-rename dance bought on a filesystem.
    await putObject(objectKey(relative), payload, CONTENT_TYPE);
    return relative;
  } catch (error) {
    logger.error({ err: error, tenantId, employeeId, punchId }, 'attendance capture could not be stored');
    return null;
  }
}

function decrypt(payload: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)), decipher.final()]);
}

/**
 * HR and audit use only — the caller must have checked permissions already.
 *
 * Object storage first, then the legacy directory. The fallback exists because a
 * deployment upgrading into object storage still holds months of captures on
 * disk, and a disputed punch from before the upgrade must not become unreadable
 * the day it ships. It keeps the path-traversal guard the on-disk vault always
 * had: `relative` comes from a database column, but a column is not a promise.
 */
export async function loadCapture(relative: string): Promise<Buffer> {
  try {
    return decrypt(await getObject(objectKey(relative)));
  } catch (error) {
    const full = path.resolve(root(), relative);
    if (full !== root() && !full.startsWith(root() + path.sep)) {
      throw new Error('Refusing to read outside the attendance capture vault.');
    }
    let payload;
    try {
      payload = await readFile(full);
    } catch {
      // Report the object-storage failure, not the fallback's ENOENT: the first
      // is why the read failed, the second is only that the old vault has been
      // migrated away.
      throw error;
    }
    logger.info({ relative }, 'attendance capture served from the legacy on-disk vault');
    return decrypt(payload);
  }
}

/**
 * Remove one capture, from whichever vault holds it.
 *
 * Used when the punch row itself is being deleted under a retention policy. The
 * frame is the evidence for that punch and nothing else refers to it, so it goes
 * with the row — and it goes *first*, for the reason the recordings sweep in
 * lib/jobs/retention.ts gives: delete the row first and the object is left in
 * the bucket with nothing pointing at it.
 *
 * Both vaults, because a deployment that upgraded into object storage has
 * captures in each and a punch old enough to be swept is exactly the punch whose
 * frame is most likely to still be on disk.
 *
 * Never throws for an absent object: a capture that is already gone is the
 * outcome this was asked for.
 */
export async function deleteCapture(relative: string): Promise<void> {
  await deleteObjects([objectKey(relative)]).catch((error) => {
    logger.warn({ err: error, relative }, 'attendance capture: object could not be deleted');
    return 0;
  });

  const full = path.resolve(root(), relative);
  // The same guard loadCapture keeps: `relative` comes from a database column,
  // and a column is not a promise. An unlink is the one place where being wrong
  // about that is unrecoverable.
  if (full !== root() && !full.startsWith(root() + path.sep)) {
    throw new Error('Refusing to delete outside the attendance capture vault.');
  }
  await unlink(full).catch(() => {
    /* not on disk, which is the normal case after migration */
  });
}

/** Each workspace's own window, defaulting rather than skipping. */
async function retentionCutoff(tenantId: string): Promise<number> {
  const settings = await prisma.organizationSetting
    .findUnique({ where: { tenantId }, select: { hrPolicy: true } })
    .catch(() => null);
  // A workspace with no settings row falls back to the registry default rather
  // than being skipped — an unconfigured workspace must still have its
  // biometrics aged out, not kept forever.
  const days = resolvePolicy(settings?.hrPolicy).captureRetentionDays;
  return Date.now() - days * 86_400_000;
}

/**
 * Biometric images must not accumulate forever. Call from a scheduled job.
 *
 * Each workspace's own `captureRetentionDays` governs its own prefix, so a
 * company that wants thirty days is not held to another's hundred and eighty.
 *
 * Both vaults are swept. The bucket is where captures are written now; the
 * legacy directory still holds everything stored before the migration, and
 * leaving it unswept would mean the oldest biometric data on the system is the
 * only data with no retention applied to it.
 */
export async function purgeExpiredCaptures(): Promise<{ removed: number; workspaces: number }> {
  const seen = new Set<string>();
  let removed = 0;

  // ── Object storage ────────────────────────────────────────────────────────
  try {
    for (const prefix of await listPrefixes(PREFIX)) {
      // `attendance/t-<id>/` -> `<id>`
      const shard = prefix.slice(PREFIX.length).replace(/\/$/, '');
      if (!shard.startsWith('t-')) continue;
      const tenantId = shard.slice(2);
      seen.add(tenantId);

      const cutoff = await retentionCutoff(tenantId);
      const expired = (await listObjects(prefix))
        .filter((object) => object.key.endsWith(SUFFIX))
        // No `lastModified` means the listing could not date the object. Keeping
        // it is the safe way to be wrong: a capture kept too long is a policy
        // problem, one deleted early is evidence that no longer exists.
        .filter((object) => object.lastModified !== null && object.lastModified.getTime() < cutoff)
        .map((object) => object.key);

      removed += await deleteObjects(expired);
    }
  } catch (error) {
    // A bucket that cannot be listed must not stop the legacy sweep below, and
    // must not fail the whole retention job — the other sweeps in
    // lib/jobs/retention.ts have their own work to do.
    logger.error({ err: error }, 'attendance capture purge: object storage could not be swept');
  }

  // ── The legacy on-disk vault ──────────────────────────────────────────────
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

  let shards: Dirent[] = [];
  try {
    shards = await readdir(root(), { withFileTypes: true });
  } catch {
    // No legacy directory at all is the expected state after migration.
  }

  for (const shard of shards) {
    if (!shard.isDirectory() || !shard.name.startsWith('t-')) continue;
    const tenantId = shard.name.slice(2);
    seen.add(tenantId);
    await walk(path.join(root(), shard.name), await retentionCutoff(tenantId));
  }

  // Counted once per workspace, not once per vault: a workspace with captures in
  // both is one workspace, and the number is reported to an operator.
  return { removed, workspaces: seen.size };
}
