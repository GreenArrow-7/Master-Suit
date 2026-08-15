import type { ReactNode } from 'react';
import TableSearch from './TableSearch';

/**
 * Every list that is small enough to arrive in one response gets a search box,
 * automatically — there is no page left where an operator has to read a table
 * of forty rows looking for one name.
 *
 * The threshold exists because a search box over five rows is furniture: it
 * costs a line of vertical space and saves nobody a scroll.
 */
const SEARCHABLE_FROM = 8;

export default function WorkspaceTable({
  headers,
  rows,
  empty = 'No records yet.',
  searchPlaceholder,
  /** Force the box on or off when the row count is a poor proxy for usefulness. */
  searchable,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
  searchPlaceholder?: string;
  searchable?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="lf-table-wrap">
        <div className="lf-empty">
          <div className="lf-empty__mark" aria-hidden="true">
            ◇
          </div>
          <strong>No records</strong>
          <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-3)' }}>{empty}</p>
        </div>
      </section>
    );
  }

  const table = (
    <section className="lf-table-wrap">
      <table className="lf-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} data-label={headers[cellIndex]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  if (searchable === false || (searchable !== true && rows.length < SEARCHABLE_FROM)) return table;

  return (
    <TableSearch placeholder={searchPlaceholder ?? `Search these ${rows.length} rows…`}>{table}</TableSearch>
  );
}
