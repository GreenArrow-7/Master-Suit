'use client';

/**
 * Downloads a CSV the server already built. A Blob URL rather than a data: URI
 * so a large export does not bloat the DOM, and no network call — the CSP is
 * connect-src 'self' and this needs to reach nothing.
 */
export default function ExportCsv({ filename, csv, label = 'Export CSV' }: { filename: string; csv: string; label?: string }) {
  function download() {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={download} disabled={!csv}>
      {label}
    </button>
  );
}
