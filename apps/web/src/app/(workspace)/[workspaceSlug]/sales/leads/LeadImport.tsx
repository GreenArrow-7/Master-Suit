'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  detectColumns,
  FIELD_LABELS,
  LEAD_FIELDS,
  prepareRows,
  type ColumnTarget,
  type PreparedRow,
} from '@/lib/leads/importMapping';

/** Minimal RFC 4180 reader: handles quoted fields, embedded commas and doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Excel or CSV → rows of strings. Excel is read in the browser; the file never leaves the device unparsed. */
async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const { default: readXlsx } = await import('read-excel-file/browser');
    // v9 returns every sheet as { sheet, data }; the first sheet is the import.
    const result = (await readXlsx(file)) as unknown as { data: unknown[][] }[] | unknown[][];
    const rows = (
      Array.isArray(result[0]) ? result : ((result[0] as { data: unknown[][] } | undefined)?.data ?? [])
    ) as unknown[][];
    return rows.map((cells) =>
      cells.map((cell) => (cell == null ? '' : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell))),
    );
  }
  return parseCsv(await file.text());
}

type Report = { created: number; failed: { line: number; reason: string }[] };

/**
 * Spreadsheet lead import: pick a file, confirm which column is which field, see what
 * will and will not be imported, then import. Rows are posted in batches to the bulk
 * endpoint, which creates each one through the same `createLead` service the form uses,
 * so scoring, deduplication, distribution and audit behave exactly as for a typed lead.
 */
export default function LeadImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [onDuplicate, setOnDuplicate] = useState<'BLOCK' | 'WARN'>('BLOCK');

  const prepared = useMemo<PreparedRow[]>(
    () => (file ? prepareRows(file.rows, file.headers, mapping) : []),
    [file, mapping],
  );
  const ready = prepared.filter((r) => !r.problem);
  const problems = prepared.filter((r) => r.problem);
  const inFileDuplicates = ready.filter((r) => r.duplicateOf !== undefined);
  const toSend = ready.filter((r) => onDuplicate === 'WARN' || r.duplicateOf === undefined);

  function reset() {
    setFile(null);
    setMapping([]);
    setReport(null);
    setError('');
    setProgress(0);
  }

  async function handleFile(picked: File) {
    reset();
    setBusy(true);
    try {
      const rows = await readFile(picked);
      if (rows.length < 2) {
        setError('That file has a header but no rows.');
        return;
      }
      const headers = rows[0].map((h) =>
        String(h ?? '')
          .trim()
          .replace(/^\uFEFF/, ''),
      );
      setFile({ name: picked.name, headers, rows: rows.slice(1) });
      setMapping(detectColumns(headers));
    } catch (err) {
      console.error('lead import: file could not be read', err);
      setError('That file could not be read. Save it as .xlsx or .csv and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function importRows() {
    if (!file || !mapping.includes('fullName')) {
      setError('Choose which column holds the full name.');
      return;
    }
    setBusy(true);
    setError('');
    setProgress(0);
    const failed: Report['failed'] = [];
    let created = 0;
    const CHUNK = 500;
    const rows = toSend.map(({ line, values }) => ({ line, values }));
    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      const res = await fetch('/api/v1/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: rows.slice(offset, offset + CHUNK), fileName: file.name, onDuplicate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.detail ?? data.title ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      created += data.created ?? 0;
      failed.push(...(data.failed ?? []));
      setProgress(Math.min(rows.length, offset + CHUNK));
    }
    setBusy(false);
    setReport({ created, failed });
    if (created > 0) router.refresh();
  }

  if (!open) {
    return (
      <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(true)}>
        Import
      </button>
    );
  }

  const small = { fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' } as const;
  const previewFields = mapping.filter((t): t is (typeof LEAD_FIELDS)[number] => LEAD_FIELDS.includes(t as never));

  return (
    <div
      className="lf-card"
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        marginTop: 6,
        zIndex: 20,
        width: file ? 'min(860px, calc(100vw - 32px))' : 340,
        padding: 'var(--lf-space-4)',
        boxShadow: 'var(--lf-shadow-2)',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--lf-space-3)',
        }}
      >
        <strong style={{ fontSize: 'var(--lf-text-sm)' }}>Import leads from Excel or CSV</strong>
        <button
          className="lf-toast__action"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Close
        </button>
      </div>

      {!file && (
        <>
          <p style={{ ...small, margin: '0 0 var(--lf-space-3)' }}>
            First row must be the column headings. Columns are matched automatically; you confirm the mapping before
            anything is imported.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            aria-label="Spreadsheet file"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void handleFile(picked);
            }}
          />
        </>
      )}

      {file && !report && (
        <>
          <p style={{ ...small, margin: '0 0 var(--lf-space-2)' }}>
            {file.name}: {file.rows.length} rows. Choose what each column becomes.
          </p>
          <div
            className="lf-table-wrap"
            style={{ maxHeight: 220, overflow: 'auto', marginBottom: 'var(--lf-space-3)' }}
          >
            <table className="lf-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Column in file</th>
                  <th>Example</th>
                  <th>Import as</th>
                </tr>
              </thead>
              <tbody>
                {file.headers.map((header, column) => (
                  <tr key={column}>
                    <td>{header || <em>(blank)</em>}</td>
                    <td style={small}>{file.rows.find((r) => String(r[column] ?? '').trim())?.[column] ?? ''}</td>
                    <td>
                      <select
                        className="lf-select"
                        aria-label={`Import "${header}" as`}
                        value={mapping[column]}
                        disabled={busy}
                        onChange={(event) => {
                          const target = event.target.value as ColumnTarget;
                          setMapping((current) =>
                            current.map((t, i) =>
                              i === column ? target : LEAD_FIELDS.includes(t as never) && t === target ? 'notes+' : t,
                            ),
                          );
                        }}
                      >
                        {LEAD_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </option>
                        ))}
                        <option value="notes+">Add to notes as “{header || 'column'}: …”</option>
                        <option value="skip">Skip this column</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ margin: '0 0 var(--lf-space-2)', fontSize: 'var(--lf-text-sm)' }}>
            <strong style={{ color: 'var(--lf-viridian)' }}>{toSend.length} ready</strong>
            {problems.length > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--lf-vermillion)' }}>{problems.length} with problems (skipped)</span>
              </>
            )}
            {inFileDuplicates.length > 0 && <> · {inFileDuplicates.length} repeat a phone or email within the file</>}
          </p>
          {problems.length > 0 && (
            <ul
              style={{ ...small, margin: '0 0 var(--lf-space-2)', paddingLeft: 16, maxHeight: 90, overflowY: 'auto' }}
            >
              {problems.slice(0, 20).map((r) => (
                <li key={r.line}>
                  Line {r.line}: {r.problem}
                </li>
              ))}
            </ul>
          )}
          <label style={{ ...small, display: 'block', margin: '0 0 var(--lf-space-3)' }}>
            <input
              type="checkbox"
              checked={onDuplicate === 'WARN'}
              disabled={busy}
              onChange={(event) => setOnDuplicate(event.target.checked ? 'WARN' : 'BLOCK')}
            />{' '}
            Also import rows that match a lead already in the workspace (otherwise they are skipped and listed)
          </label>

          {ready.length > 0 && (
            <div
              className="lf-table-wrap"
              style={{ maxHeight: 180, overflow: 'auto', marginBottom: 'var(--lf-space-3)' }}
            >
              <table className="lf-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Line</th>
                    {previewFields.map((f) => (
                      <th key={f}>{FIELD_LABELS[f]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ready.slice(0, 10).map((r) => (
                    <tr key={r.line}>
                      <td style={small}>{r.line}</td>
                      {previewFields.map((f) => (
                        <td
                          key={f}
                          style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {r.values[f] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {ready.length > 10 && <p style={{ ...small, margin: '4px 0 0' }}>…and {ready.length - 10} more.</p>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="lf-btn lf-btn--sm"
              disabled={busy || toSend.length === 0}
              onClick={() => void importRows()}
            >
              {busy
                ? `Importing… ${progress}/${toSend.length}`
                : `Import ${toSend.length} lead${toSend.length === 1 ? '' : 's'}`}
            </button>
            <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={reset}>
              Choose another file
            </button>
          </div>
        </>
      )}

      {error && <p style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', marginTop: 8 }}>{error}</p>}

      {report && (
        <div style={{ marginTop: 'var(--lf-space-3)', fontSize: 'var(--lf-text-2xs)' }}>
          <p style={{ margin: 0, color: 'var(--lf-viridian)' }}>
            {report.created} lead{report.created === 1 ? '' : 's'} created.
          </p>
          {report.failed.length > 0 && (
            <>
              <p style={{ margin: '6px 0 2px', color: 'var(--lf-vermillion)' }}>
                {report.failed.length} row(s) not imported:
              </p>
              <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 120, overflowY: 'auto' }}>
                {report.failed.slice(0, 50).map((f) => (
                  <li key={f.line}>
                    Line {f.line}: {f.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button className="lf-btn lf-btn--secondary lf-btn--sm" style={{ marginTop: 8 }} onClick={reset}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
