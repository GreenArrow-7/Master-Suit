export interface BulkFailure {
  id: string;
  detail: string;
}

export interface BulkOutcome {
  summary: string;
  groups: { detail: string; refs: string[] }[];
}

/**
 * What the bulk bar says after a run with refusals: how many failed, how many
 * worked, and each server sentence once with the leads it applies to.
 *
 * Leads are named by what the grid already shows (`rows` is the list the viewer
 * is looking at) and only the server's `detail` is repeated, so a 404 stays
 * "Lead not found." and `errors[]` never reaches the screen.
 */
export function summarizeBulk(
  total: number,
  failures: BulkFailure[],
  rows: { id: string; reference: string; fullName: string }[],
): BulkOutcome {
  const done = total - failures.length;
  const summary =
    `${failures.length} of ${total} could not be completed` +
    (done ? `; the other ${done} ${done === 1 ? 'was' : 'were'}` : '') +
    '.';
  const groups = new Map<string, string[]>();
  for (const failure of failures) {
    const row = rows.find((r) => r.id === failure.id);
    const refs = groups.get(failure.detail) ?? [];
    refs.push(row ? `${row.reference} (${row.fullName})` : 'a lead no longer listed');
    groups.set(failure.detail, refs);
  }
  return { summary, groups: [...groups].map(([detail, refs]) => ({ detail, refs })) };
}
