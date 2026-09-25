import type { ColumnDef, GridObject } from '@/lib/grid/columns';
import { renderCell, type GridRow } from './gridCells';

export type CellType = 'reference' | 'number' | 'date';

/**
 * The `data-type` a column's cells carry, derived from the catalogue so this
 * grid and LeadGrid set the same things the same way: right-set tabular
 * figures and dates, a 13px mono reference. Keys ending in At/Date are the
 * timestamps.
 */
export function cellType(column: ColumnDef): CellType | undefined {
  if (column.key === 'reference') return 'reference';
  if (column.align === 'right') return 'number';
  if (/(At|Date)$/.test(column.key)) return 'date';
  return undefined;
}

/** Alignment lives on the th as an attribute, never inline, and follows the cell type. */
export function headAlign(type: CellType | undefined): 'right' | undefined {
  return type === 'number' || type === 'date' ? 'right' : undefined;
}

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
    <div className="lf-grid-wrap">
      <table className="lf-grid">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} data-align={headAlign(cellType(column))}>
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
                  data-type={cellType(column)}
                  data-hide-mobile={column.hideMobile ? '' : undefined}
                  data-label={column.label}
                  data-priority={column.primary ? 'primary' : undefined}
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
