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
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
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

    const headers = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
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

  if (!open) {
    return <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(true)}>Import</button>;
  }

  return (
    <div className="lf-card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 20, width: 340, padding: 'var(--lf-space-4)', boxShadow: 'var(--lf-shadow-2)', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--lf-space-3)' }}>
        <strong style={{ fontSize: 'var(--lf-text-sm)' }}>Import leads from CSV</strong>
        <button className="lf-toast__action" onClick={() => { setOpen(false); setReport(null); setError(''); }}>Close</button>
      </div>

      <p style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', margin: '0 0 var(--lf-space-3)' }}>
        First row must be a header. Recognised columns: {ACCEPTED.join(', ')}. Rows are
        sent in batches of 500; a row that fails is reported and skipped, not rolled back.
      </p>

      <input
        type="file" accept=".csv,text/csv" disabled={busy} aria-label="CSV file"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFile(file); }}
      />

      {busy && <p style={{ fontSize: 'var(--lf-text-sm)', marginTop: 8 }}>Importing… {progress > 0 && `${progress} rows sent`}</p>}
      {error && <p style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', marginTop: 8 }}>{error}</p>}

      {report && (
        <div style={{ marginTop: 'var(--lf-space-3)', fontSize: 'var(--lf-text-2xs)' }}>
          <p style={{ margin: 0, color: 'var(--lf-viridian)' }}>{report.created} lead{report.created === 1 ? '' : 's'} created.</p>
          {report.failed.length > 0 && (
            <>
              <p style={{ margin: '6px 0 2px', color: 'var(--lf-vermillion)' }}>{report.failed.length} row(s) rejected:</p>
              <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 120, overflowY: 'auto' }}>
                {report.failed.slice(0, 20).map((f) => <li key={f.line}>Line {f.line}: {f.reason}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
