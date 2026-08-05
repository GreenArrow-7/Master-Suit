import type { ReactNode } from 'react';

export default function WorkspaceTable({ headers, rows, empty = 'No records yet.' }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  return <section className="lf-table-wrap">
    {rows.length === 0 ? <div className="lf-empty"><div className="lf-empty__mark" aria-hidden="true">◇</div><strong>No records</strong><p style={{ margin: '6px 0 0', color: 'var(--lf-ink-3)' }}>{empty}</p></div> : <table className="lf-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={headers[cellIndex]}>{cell}</td>)}</tr>)}</tbody></table>}
  </section>;
}
