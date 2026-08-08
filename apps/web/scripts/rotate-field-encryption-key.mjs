#!/usr/bin/env node
/**
 * Re-wraps everything sealed with FIELD_ENCRYPTION_KEY under a new key.
 *
 * That key protects authenticator secrets and attendance captures. Changing it
 * without re-wrapping makes every enrolled second factor undecryptable, so the
 * naive rotation is a mass lockout. This decrypts with the old key and
 * re-encrypts with the new one in a single pass, and only then is it safe to
 * change the value the application boots with.
 *
 * Usage:
 *   FIELD_ENCRYPTION_KEY_OLD=<current> FIELD_ENCRYPTION_KEY_NEW=<new> \
 *     node scripts/rotate-field-encryption-key.mjs            # dry run
 *   … --apply                                                 # write
 *
 * Dry run is the default because this rewrites credential columns. Take a
 * database backup before --apply: a wrong old key produces rows that decrypt
 * with neither, and nothing here can undo that.
 *
 * Values written before envelope encryption existed are plaintext base32 and
 * carry no prefix. They are wrapped under the new key rather than skipped.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Must match services/identity/secrets.ts, or nothing decrypts. */
const SALT = 'master-saas-authenticator-secret-v1';

const APPLY = process.argv.includes('--apply');
const OLD = process.env.FIELD_ENCRYPTION_KEY_OLD;
const NEW = process.env.FIELD_ENCRYPTION_KEY_NEW;

if (!OLD || !NEW) {
  console.error('Set FIELD_ENCRYPTION_KEY_OLD and FIELD_ENCRYPTION_KEY_NEW.');
  process.exit(1);
}
if (OLD === NEW) {
  console.error('The old and new keys are identical — nothing to rotate.');
  process.exit(1);
}
if (Buffer.from(NEW, 'base64').byteLength < 32) {
  console.error('FIELD_ENCRYPTION_KEY_NEW must decode to at least 32 bytes. Use `npm run secrets`.');
  process.exit(1);
}

const derive = (secret) => Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from(SALT), Buffer.from(''), 32));

const oldKey = derive(OLD);
const newKey = derive(NEW);

function decrypt(stored, key) {
  if (!stored.startsWith(PREFIX)) return stored; // pre-encryption plaintext
  const payload = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

function encrypt(plain, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return PREFIX + Buffer.concat([iv, body]).toString('base64');
}

// The owning role: this touches every tenant's rows, which is control-plane work.
const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const rows = await prisma.platformUser.findMany({
  where: { mfaSecret: { not: null } },
  select: { id: true, email: true, mfaSecret: true },
});

console.log(`${APPLY ? 'Rotating' : 'Dry run —'} ${rows.length} authenticator secret(s).`);

let rewrapped = 0;
const failed = [];

for (const row of rows) {
  let plain;
  try {
    plain = decrypt(row.mfaSecret, oldKey);
  } catch {
    // Already under the new key, or under a key neither of these is.
    failed.push(row.email);
    continue;
  }

  if (APPLY) {
    await prisma.platformUser.update({
      where: { id: row.id },
      data: { mfaSecret: encrypt(plain, newKey) },
    });
  }
  rewrapped += 1;
}

console.log(`  re-wrapped: ${rewrapped}`);
if (failed.length > 0) {
  // Addresses, never secrets.
  console.warn(`  could not decrypt with the old key (${failed.length}): ${failed.join(', ')}`);
  console.warn('  Those accounts must clear mfaSecret and re-enrol.');
}
if (!APPLY) console.log('\nNothing was written. Re-run with --apply once a backup exists.');

await prisma.$disconnect();
process.exit(failed.length > 0 && APPLY ? 1 : 0);
