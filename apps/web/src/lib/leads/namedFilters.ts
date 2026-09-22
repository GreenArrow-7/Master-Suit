import { CLOSED_OUT_WHERE } from '@/services/leads/closeOut';

/**
 * The named lead filters — `overdue`, `unassigned`, `breached` — in one place.
 *
 * ── The defect this exists to close ─────────────────────────────────────────
 *
 * `filter` meant two different things depending on which door you came through.
 * The screens and the CSV export read it as one of these names; the v1 list
 * routes read it as a base64url-encoded filter tree. The dashboard's attention
 * rows link to `/leads?filter=overdue`, and the same question asked of
 * `/api/v1/leads?filter=overdue` did not return the overdue leads — it returned
 * a 500, because the name decoded to five bytes of rubbish.
 *
 * A manager clicking a number and getting a different set from the API that
 * produced the number is the failure `tests/e2e/follow-up-mobile.spec.ts`
 * already describes in its own comment. The list route now understands these
 * names, and understands them from this file rather than from a third private
 * copy — there were two, and they had already drifted: the screen had `mine`
 * and the export did not.
 *
 * `overdue` is deliberately NOT here. It is not a `where` fragment that can be
 * written down: it depends on the viewer's reach, and is built by
 * `obligationWhere(await obligationAccess(ctx, …), 'overdue', now)`. Putting a
 * lookalike here would be the drift this file exists to stop, so the key is
 * listed in `NAMED_LEAD_FILTER_KEYS` and each caller asks the obligation
 * service for it.
 */
export const SIMPLE_NAMED_LEAD_FILTERS: Record<string, (now: Date, actorId: string) => Record<string, unknown>> = {
  unassigned: () => ({ ownerId: null }),
  breached: () => ({ slaState: 'BREACHED' }),
  high_score: () => ({ score: { gte: 70 } }),
  mine: (_now, actorId) => ({ ownerId: actorId }),
  closed_out: () => CLOSED_OUT_WHERE,
};

/** Every name the product uses, including the ones built by a service. */
export const NAMED_LEAD_FILTER_KEYS = [...Object.keys(SIMPLE_NAMED_LEAD_FILTERS), 'overdue'] as const;

export function isNamedLeadFilter(value: string): boolean {
  return (NAMED_LEAD_FILTER_KEYS as readonly string[]).includes(value);
}

/**
 * The `where` for a name that is a plain fragment, or null for `overdue` and
 * for anything that is not a name at all. Null means "not answered here", not
 * "matches everything" — every caller must treat it that way.
 */
export function simpleNamedLeadFilterWhere(
  key: string | undefined,
  now: Date,
  actorId: string,
): Record<string, unknown> | null {
  if (!key) return null;
  const build = SIMPLE_NAMED_LEAD_FILTERS[key];
  return build ? build(now, actorId) : null;
}

/**
 * Whether a name is asking for closed-out leads.
 *
 * Closed-out leads are excluded from every list unless they are the thing being
 * asked for, and `closed_out` is that ask. Keeping this beside the filter means
 * a caller cannot apply the filter and forget the exclusion, which reads as
 * "the closed-out view is empty".
 */
export function wantsClosedOut(key: string | undefined): boolean {
  return key === 'closed_out';
}
