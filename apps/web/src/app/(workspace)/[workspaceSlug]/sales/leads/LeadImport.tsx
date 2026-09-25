'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const REQUIRED = 'fullName';
const ACCEPTED = ['fullName', 'email', 'phone', 'company', 'jobTitle', 'city', 'country', 'source', 'notes'];

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

/**
 * CSV lead import. The file is parsed in the browser and posted to the bulk endpoint
 * in batches, which creates each row through the same `createLead` service the form
 * uses — so scoring, deduplication, distribution and audit behave exactly as they do
 * for a lead typed in by hand. There is no row limit on the file.
 */
export default function LeadImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<{ created: number; failed: { line: number; reason: string }[] } | null>(null);
  const [error, setError] = useState('');

  async function handleFile(file: File) {
    setBusy(true);
    setError('');
    setReport(null);
    setProgress(0);

    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setBusy(false);
      setError('That file has a header but no rows.');
      return;
    }

    // \uFEFF as an escape, not the literal byte: Excel writes a UTF-8 BOM onto
    // the first header cell, and a raw BOM here is invisible to every reader.
    const headers = rows[0]!.map((h) => h.trim().replace(/^\uFEFF/, ''));
    if (!headers.includes(REQUIRED)) {
      setBusy(false);
      setError(`The header row must include a "${REQUIRED}" column. Found: ${headers.join(', ') || '(none)'}`);
      return;
    }

    // Posted server-side in chunks: one HTTP round trip per 500 rows rather than
    // per row, and each chunk is validated and created with the same service the
    // create form uses.
    const CHUNK = 500;
    const body = rows.slice(1).map((cells, index) => {
      const values: Record<string, string> = {};
      headers.forEach((header, column) => {
        const value = (cells[column] ?? '').trim();
        if (value && ACCEPTED.includes(header)) values[header] = value;
      });
      return { line: index + 2, values };
    });

    const failed: { line: number; reason: string }[] = [];
    let created = 0;

    for (let offset = 0; offset < body.length; offset += CHUNK) {
      const res = await fetch('/api/v1/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: body.slice(offset, offset + CHUNK) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(data.detail ?? data.title ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      created += data.created ?? 0;
      failed.push(...(data.failed ?? []));
      setProgress(Math.min(body.length, offset + CHUNK));
    }

    setBusy(false);
    setReport({ created, failed });
    if (created > 0) router.refresh();
  }

  function close() {
    setOpen(false);
    setReport(null);
    setError('');
  }

  return (
    <span className="lf-pop-anchor">
      <button
        type="button"
        className="lf-btn lf-btn--secondary"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Import
      </button>
      {open && (
        <div className="lf-pop lf-panelpop lf-panelpop--wide" role="dialog" aria-label="Import leads from CSV">
          <div className="lf-panelpop__head">
            <strong className="lf-panelpop__title">Import leads from CSV</strong>
            <button type="button" className="lf-linkbtn" onClick={close}>
              Close
            </button>
          </div>

          <p className="lf-hint">
            First row must be a header. Recognised columns: {ACCEPTED.join(', ')}. Rows are sent in batches of 500; a
            row that fails is reported and skipped, not rolled back.
          </p>

          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            aria-label="CSV file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          {busy && (
            <p className="lf-hint" role="status">
              Importing… {progress > 0 && `${progress} rows sent`}
            </p>
          )}
          {error && (
            <p className="lf-hint lf-hint--error" role="alert">
              {error}
            </p>
          )}

          {report && (
            <div className="lf-panelpop__report">
              <p data-tone="viridian">
                {report.created} lead{report.created === 1 ? '' : 's'} created.
              </p>
              {report.failed.length > 0 && (
                <>
                  <p data-tone="vermillion">{report.failed.length} row(s) rejected:</p>
                  <ul>
                    {report.failed.slice(0, 20).map((f) => (
                      <li key={f.line}>
                        Line {f.line}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
