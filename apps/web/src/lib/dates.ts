/**
 * Calendar dates as people type them and as forms submit them.
 *
 * Typed: DD/MM/YYYY, the order the app displays everywhere (en-GB), whatever
 * the browser's language — a native date field shows MM/DD/YYYY on an en-US
 * browser, which is how "10/08" came to mean two different days. Submitted:
 * YYYY-MM-DD, which every API already accepts, so no server changes.
 *
 * Client-safe: no time zone is involved in a calendar date. Instants that
 * reach a date field are read in the browser's zone, which is the person's.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Day, month, year: separated by /, - or . ; day and month may be one digit. */
const TYPED_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
/** DDMMYYYY: a phone's number pad has no "/". */
const DIGITS_DATE = /^(\d{2})(\d{2})(\d{4})$/;

/** A plausible range: catches a two-digit year typed as 0026, and 20226. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

const pad = (n: number) => String(n).padStart(2, '0');

function isoFromParts(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  // The calendar decides: 31/04 and 29/02/2027 do not exist.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** What a person typed, as YYYY-MM-DD; null when it is not a real date. */
export function parseTypedDate(text: string): string | null {
  const value = text.trim();
  const iso = ISO_DATE.exec(value);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const typed = TYPED_DATE.exec(value) ?? DIGITS_DATE.exec(value);
  if (typed) return isoFromParts(Number(typed[3]), Number(typed[2]), Number(typed[1]));
  return null;
}

/** YYYY-MM-DD as DD/MM/YYYY; '' for anything else. */
export function formatTypedDate(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * Any date-ish value as YYYY-MM-DD: a Date, a full ISO timestamp (a native date
 * field shows those as blank — the prefill bug), or YYYY-MM-DD itself. Instants
 * are read in the local zone, so midnight in Dubai stays the same day.
 */
export function toDateValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string' && ISO_DATE.test(value)) return parseTypedDate(value) ?? '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** HH:mm of an instant or of a "YYYY-MM-DDTHH:mm" value, in the local zone; '' otherwise. */
export function toTimeValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const local = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/.exec(value);
    if (local) return `${local[1]}:${local[2]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Why a typed date cannot be used, or null when it can. */
export function dateProblem(
  text: string,
  { required = false, min, max }: { required?: boolean; min?: string; max?: string } = {},
): string | null {
  if (!text.trim()) return required ? 'Enter a date.' : null;
  const iso = parseTypedDate(text);
  if (!iso) return 'Enter a real date as DD/MM/YYYY.';
  if (min && iso < min) return `Choose ${formatTypedDate(min)} or later.`;
  if (max && iso > max) return `Choose ${formatTypedDate(max)} or earlier.`;
  return null;
}
