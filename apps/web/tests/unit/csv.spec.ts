import { describe, expect, it } from 'vitest';
import { csvCell, csvHeader, csvHeaders, csvRow, csvStream, type CsvColumn } from '@/lib/csv';

/**
 * The CSV encoder every export shares.
 *
 * It was extracted from the lead export, which had these properties from the
 * start; the report export written later did not, and quietly shipped without
 * the formula-injection defence until the two were merged. These pin the
 * properties so a third copy cannot drift again.
 */
interface Row {
  id: string;
  name: string;
  n: number | null;
}

const columns: CsvColumn<Row>[] = [
  { label: 'Name', value: (r) => r.name },
  { label: 'Count', value: (r) => r.n },
];

describe('csvCell', () => {
  it('quotes everything, so a cell is predictable regardless of content', () => {
    expect(csvCell('web')).toBe('"web"');
    expect(csvCell(3)).toBe('"3"');
  });

  it('writes an unknown as an empty cell rather than the word null', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('doubles an embedded quote', () => {
    expect(csvCell('the "good" ones')).toBe('"the ""good"" ones"');
  });

  it('keeps a comma inside its own cell', () => {
    // Otherwise every column after it shifts one to the left, silently.
    expect(csvCell('Dubai, Marina')).toBe('"Dubai, Marina"');
  });

  it('neutralises a cell a spreadsheet would execute', () => {
    // =HYPERLINK("http://…") in a lead's name is a phishing link that arrives
    // inside your own export.
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    for (const dangerous of ['@SUM(A1)', '\tx', '-2+3+cmd', '+cmd|calc']) {
      expect(csvCell(dangerous).startsWith('"\'')).toBe(true);
    }
  });

  it('leaves a plain number alone, sign and all', () => {
    // -82500 is a clawback, not an attack. Prefixing it makes Excel read the
    // cell as text, so a money column full of negatives stops summing.
    expect(csvCell(-82500)).toBe('"-82500"');
    expect(csvCell('-82500')).toBe('"-82500"');
    expect(csvCell('+1.5')).toBe('"+1.5"');
    expect(csvCell('-1e6')).toBe('"-1e6"');
  });

  it('leaves a value that merely contains those characters alone', () => {
    // Only a leading one is executed; prefixing every hyphen would corrupt
    // every phone number and date in the file.
    expect(csvCell('a-b')).toBe('"a-b"');
    expect(csvCell('2+2')).toBe('"2+2"');
  });

  it('writes a date as ISO rather than a locale string', () => {
    expect(csvCell(new Date('2026-08-09T10:11:12.000Z'))).toBe('"2026-08-09T10:11:12.000Z"');
  });
});

describe('the header and rows', () => {
  it('leads with a byte-order mark so Excel reads UTF-8', () => {
    // Without it every non-ASCII name arrives in the local codepage, mangled.
    expect(csvHeader(columns).startsWith('﻿')).toBe(true);
    expect(csvHeader(columns)).toBe('﻿"Name","Count"\r\n');
  });

  it('terminates with CRLF, as RFC 4180 asks', () => {
    expect(csvRow(columns, { id: '1', name: 'web', n: 3 })).toBe('"web","3"\r\n');
  });

  it('emits only the declared columns, in their order', () => {
    const reversed: CsvColumn<Row>[] = [columns[1], columns[0]];
    expect(csvRow(reversed, { id: '1', name: 'web', n: 3 })).toBe('"3","web"\r\n');
  });
});

async function read(stream: ReadableStream<Uint8Array>) {
  // ignoreBOM, or the decoder silently strips the very byte under test.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let out = '';
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe('csvStream', () => {
  const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: String(i + 1).padStart(4, '0'), name: `row ${i + 1}`, n: i }));

  it('walks every page and stops on a short one', async () => {
    const all = rows(7);
    const seen: (string | null)[] = [];
    let done = -1;

    const text = await read(
      csvStream<Row>({
        columns,
        pageSize: 3,
        page: async (cursor) => {
          seen.push(cursor);
          const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
          return all.slice(start, start + 3);
        },
        onDone: async (written) => {
          done = written;
        },
      }),
    );

    expect(text.split('\r\n').filter(Boolean)).toHaveLength(8); // header + 7
    expect(done).toBe(7);
    // Keyset, not offset: each page asks from the last id it saw.
    expect(seen).toEqual([null, '0003', '0006']);
  });

  it('writes just a header when there is nothing to export', async () => {
    let done = -1;
    const text = await read(
      csvStream<Row>({
        columns,
        page: async () => [],
        onDone: async (written) => {
          done = written;
        },
      }),
    );
    expect(text).toBe('﻿"Name","Count"\r\n');
    // An empty export is still an export, and is still recorded as one.
    expect(done).toBe(0);
  });

  it('reports the total actually written, not the total asked for', async () => {
    let done = -1;
    const all = rows(2);
    await read(
      csvStream<Row>({
        columns,
        pageSize: 500,
        page: async (cursor) => (cursor ? [] : all),
        onDone: async (written) => {
          done = written;
        },
      }),
    );
    expect(done).toBe(2);
  });
});

describe('the download headers', () => {
  it('names the file and refuses to let a proxy keep it', () => {
    const headers = csvHeaders('listings', 'req-1');
    expect(headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(headers['content-disposition']).toMatch(/attachment; filename="listings-\d{4}-\d{2}-\d{2}\.csv"/);
    // Somebody's live data; a copy in a shared cache is both stale and theirs.
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-request-id']).toBe('req-1');
  });
});
