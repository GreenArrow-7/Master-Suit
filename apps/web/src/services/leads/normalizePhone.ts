/**
 * Phone numbers are stored twice: `phone` exactly as the user typed it, and
 * `phoneNormalized` in E.164 for duplicate matching and indexed lookup. Comparing
 * raw input is why "+971 50 123 4567" and "0501234567" end up as two leads.
 */
const DIALLING_CODES: Record<string, string> = {
  AE: '971', SA: '966', QA: '974', KW: '965', BH: '973', OM: '968',
  IN: '91', PK: '92', GB: '44', US: '1',
};

const NATIONAL_TRUNK_PREFIX = '0';

export function normalizePhone(input: string, defaultCountry = 'AE'): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.length < 6) return null;

  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  const code = DIALLING_CODES[defaultCountry];
  if (!code) return null;

  if (digits.startsWith(code)) return `+${digits}`;
  if (digits.startsWith(NATIONAL_TRUNK_PREFIX)) return `+${code}${digits.slice(1)}`;
  return `+${code}${digits}`;
}

export const lastNine = (e164: string) => e164.replace(/\D/g, '').slice(-9);
