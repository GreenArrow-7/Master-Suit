import { withPlatformTx } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * The measurable value shown on the front door: work the platform did so a person
 * did not have to. Every figure is a count of rows that exist, across every
 * workspace, converted to time with the assumptions below. Nothing here is a
 * marketing number: if there is no work to count, nothing is shown.
 */
export interface ValueCounts {
  /** Lead rows created from a spreadsheet instead of being typed in. */
  leadsImported: number;
  /** Calls a model summarised, scored and turned into next steps. */
  callsAnalysed: number;
  /** Automation steps that ran to completion. */
  automationSteps: number;
  /** Leads handed to a seller by a distribution rule rather than by hand. */
  leadsAutoAssigned: number;
}

/**
 * Minutes of manual work each automated action stands in for. Stated once, here,
 * so the "hours saved" figure can be traced to its assumption and challenged.
 */
export const MINUTES_PER_ACTION: Record<keyof ValueCounts, number> = {
  leadsImported: 2, // typing one lead into a form
  callsAnalysed: 8, // listening back and writing a summary and next steps
  automationSteps: 3, // the reminder, task, message or update a person would have done
  leadsAutoAssigned: 1, // reading the lead and choosing who gets it
};

export interface ValueSummary {
  counts: ValueCounts;
  actions: number;
  hoursSaved: number;
}

export function valueSummary(counts: ValueCounts): ValueSummary {
  const actions = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const minutes = (Object.keys(counts) as (keyof ValueCounts)[]).reduce(
    (sum, key) => sum + counts[key] * MINUTES_PER_ACTION[key],
    0,
  );
  return { counts, actions, hoursSaved: Math.round(minutes / 60) };
}

const TTL_MS = 15 * 60 * 1000;
let memo: { at: number; value: ValueSummary | null } | null = null;

/**
 * Platform-wide, so it runs under the platform flag: the login page has no
 * tenant. Cached in-process for fifteen minutes — the front door must not add a
 * cross-tenant count to every sign-in. Returns null (show nothing) on any error.
 */
export async function platformValue(): Promise<ValueSummary | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  try {
    const counts = await withPlatformTx(async (tx) => {
      const [leadsImported, callsAnalysed, automationSteps, leadsAutoAssigned] = await Promise.all([
        tx.lead.count({ where: { tenantId: { not: '' }, source: 'IMPORT' } }),
        tx.aIAnalysis.count({
          where: { tenantId: { not: '' }, status: 'COMPLETED', modelId: { not: 'demo-simulation' } },
        }),
        tx.automationExecution.count({ where: { tenantId: { not: '' }, status: 'SUCCEEDED' } }),
        tx.leadAssignmentHistory.count({ where: { tenantId: { not: '' }, method: { not: null } } }),
      ]);
      return { leadsImported, callsAnalysed, automationSteps, leadsAutoAssigned };
    });
    const value = valueSummary(counts);
    memo = { at: Date.now(), value: value.actions > 0 ? value : null };
  } catch (err) {
    logger.warn({ err }, 'platform value metrics unavailable');
    memo = { at: Date.now(), value: null };
  }
  return memo.value;
}
