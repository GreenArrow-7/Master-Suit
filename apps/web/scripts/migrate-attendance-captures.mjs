#!/usr/bin/env node
/**
 * Copies attendance captures from the legacy on-disk vault into object storage.
 *
 * `services/hr/captureVault.ts` writes new captures to the bucket and reads from
 * it first, falling back to ATTENDANCE_CAPTURE_DIR when the object is absent.
 * That fallback is what keeps a disputed punch from before the upgrade readable.
 * This moves the backlog across so the fallback can eventually be deleted.
 *
 * The files are already encrypted — this copies ciphertext and never decrypts,
 * so it needs no FIELD_ENCRYPTION_KEY and cannot leak a frame.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-attendance-captures.mjs                # copy, keep originals
 *   node scripts/migrate-attendance-captures.mjs --dry-run      # list, change nothing
 *   node scripts/migrate-attendance-captures.mjs --delete-after-verify
 *
 * Copying is the default and originals are kept, because the reverse is not
 * recoverable. `--delete-after-verify` removes a local file only after reading
 * the object back and comparing every byte — not merely after a successful PUT,
 * which tells you the request was accepted and nothing more.
 *
 * Safe to re-run: an object that already exists with identical bytes is counted
 * and skipped, so an interrupted run resumes rather than restarting.
 */
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE_AFTER = process.argv.includes('--delete-after-verify');
const SUFFIX = '.jpg.enc';
const PREFIX = 'attendance/';

/** The env file, read directly: this runs as an operator script, not in the app. */
function env(name, fallback = '') {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.production', '.env']) {
    if (!existsSync(file)) continue;
    const match = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'));
    if (match) return match[1].trim();
  }
  return fallback;
}

const root = path.resolve(env('ATTENDANCE_CAPTURE_DIR', 'storage/attendance'));
const bucket = env('S3_BUCKET');
if (!bucket) {
  console.error('S3_BUCKET is not set. Run this from apps/web with .env.production present.');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT') || undefined,
  region: env('S3_REGION', 'us-east-1'),
  forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});

async function readObject(key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Every capture under the legacy root, as paths relative to it. */
async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(SUFFIX)) yield path.relative(root, full);
  }
}

let copied = 0;
let skipped = 0;
let deleted = 0;
let failed = 0;

if (!existsSync(root)) {
  console.log(`Nothing to migrate: ${root} does not exist.`);
  process.exit(0);
}

console.log(`Legacy vault : ${root}`);
console.log(`Bucket       : ${bucket} (prefix ${PREFIX})`);
console.log(`Mode         : ${DRY_RUN ? 'dry run' : DELETE_AFTER ? 'copy, verify, delete' : 'copy, keep originals'}\n`);

for await (const relative of walk(root)) {
  const key = PREFIX + relative.split(path.sep).join('/');
  const local = await readFile(path.join(root, relative));

  if (DRY_RUN) {
    console.log(`  would copy  ${relative}`);
    copied += 1;
    continue;
  }

  try {
    // Idempotent: an object already there with identical bytes is done.
    const existing = await readObject(key).catch(() => null);
    if (existing && existing.equals(local)) {
      skipped += 1;
    } else {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: local, ContentType: 'application/octet-stream' }),
      );
      copied += 1;
    }

    if (DELETE_AFTER) {
      // Read back and compare rather than trusting the PUT. A 200 says the
      // request was accepted; it does not say the bytes are retrievable.
      const stored = await readObject(key);
      if (!stored.equals(local)) throw new Error('stored object does not match the local file');
      await unlink(path.join(root, relative));
      deleted += 1;
    }
  } catch (error) {
    failed += 1;
    console.error(`  FAILED      ${relative}: ${error.message}`);
  }
}

console.log(
  `\n${DRY_RUN ? 'Would copy' : 'Copied'} ${copied}, already present ${skipped}` +
    `${DELETE_AFTER ? `, deleted locally ${deleted}` : ''}${failed ? `, FAILED ${failed}` : ''}.`,
);

if (failed) {
  console.error('\nSome captures did not migrate. The vault still reads the local copies, so nothing is lost.');
  process.exit(1);
}
if (!DRY_RUN && !DELETE_AFTER && copied + skipped > 0) {
  console.log('Originals kept. Re-run with --delete-after-verify once you are satisfied.');
}
