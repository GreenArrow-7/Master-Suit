/**
 * Whether the day's work is done, and whether that may stop somebody leaving.
 *
 * A sales floor runs on activity a manager set that morning — a hundred calls,
 * forty follow-ups — and the gap between "the target exists" and "the target
 * was done" is most of the job. This turns a daily target into a condition of
 * checking out.
 *
 * The rules are here rather than in the service because they are the part that
 * decides whether a person may go home, which is not a decision to leave
 * scattered through a punch handler.
 */

/**
 * The only targets that may hold somebody at their desk.
 *
 * Effort a person controls, never an outcome. LEADS_CONVERTED and
 * LEADS_QUALIFIED are deliberately absent: whether a stranger buys a flat today
 * is not something an agent can finish by trying harder, and a gate on it is
 * not a target but a trap. LEADS_ASSIGNED is absent for the same reason from
 * the other direction — it counts what the rota handed them.
 *
 * A workspace can narrow this list. It cannot widen it.
 */
export const GATEABLE_METRICS = [
  'CALLS_ATTEMPTED',
  'CALLS_CONNECTED',
  'FOLLOWUPS_COMPLETED',
  'INVITATIONS_SENT',
] as const;

export type GateableMetric = (typeof GATEABLE_METRICS)[number];

export function isGateable(metric: string): metric is GateableMetric {
  return (GATEABLE_METRICS as readonly string[]).includes(metric);
}

/** How a metric reads in a sentence an agent is shown. */
const PHRASING: Record<GateableMetric, { one: string; many: string }> = {
  CALLS_ATTEMPTED: { one: 'call', many: 'calls' },
  CALLS_CONNECTED: { one: 'connected call', many: 'connected calls' },
  FOLLOWUPS_COMPLETED: { one: 'follow-up', many: 'follow-ups' },
  INVITATIONS_SENT: { one: 'invitation', many: 'invitations' },
};

export interface QuotaRow {
  metric: string;
  target: number;
  achieved: number;
  /** Never below zero: overshooting one target does not offset another. */
  remaining: number;
}

export interface QuotaVerdict {
  /** True when check-out must be refused. */
  blocked: boolean;
  rows: QuotaRow[];
  /** What to tell them. Empty when nothing is being enforced. */
  message: string;
  /** Set when the day ran long enough that the targets stopped applying. */
  releasedByHours: boolean;
}

export interface QuotaPolicy {
  requireTargetsBeforeCheckOut: boolean;
  checkOutQuotaMetrics: string[];
  checkOutQuotaMaxHours: number;
}

/**
 * What the workspace has actually switched on, narrowed to what is permitted.
 *
 * Case-insensitive on the way in. The stored value is a free-form string array
 * and anything that writes it — an admin screen, a seed, somebody's curl — may
 * spell it in lower case; silently enforcing nothing because of it would look
 * exactly like the feature being off.
 */
export function enforcedMetrics(policy: QuotaPolicy): GateableMetric[] {
  if (!policy.requireTargetsBeforeCheckOut) return [];
  const seen = new Set<GateableMetric>();
  for (const raw of policy.checkOutQuotaMetrics) {
    const metric = String(raw).trim().toUpperCase();
    if (isGateable(metric)) seen.add(metric);
  }
  return [...seen];
}

function phrase(row: QuotaRow): string {
  const words = PHRASING[row.metric as GateableMetric];
  const noun = words ? (row.remaining === 1 ? words.one : words.many) : row.metric.toLowerCase().replace(/_/g, ' ');
  return `${row.remaining} more ${noun}`;
}

/**
 * The verdict, given today's daily targets and how long they have been here.
 *
 * `workedMinutes` is null when there is no open check-in — which is its own
 * problem, but not this one's: a check-out with nothing to check out of is
 * refused earlier, by the assignment rules.
 */
export function quotaVerdict(rows: QuotaRow[], workedMinutes: number | null, policy: QuotaPolicy): QuotaVerdict {
  const unmet = rows.filter((row) => row.remaining > 0);

  if (rows.length === 0 || unmet.length === 0) {
    return { blocked: false, rows, message: '', releasedByHours: false };
  }

  /**
   * The ceiling, and the reason it is not optional.
   *
   * An attendance gate with no end turns a target into unpaid overtime, which
   * is both the wrong incentive and, past the statutory day, unlawful. After
   * this the shortfall is still recorded — it is simply no longer a lock.
   */
  const maxMinutes = policy.checkOutQuotaMaxHours * 60;
  if (workedMinutes !== null && workedMinutes >= maxMinutes) {
    return {
      blocked: false,
      rows,
      message: `Checked out with ${unmet.map(phrase).join(' and ')} outstanding, after ${policy.checkOutQuotaMaxHours} hours.`,
      releasedByHours: true,
    };
  }

  return {
    blocked: true,
    rows,
    message: `${unmet.map(phrase).join(' and ')} before you can check out.`,
    releasedByHours: false,
  };
}
