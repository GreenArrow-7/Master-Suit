import type { AnalysisInput, AnalysisResult } from './analysis';
import type { AuditInput, AuditResult, CriterionScore } from './audit';

/**
 * Deterministic keyword-driven stand-ins for the Gemini calls, used when no
 * GEMINI_API_KEY is configured. Every result is stamped `demo-simulation` in
 * modelId so a simulated verdict can never be mistaken for a model's. The
 * heuristics are honest about being heuristics: they extract lines that
 * literally contain the signal words, and flag themselves in uncertainItems.
 */
export const SIMULATED_MODEL_ID = 'demo-simulation';

const SIGNALS = {
  objection: [
    'expensive',
    'too much',
    'too high',
    'not sure',
    'think about it',
    'concern',
    'worried',
    'over budget',
    'cheaper',
    'compare',
    'competitor',
    'not interested',
  ],
  commitment: ['i will', "i'll", 'we will', "we'll", 'send you', 'book', 'schedule', 'confirm', 'arrange'],
  buying: [
    'interested',
    'sounds good',
    'when can',
    'how much',
    'payment plan',
    'viewing',
    'site visit',
    'brochure',
    'floor plan',
    'reserve',
  ],
  need: ['looking for', 'need', 'want', 'bedroom', 'budget', 'location', 'school', 'family', 'investment'],
  positive: ['great', 'perfect', 'thanks', 'thank you', 'good', 'interested', 'love', 'excellent', 'yes'],
  negative: ['no', 'not', "can't", 'cannot', 'problem', 'issue', 'unhappy', 'bad', 'expensive'],
} as const;

interface Line {
  speaker: string;
  text: string;
  lower: string;
}

function parseLines(transcript: string): Line[] {
  return transcript
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(?:\[[\d:.]+\]\s*)?([A-Za-z ][A-Za-z .-]{0,30}):\s*(.+)$/);
      if (match) return { speaker: match[1].trim(), text: match[2], lower: match[2].toLowerCase() };
      return { speaker: '', text: raw, lower: raw.toLowerCase() };
    });
}

const pick = (lines: Line[], words: readonly string[], limit = 4): string[] => {
  const hits: string[] = [];
  for (const line of lines) {
    if (words.some((w) => line.lower.includes(w))) {
      hits.push(line.text.length > 140 ? `${line.text.slice(0, 137)}…` : line.text);
      if (hits.length >= limit) break;
    }
  }
  return hits;
};

const count = (lines: Line[], words: readonly string[]): number =>
  lines.reduce((total, line) => total + (words.some((w) => line.lower.includes(w)) ? 1 : 0), 0);

export function simulateAnalysis(input: AnalysisInput): AnalysisResult {
  const lines = parseLines(input.transcript);
  const objections = pick(lines, SIGNALS.objection);
  const commitments = pick(lines, SIGNALS.commitment);
  const buyingSignals = pick(lines, SIGNALS.buying);
  const clientNeeds = pick(lines, SIGNALS.need);

  const positives = count(lines, SIGNALS.positive);
  const negatives = count(lines, SIGNALS.negative);
  const total = Math.max(1, positives + negatives);
  const sentimentScore = Math.round(((positives - negatives) / total) * 100) / 100;
  const sentiment = sentimentScore > 0.2 ? 'POSITIVE' : sentimentScore < -0.2 ? 'NEGATIVE' : 'NEUTRAL';

  const talkingPoints = input.talkingPoints ?? [];
  const textLower = input.transcript.toLowerCase();
  const topicsDiscussed = talkingPoints
    .filter((tp) => textLower.includes(tp.label.toLowerCase()))
    .map((tp) => tp.label);
  const topicsMissed = talkingPoints
    .filter((tp) => tp.isRequired && !textLower.includes(tp.label.toLowerCase()))
    .map((tp) => tp.label);

  const complianceFlags: string[] = [];
  if (!/record/i.test(input.transcript)) complianceFlags.push('No recording disclosure detected in transcript.');

  return {
    summary:
      `Simulated analysis of a ${lines.length}-line ${input.callDirection?.toLowerCase() ?? ''} call` +
      `${input.campaignName ? ` for campaign "${input.campaignName}"` : ''}. ` +
      `Detected ${objections.length} objection(s), ${buyingSignals.length} buying signal(s) and ` +
      `${commitments.length} commitment(s); overall sentiment reads ${sentiment.toLowerCase()}. ` +
      'Generated without an AI provider — connect GEMINI_API_KEY for model-based analysis.',
    clientNeeds,
    objections,
    commitments,
    buyingSignals,
    risks: objections.slice(0, 2),
    nextSteps: commitments.length ? commitments : ['Follow up with the client on the discussed points.'],
    topicsDiscussed,
    topicsMissed,
    sentiment,
    sentimentScore,
    suggestedStatus: buyingSignals.length > objections.length ? 'INTERESTED' : null,
    complianceFlags,
    uncertainItems: ['This is a keyword-based simulation, not a model analysis. Verify findings against the call.'],
  };
}

/** Keyword sets for the standard scorecard criteria, matched by label substring. */
const CRITERION_SIGNALS: [pattern: RegExp, words: readonly string[]][] = [
  [/greet/i, ['hello', 'hi ', 'good morning', 'good afternoon', 'welcome', 'salaam']],
  [/introduc/i, ['my name', 'calling from', 'this is', 'speaking']],
  [/discover|needs?/i, SIGNALS.need],
  [/product|explan|present/i, ['project', 'property', 'unit', 'amenities', 'payment plan', 'handover', 'developer']],
  [/objection/i, SIGNALS.objection],
  [/clarity|communicat/i, ['let me explain', 'to clarify', 'in other words', 'does that make sense']],
  [/professional/i, ['please', 'thank you', 'appreciate', 'certainly', 'of course']],
  [/compliance|consent|disclos/i, ['recorded', 'consent', 'terms', 'regulation']],
  [/clos|follow.?up|confirm/i, ['next step', 'follow up', 'schedule', 'book', 'confirm', 'send you']],
];

export function simulateAudit(input: AuditInput): AuditResult {
  const lines = parseLines(input.transcript);

  const criteriaScores: CriterionScore[] = input.criteria.map((criterion) => {
    const signal = CRITERION_SIGNALS.find(([pattern]) => pattern.test(criterion.label));
    const evidence = signal ? pick(lines, signal[1], 1) : [];
    const met = evidence.length > 0;
    // Met criteria score full weight; unmet required ones score zero, unmet
    // optional ones get partial credit for ambiguity.
    const score = met ? criterion.weight : criterion.isRequired ? 0 : Math.round(criterion.weight * 0.4);
    return {
      label: criterion.label,
      score,
      maxScore: criterion.weight,
      met,
      evidence: evidence[0] ?? 'Not detected in transcript (simulated check).',
    };
  });

  const overallScore = criteriaScores.reduce((sum, c) => sum + c.score, 0);
  const maxScore = criteriaScores.reduce((sum, c) => sum + c.maxScore, 0);
  const missed = criteriaScores.filter((c) => !c.met);

  return {
    criteriaScores,
    missedPoints: missed.map((c) => c.label),
    strengths: criteriaScores.filter((c) => c.met).map((c) => c.label),
    risks: pick(lines, SIGNALS.objection, 2),
    suggestions: missed.map((c) => `Address "${c.label}" explicitly on the next call.`),
    nextAction: missed.length ? `Coach on: ${missed[0].label}.` : 'Maintain current call structure.',
    overallScore,
    maxScore,
  };
}
