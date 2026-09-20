/**
 * The last cell of a phone card: a native disclosure that reveals the row's
 * `detail` columns. Pure markup — `lists-mobile.css` shows the folded cells
 * with `tr:has(details[open])`, so it works in server components and stays
 * keyboard reachable. Hidden on desktop, where the table has every column.
 */
export default function RowDetails() {
  return (
    <td className="lf-row-more" data-label="">
      <details className="lf-row-more__details">
        <summary className="lf-row-more__summary">Details</summary>
      </details>
    </td>
  );
}
