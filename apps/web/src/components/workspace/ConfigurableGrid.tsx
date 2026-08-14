import type { ColumnDef, GridObject } from '@/lib/grid/columns';
import { renderCell, type GridRow } from './gridCells';

/**
 * A list grid whose columns come from the workspace's configuration rather than
 * from the page. Server-rendered: these grids are read-only, so none of them needs
 * the selection and sorting machinery that LeadGrid carries.
 */
export default function ConfigurableGrid({
  object,
  columns,
  rows,
  emptyLabel = '—',
}: {
  object: GridObject;
  columns: ColumnDef[];
  rows: GridRow[];
  /** Placeholder for an empty *cell*. */
  emptyLabel?: string;
}) {
  // No no-rows branch here on purpose: every page that renders this grid already
  // checks `length === 0` and shows an EmptyState with copy specific to what the
  // list is. A second, generic one underneath would be unreachable.
  return (
    <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
      <table className="lf-grid">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-hide-mobile={column.hideMobile ? '' : undefined}
                  data-label={column.label}
                  style={{ textAlign: column.align ?? 'left' }}
                >
                  {renderCell(object, column.key, row) ?? emptyLabel}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
