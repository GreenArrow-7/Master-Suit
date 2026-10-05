/**
 * Phone numbers are stored twice: `phone` exactly as the user typed it, and
 * `phoneNormalized` in E.164 for duplicate matching and indexed lookup. Comparing
 * raw input is why "+971 50 123 4567" and "0501234567" end up as two leads.
 */
/** A number typed without a country code is a UAE one: every caller dials from there. */
const UAE = '971';

const NATIONAL_TRUNK_PREFIX = '0';

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.length < 6) return null;

  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  if (digits.startsWith(UAE)) return `+${digits}`;
  if (digits.startsWith(NATIONAL_TRUNK_PREFIX)) return `+${UAE}${digits.slice(1)}`;
  return `+${UAE}${digits}`;
}
