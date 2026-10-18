/**
 * An Excel workbook (.xlsx) of one sheet, for the exports that also write CSV
 * (M16-15). No dependency: an .xlsx is a zip of a few XML parts, and node:zlib
 * has the deflate and the CRC-32 a zip needs.
 *
 * The rules are the CSV's (lib/csv.ts), carried into the format:
 *
 *   - **Types.** A number is a number cell and a Date a date cell (UTC, as the
 *     CSV writes it); everything else is text, exactly the text the CSV holds.
 *   - **Formula injection.** No cell is ever a formula: text goes in as an
 *     inline string, which Excel and Sheets never evaluate. A cell the CSV
 *     would prefix with an apostrophe (`=`, `+`, `-`, `@`, tab, CR) carries the
 *     quote-prefix style instead, which is how Excel itself stores a typed
 *     leading apostrophe, so editing the cell later still keeps it text.
 *   - **Streaming.** Rows arrive in pages and leave compressed as they come, the
 *     sheet's sizes in a data descriptor after it, so memory is a page, not the
 *     file.
 */
import { constants, crc32, deflateRawSync } from 'node:zlib';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** cellXfs below: 1 bold header, 2 a date, 3 a date and time, 4 text kept as text. */
const HEADER = 1;
const DATE = 2;
const DATETIME = 3;
const TEXT = 4;

const STYLES =
  `${XML}<styleSheet xmlns="${MAIN}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
  '<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** What the CSV prefixes with an apostrophe (lib/csvCell.ts). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Characters XML 1.0 cannot carry at all, lone surrogates included. */
const NOT_XML = /[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;
/** Excel refuses a file with a longer cell. */
const CELL_MAX = 32_767;

const escape = (text: string) =>
  text.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A, B, …, Z, AA, … */
function column(index: number) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cell(value: unknown, ref: string, header: boolean): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) return '';
    // Days since 1899-12-30, Excel's epoch; a UTC midnight reads as a day alone.
    return `<c r="${ref}" s="${ms % 86_400_000 === 0 ? DATE : DATETIME}"><v>${ms / 86_400_000 + 25_569}</v></c>`;
  }
  const text = String(value).slice(0, CELL_MAX);
  const style = header ? HEADER : FORMULA_START.test(text) ? TEXT : 0;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escape(text)}</t></is></c>`;
}

function row(cells: unknown[], index: number, header = false) {
  const r = index + 1;
  return `<row r="${r}">${cells.map((value, i) => cell(value, `${column(i)}${r}`, header)).join('')}</row>`;
}

/** A sheet name Excel accepts: 31 characters, none of `: \ / ? * [ ]`, not wrapped in apostrophes. */
function sheetName(name: string) {
  const clean = name
    .replace(NOT_XML, '')
    .replace(/[:\\/?*[\]]/g, ' ')
    .slice(0, 31)
    .replace(/^'+|'+$/g, '')
    .trim();
  return clean || 'Sheet1';
}

function parts(sheet: string): [string, string][] {
  return [
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
        `<sheet name="${escape(sheetName(sheet)).replace(/"/g, '&quot;')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
  ];
}

// The zip itself (PKWARE APPNOTE 6.3): local headers, the data, a central directory.
// ponytail: no Zip64, so 4 GiB per part; EXPORT_MAX_ROWS keeps an export far below it.
interface Entry {
  name: Buffer;
  flags: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
}
const UTF8_NAMES = 0x0800;
const SIZES_AFTER = 0x0008;

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** What a local header and its central-directory record share, from "version needed" to "extra length". */
function common(e: Entry) {
  return Buffer.concat([
    u16(20), // version needed: 2.0, deflate
    u16(e.flags),
    u16(8), // deflate
    u16(0), // time 00:00
    u16(0x21), // date 1980-01-01: no clock in the file, so the same rows make the same bytes
    u32(e.crc),
    u32(e.packed),
    u32(e.size),
    u16(e.name.length),
    u16(0), // no extra field
  ]);
}

/**
 * A workbook whose first row is `header` and whose other rows come from
 * `pages`, streamed. An error from `pages` errors the stream.
 */
export function xlsxStream(
  header: unknown[],
  pages: AsyncIterable<unknown[][]>,
  sheet = 'Sheet1',
): ReadableStream<Uint8Array> {
  const entries: Entry[] = [];
  const body: Entry = {
    name: Buffer.from('xl/worksheets/sheet1.xml'),
    flags: UTF8_NAMES | SIZES_AFTER,
    crc: 0,
    packed: 0,
    size: 0,
    offset: 0,
  };
  const iterator = pages[Symbol.asyncIterator]();
  let offset = 0;
  let rows = 1;
  let out!: ReadableStreamDefaultController<Uint8Array>;

  const write = (bytes: Buffer) => {
    out.enqueue(bytes);
    offset += bytes.length;
  };
  /** Part of the sheet. A sync flush ends it on a byte boundary without ending the stream,
   *  so chunks compressed one at a time concatenate into one deflate stream. */
  const chunk = (text: string) => {
    const data = Buffer.from(text);
    const packed = deflateRawSync(data, { finishFlush: constants.Z_SYNC_FLUSH });
    body.crc = crc32(data, body.crc);
    body.size += data.length;
    body.packed += packed.length;
    write(packed);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
      for (const [name, text] of parts(sheet)) {
        const data = Buffer.from(text);
        const packed = deflateRawSync(data);
        const entry = {
          name: Buffer.from(name),
          flags: UTF8_NAMES,
          crc: crc32(data),
          packed: packed.length,
          size: data.length,
          offset,
        };
        entries.push(entry);
        write(Buffer.concat([u32(0x04034b50), common(entry), entry.name, packed]));
      }
      body.offset = offset;
      entries.push(body);
      // Its sizes are not known yet: zero here, the real ones in the descriptor after its data.
      write(Buffer.concat([u32(0x04034b50), common({ ...body, crc: 0, packed: 0, size: 0 }), body.name]));
      chunk(`${XML}<worksheet xmlns="${MAIN}"><sheetData>${row(header, 0, true)}`);
    },
    async pull() {
      // A pull that enqueues nothing is never called again, so an empty page reads the next.
      for (let page = await iterator.next(); !page.done; page = await iterator.next()) {
        if (page.value.length) return chunk(page.value.map((cells) => row(cells, rows++)).join(''));
      }
      chunk('</sheetData></worksheet>');
      const last = deflateRawSync(Buffer.alloc(0)); // the final, empty block
      body.packed += last.length;
      write(Buffer.concat([last, u32(0x08074b50), u32(body.crc), u32(body.packed), u32(body.size)]));
      const directory = offset;
      for (const e of entries) {
        // version made by, the shared fields, then comment length, disk, internal and external attributes.
        write(Buffer.concat([u32(0x02014b50), u16(20), common(e), Buffer.alloc(10), u32(e.offset), e.name]));
      }
      const count = u16(entries.length);
      write(Buffer.concat([u32(0x06054b50), u32(0), count, count, u32(offset - directory), u32(directory), u16(0)]));
      out.close();
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

/** The same workbook, whole: a report already in memory, or a mail attachment. */
export async function xlsx(header: unknown[], rows: unknown[][], sheet?: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = xlsxStream(
    header,
    (async function* () {
      yield rows;
    })(),
    sheet,
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
