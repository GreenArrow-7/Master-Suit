/**
 * Which drill should this rep run next?
 *
 * Practice connected to real weaknesses: the recommendation reads what the
 * pipeline already wrote — the rep's own completed call audits and the playbook
 * objections that went unaddressed on their calls — and picks the scenario that
 * targets the weakest area. Every recommendation carries its reasons, because a
 * drill assigned without evidence is homework, not coaching.
 *
 * Deterministic on purpose: aggregation and a label→scenario map, no model
 * call. The model's opinions are already priced into the audit scores.
 */
import { prisma } from '@/lib/db';
import type { PracticeScenario } from '@/lib/ai/practice';

interface CriterionScore {
  label: string;
  score: number;
  maxScore: number;
}

export interface PracticeRecommendation {
  scenario: PracticeScenario;
  objectionId?: string;
  objectionName?: string;
  reasons: string[];
}

/** Which drill rehearses which audit criterion. Unmapped labels don't compete. */
const SCENARIO_FOR: [RegExp, PracticeScenario][] = [
  [/objection/i, 'OBJECTION'],
  [/greet|introduc|open/i, 'OPENER'],
  [/discover|needs?|qualif|listen/i, 'DISCOVERY'],
  [/clos|follow.?up|commit|next step/i, 'CLOSE'],
];

/** A weakness needs at least this many scored calls behind it to be a pattern. */
const MIN_SAMPLE = 2;
/** Above this average there is no weakness worth drilling. */
const WEAK_BELOW = 0.7;

/**
 * The pure core, separated so the maths is testable without a database.
 * `audits` is each audit's criteriaScores array; `unaddressed` counts per
 * objection how often it went unhandled on the rep's calls.
 */
export function weakestArea(
  audits: readonly (readonly CriterionScore[])[],
  unaddressed: ReadonlyMap<string, { name: string; count: number }>,
): PracticeRecommendation | null {
  // Average score fraction per criterion label across the rep's audits.
  const byLabel = new Map<string, { total: number; max: number; calls: number }>();
  for (const audit of audits) {
    for (const c of audit) {
      if (!c.maxScore) continue;
      const entry = byLabel.get(c.label) ?? { total: 0, max: 0, calls: 0 };
      entry.total += c.score;
      entry.max += c.maxScore;
      entry.calls += 1;
      byLabel.set(c.label, entry);
    }
  }

  let weakest: { label: string; fraction: number; calls: number; scenario: PracticeScenario } | null = null;
  for (const [label, { total, max, calls }] of byLabel) {
    if (calls < MIN_SAMPLE) continue;
    const scenario = SCENARIO_FOR.find(([pattern]) => pattern.test(label))?.[1];
    if (!scenario) continue;
    const fraction = total / max;
    if (fraction < WEAK_BELOW && (!weakest || fraction < weakest.fraction)) {
      weakest = { label, fraction, calls, scenario };
    }
  }

  const topObjection = [...unaddressed.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const objectionPattern = topObjection && topObjection[1].count >= MIN_SAMPLE ? topObjection : null;

  // A recurring unhandled objection outranks a low score: it names the exact
  // conversation to rehearse, not just the phase of the call.
  if (objectionPattern && (!weakest || weakest.scenario === 'OBJECTION' || objectionPattern[1].count >= 3)) {
    const reasons = [
      `“${objectionPattern[1].name}” went unaddressed on ${objectionPattern[1].count} of your recent calls.`,
    ];
    if (weakest?.scenario === 'OBJECTION') {
      reasons.push(`${weakest.label} averaged ${Math.round(weakest.fraction * 100)}% across ${weakest.calls} audited calls.`);
    }
    return { scenario: 'OBJECTION', objectionId: objectionPattern[0], objectionName: objectionPattern[1].name, reasons };
  }

  if (weakest) {
    return {
      scenario: weakest.scenario,
      reasons: [
        `${weakest.label} averaged ${Math.round(weakest.fraction * 100)}% across ${weakest.calls} audited calls — your lowest scored area.`,
      ],
    };
  }
  return null;
}

export async function practiceRecommendation(tenantId: string, userId: string): Promise<PracticeRecommendation | null> {
  const calls = await prisma.call.findMany({
    where: { tenantId, callerId: userId, status: 'COMPLETED', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      callAudits: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { criteriaScores: true },
      },
      objectionMatches: { where: { addressed: false }, select: { objectionId: true } },
    },
  });

  const audits = calls
    .map((c) => c.callAudits[0]?.criteriaScores as unknown as CriterionScore[] | undefined)
    .filter((scores): scores is CriterionScore[] => Array.isArray(scores) && scores.length > 0);

  const counts = new Map<string, number>();
  for (const call of calls) {
    // One count per objection per call — restating it three times is one call's problem.
    for (const id of new Set(call.objectionMatches.map((m) => m.objectionId))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  // Only objections still in the live playbook: a retired entry cannot seed a drill.
  const live = counts.size
    ? await prisma.objection.findMany({
        where: { tenantId, id: { in: [...counts.keys()] }, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const unaddressed = new Map(live.map((o) => [o.id, { name: o.name, count: counts.get(o.id) ?? 0 }]));

  return weakestArea(audits, unaddressed);
}
