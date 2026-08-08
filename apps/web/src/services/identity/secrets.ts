/**
 * Envelope encryption for authenticator secrets.
 *
 * A TOTP secret is a bearer credential: anyone holding it can mint valid codes
 * forever, so storing it in plaintext means a leaked database row defeats the
 * second factor entirely. It is encrypted with AES-256-GCM under a key derived
 * from FIELD_ENCRYPTION_KEY, with the same HKDF construction the attendance
 * capture vault uses but a different salt, so one key never protects two things.
 *
 * Values written before this existed are plaintext base32. `decryptSecret`
 * recognises the envelope prefix and passes anything else through unchanged, so
 * existing enrolments keep working and are re-wrapped the next time they are
 * written. Rotating FIELD_ENCRYPTION_KEY makes enrolled secrets undecryptable —
 * affected users must re-enrol.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

const PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const key = () =>
  Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.FIELD_ENCRYPTION_KEY),
      Buffer.from('master-saas-authenticator-secret-v1'),
      Buffer.from(''),
      32,
    ),
  );

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return PREFIX + Buffer.concat([iv, body]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // pre-encryption value
  const payload = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

export const isEncrypted = (stored: string) => stored.startsWith(PREFIX);
