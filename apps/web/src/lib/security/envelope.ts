/**
 * Domain-separated envelope encryption for secrets that live in database columns.
 *
 * This construction was written once for authenticator secrets and is now needed
 * again for integration credentials, so it lives here rather than being copied.
 * `domain` is the HKDF salt: two domains derive two different keys from the same
 * FIELD_ENCRYPTION_KEY, so a leak of one plaintext never helps against the other,
 * and a bug that reads a TOTP secret with the integration envelope fails to
 * authenticate rather than silently succeeding.
 *
 * Values written before a column was encrypted are plaintext. `decrypt`
 * recognises the envelope prefix and passes anything else through unchanged, so
 * existing rows keep working and are re-wrapped the next time they are written.
 * Rotating FIELD_ENCRYPTION_KEY makes wrapped values undecryptable — see
 * scripts/rotate-field-key.mjs, which re-wraps rather than destroying.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

const PREFIX = 'v1.';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Envelope {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
  isEncrypted(stored: string): boolean;
}

export function envelope(domain: string): Envelope {
  // Derived per call rather than memoised: the rotation script mutates
  // process.env between passes, and a cached key would silently keep re-wrapping
  // under the old one.
  const key = () =>
    Buffer.from(hkdfSync('sha256', Buffer.from(env.FIELD_ENCRYPTION_KEY), Buffer.from(domain), Buffer.from(''), 32));

  return {
    encrypt(plain: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key(), iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return PREFIX + Buffer.concat([iv, body]).toString('base64');
    },

    decrypt(stored: string): string {
      if (!stored.startsWith(PREFIX)) return stored; // pre-encryption value
      const payload = Buffer.from(stored.slice(PREFIX.length), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, IV_BYTES));
      decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },

    isEncrypted: (stored: string) => stored.startsWith(PREFIX),
  };
}
