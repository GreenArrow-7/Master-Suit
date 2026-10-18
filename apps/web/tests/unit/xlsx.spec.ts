import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readSheet } from 'read-excel-file/node';
import { xlsx as build, xlsxStream } from '@/lib/xlsx';

const xlsx = async (...args: Parameters<typeof build>) => Buffer.from(await build(...args));

/**
 * The .xlsx writer (M16-15), read back two ways: by hand, through the zip's
 * central directory, so the bytes are what the format says; and by
 * read-excel-file (the lead import's reader), so a real reader opens it.
 */

/** Every part of a zip, by name, each inflated and its CRC checked. */
function unzip(file: Buffer) {
  const end = file.length - 22;
  expect(file.readUInt32LE(end)).toBe(0x06054b50);
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  const parts = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(file.readUInt32LE(at)).toBe(0x02014b50);
    const method = file.readUInt16LE(at + 10);
    const crc = file.readUInt32LE(at + 16);
    const packed = file.readUInt32LE(at + 20);
    const size = file.readUInt32LE(at + 24);
    const nameLength = file.readUInt16LE(at + 28);
    const extra = file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
    const local = file.readUInt32LE(at + 42);
    const name = file.subarray(at + 46, at + 46 + nameLength).toString();
    expect(file.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    expect(method).toBe(8);
    const data = inflateRawSync(file.subarray(start, start + packed));
    expect(data.length, name).toBe(size);
    expect(crc32(data), name).toBe(crc);
    parts.set(name, data.toString());
    at += 46 + nameLength + extra;
  }
  return parts;
}

const cells = (sheet: string) => [...sheet.matchAll(/<c r="([A-Z]+\d+)"[^>]*>.*?<\/c>/g)].map((m) => m[0]);

describe('xlsx', () => {
  const when = new Date('2026-10-18T09:30:00Z');
  const day = new Date('2026-10-18T00:00:00Z');
  const header = ['Name', 'Calls', 'At', 'Day', 'Note'];
  const rows = [
    ['Aisha <&> "Co"', 42, when, day, '=HYPERLINK("http://x","click")'],
    ['+971501234567', -82500.5, null, undefined, '@SUM(A1)\u0007'],
    ['عربي', 0, '', 'plain', '-1+2'],
  ];

  it('is a zip of the six parts a workbook needs, every one intact', async () => {
    const file = await xlsx(header, rows, 'Report');
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect([...unzip(file).keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes numbers as numbers, dates as dates, text as inline strings, and never a formula', async () => {
    const sheet = unzip(await xlsx(header, rows)).get('xl/worksheets/sheet1.xml')!;
    const all = cells(sheet);
    // The header: bold, kept as text.
    expect(all[0]).toBe('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Name</t></is></c>');
    expect(all).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Aisha &lt;&amp;&gt; "Co"</t></is></c>');
    expect(all).toContain('<c r="B2"><v>42</v></c>');
    // 2026-10-18 09:30 UTC, in days since Excel's epoch, as a date and time; a UTC midnight as a day.
    expect(all).toContain('<c r="C2" s="3"><v>46313.39583333333</v></c>');
    expect(all).toContain('<c r="D2" s="2"><v>46313</v></c>');
    expect(all).toContain('<c r="B3"><v>-82500.5</v></c>');
    // What the CSV prefixes with an apostrophe is text with the quote prefix, exactly as typed.
    expect(all).toContain(
      '<c r="E2" t="inlineStr" s="4"><is><t xml:space="preserve">=HYPERLINK("http://x","click")</t></is></c>',
    );
    expect(all).toContain('<c r="A3" t="inlineStr" s="4"><is><t xml:space="preserve">+971501234567</t></is></c>');
    expect(all).toContain('<c r="E4" t="inlineStr" s="4"><is><t xml:space="preserve">-1+2</t></is></c>');
    // A control character XML cannot carry is dropped, not the file.
    expect(all).toContain('<c r="E3" t="inlineStr" s="4"><is><t xml:space="preserve">@SUM(A1)</t></is></c>');
    // Empty cells are left out; nothing anywhere is a formula.
    expect(sheet).not.toContain('r="C3"');
    expect(sheet).not.toContain('r="C4"');
    expect(sheet).not.toMatch(/<f[ >]/);
    expect(sheet.match(/<row /g)).toHaveLength(4);
  });

  it('opens in a real reader with the same rows', async () => {
    const read = await readSheet(await xlsx(header, rows));
    // The reader turns days back into milliseconds a millisecond short; the serial itself is exact (above).
    expect(Math.abs((read[1]![2] as unknown as Date).getTime() - when.getTime())).toBeLessThan(2);
    (read[1] as unknown[])[2] = when;
    expect(read).toEqual([
      header,
      ['Aisha <&> "Co"', 42, when, day, '=HYPERLINK("http://x","click")'],
      ['+971501234567', -82500.5, null, null, '@SUM(A1)'],
      ['عربي', 0, null, 'plain', '-1+2'],
    ]);
  });

  it('streams page after page into one sheet', async () => {
    async function* pages() {
      for (let page = 0; page < 3; page++) yield Array.from({ length: 400 }, (_, i) => [`r${page * 400 + i}`, i]);
      yield [];
    }
    const file = Buffer.from(await new Response(xlsxStream(['Ref', 'n'], pages())).arrayBuffer());
    const read = await readSheet(file);
    expect(read).toHaveLength(1201);
    expect(read[1200]).toEqual(['r1199', 399]);
    expect(unzip(file).get('xl/worksheets/sheet1.xml')).toContain('<c r="A1201"');
  });

  it('names the sheet as Excel allows: 31 characters, none of : \\ / ? * [ ]', async () => {
    const workbook = unzip(await xlsx(['a'], [], "'Leads: north/south [all] & more, this long'")).get(
      'xl/workbook.xml',
    )!;
    expect(workbook).toContain('<sheet name="Leads  north south  all  &amp; mor" sheetId="1" r:id="rId1"/>');
    expect(unzip(await xlsx(['a'], [], '???')).get('xl/workbook.xml')).toContain('name="Sheet1"');
  });

  it('columns past Z are AA, AB, …', async () => {
    const wide = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const sheet = unzip(await xlsx(wide, [])).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="Z1"');
    expect(sheet).toContain('<c r="AB1"');
  });
});
