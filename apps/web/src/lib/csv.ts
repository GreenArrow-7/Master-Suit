/**
 * CSV, done the way the lead export already did it.
 *
 * That route got several things right that a naive `rows.join(',')` does not,
 * and they were about to be reimplemented — worse — in every other export. This
 * is the same code, lifted so there is one copy:
 *
 *   - **Formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed
 *     by Excel and Sheets when the file is opened. `=HYPERLINK(...)` in a lead's
 *     name is a phishing link that arrives as your own export. Prefixed with an
 *     apostrophe, which those programs strip on display.
 *   - **A byte-order mark.** Without it Excel reads UTF-8 as the local codepage
 *     and every non-ASCII name arrives mangled.
 *   - **Quoting everything**, rather than only cells that look like they need
 *     it. Cheaper to reason about and impossible to get subtly wrong.
 *   - **CRLF**, which RFC 4180 asks for.
 *
 * Exports also stream: a page is fetched, written and dropped, so memory is
 * bounded by the page size rather than by the size of the result. An export with
 * a row limit is a report somebody silently gets half of.
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

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => unknown;
}

/** One CSV line, terminated. */
export const csvRow = <T>(columns: CsvColumn<T>[], row: T) =>
  columns.map((column) => csvCell(column.value(row))).join(',') + '\r\n';

/** The header line, with the BOM Excel needs in front of it. */
export const csvHeader = <T>(columns: CsvColumn<T>[]) =>
  '﻿' + columns.map((column) => csvCell(column.label)).join(',') + '\r\n';

export interface CsvStreamOptions<T extends { id: string }> {
  columns: CsvColumn<T>[];
  /** One keyset page. Returning an empty array ends the file. */
  page: (cursor: string | null) => Promise<T[]>;
  /** Called once, after the last row, with the total actually written. */
  onDone?: (rows: number) => Promise<void>;
  pageSize?: number;
}

/**
 * A CSV body as a stream of keyset pages.
 *
 * Keyset rather than offset for the same reason every list here uses it: an
 * OFFSET deep into a large table re-scans everything before it, and rows
 * inserted mid-export shift the window so a row is skipped or repeated.
 */
export function csvStream<T extends { id: string }>(options: CsvStreamOptions<T>): ReadableStream<Uint8Array> {
  const { columns, page, onDone, pageSize = 500 } = options;
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let written = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvHeader(columns)));
    },
    async pull(controller) {
      const rows = await page(cursor);

      if (rows.length === 0) {
        // Audited on completion, not on request, so the record reflects what
        // actually left the system rather than what somebody asked for.
        await onDone?.(written);
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(rows.map((row) => csvRow(columns, row)).join('')));
      written += rows.length;
      cursor = rows[rows.length - 1].id;

      // A short page is the last page. Without this the next pull runs one
      // extra empty query per export.
      if (rows.length < pageSize) {
        await onDone?.(written);
        controller.close();
      }
    },
  });
}

/** The headers a browser needs to treat the body as a download. */
export const csvHeaders = (filename: string, requestId?: string) => ({
  'content-type': 'text/csv; charset=utf-8',
  'content-disposition': `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
  // Somebody's live data; a copy in a shared proxy is both stale and theirs.
  'cache-control': 'no-store',
  ...(requestId ? { 'x-request-id': requestId } : {}),
});
