/**
 * One CSV cell, the rule every file this app writes follows (lib/csv.ts says
 * why). Its own module, free of server configuration, so a screen can build a
 * file in the browser too: the lead import’s rejected rows (LeadImport.tsx).
 */

/**
 * A plain number, including a signed or exponent one.
 *
 * Exempt from the formula guard below. `-82500` is a clawback, not an attack,
 * and prefixing it makes Excel read the cell as text — so a money column full of
 * negatives silently stops summing. Nothing matching this can be a formula.
 */
const NUMERIC = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** RFC 4180 cell, with the spreadsheet formula trick blunted. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !NUMERIC.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
