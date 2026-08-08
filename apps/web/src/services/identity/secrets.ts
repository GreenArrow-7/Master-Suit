/**
 * Envelope encryption for authenticator secrets.
 *
 * A TOTP secret is a bearer credential: anyone holding it can mint valid codes
 * forever, so storing it in plaintext means a leaked database row defeats the
 * second factor entirely. It is encrypted with AES-256-GCM under a key derived
 * from FIELD_ENCRYPTION_KEY.
 *
 * The construction now lives in lib/security/envelope.ts because integration
 * credentials need the same thing under a different key. The domain string below
 * is the HKDF salt and must never change — changing it makes every enrolled
 * secret undecryptable.
 *
 * Values written before this existed are plaintext base32. `decryptSecret`
 * recognises the envelope prefix and passes anything else through unchanged, so
 * existing enrolments keep working and are re-wrapped the next time they are
 * written. Rotating FIELD_ENCRYPTION_KEY makes enrolled secrets undecryptable —
 * affected users must re-enrol.
 */
import { envelope } from '@/lib/security/envelope';

const authenticator = envelope('master-saas-authenticator-secret-v1');

export const encryptSecret = (plain: string) => authenticator.encrypt(plain);
export const decryptSecret = (stored: string) => authenticator.decrypt(stored);
export const isEncrypted = (stored: string) => authenticator.isEncrypted(stored);
