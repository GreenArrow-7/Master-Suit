'use client';

/**
 * Downloads a CSV the server already built and, beside it, the same table as
 * an Excel workbook when the server built that too (`xlsx`, base64; M16-15,
 * `tableFiles` in lib/csv.ts). A Blob URL rather than a data: URI so a large
 * export does not bloat the DOM, and no network call — the CSP is
 * connect-src 'self' and this needs to reach nothing.
 */
export default function ExportCsv({ filename, csv, xlsx }: { filename: string; csv: string; xlsx?: string }) {
  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // WebKit (Safari, the iOS app) reads the blob after the click returns; revoking at once
    // leaves it nothing to download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--lf-space-2)' }}>
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-btn--sm"
        onClick={() => save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)}
        disabled={!csv}
      >
        Export CSV
      </button>
      {xlsx && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost lf-btn--sm"
          onClick={() =>
            save(
              new Blob([Uint8Array.from(atob(xlsx), (c) => c.charCodeAt(0))], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }),
              filename.replace(/\.csv$/, '') + '.xlsx',
            )
          }
        >
          Excel
        </button>
      )}
    </span>
  );
}
