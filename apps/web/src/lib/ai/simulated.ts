import type { AnalysisInput, AnalysisResult, DetectedRequirement } from './analysis';
import type { AuditInput, AuditResult, CriterionScore } from './audit';
import { parseTranscript, type TranscriptLine as Line } from './callMetrics';

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

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "1.5 million", "1.5m", "one point five million", "800k" → a number. */
export function parseAmounts(text: string): number[] {
  const amounts: number[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*(million|mil\b|m\b|k\b)/g)) {
    amounts.push(parseFloat(m[1]) * (m[2].startsWith('k') ? 1_000 : 1_000_000));
  }
  for (const m of lower.matchAll(/\b(\w+)(?:\s+point\s+(\w+))?\s+million/g)) {
    const whole = WORD_NUM[m[1]];
    if (whole == null) continue;
    const frac = m[2] ? WORD_NUM[m[2]] : undefined;
    amounts.push((whole + (frac ?? 0) / 10) * 1_000_000);
  }
  // "one point five million, maybe stretching to one point eight" — the second
  // number elides the unit. Once a million-scale amount anchors the sentence,
  // a bare "N point M" is read at the same scale.
  if (amounts.some((a) => a >= 1_000_000)) {
    for (const m of lower.matchAll(/\b(\w+)\s+point\s+(\w+)\b(?!\s*(?:million|mil\b|m\b|k\b|percent|%))/g)) {
      const whole = WORD_NUM[m[1]];
      const frac = WORD_NUM[m[2]];
      if (whole != null && frac != null) amounts.push((whole + frac / 10) * 1_000_000);
    }
  }
  return amounts;
}

/**
 * Keyword requirement extraction for the demo path. Only what the transcript
 * literally contains; anything else stays null for the agent to fill in.
 */
export function extractRequirement(transcript: string): DetectedRequirement | null {
  // Budget comes from the customer's own lines where the transcript attributes
  // speakers — a price the agent quoted is not the customer's budget.
  const lines = parseTranscript(transcript);
  const attributed = lines.some((l) => l.side !== 'UNKNOWN');
  const customerText = attributed
    ? lines
        .filter((l) => l.side === 'OTHER')
        .map((l) => l.text)
        .join('\n')
    : transcript;
  const lower = customerText.toLowerCase();

  const amounts = parseAmounts(customerText).filter((a) => a >= 50_000);
  const bedrooms: number[] = [];
  for (const m of lower.matchAll(/(\d+|one|two|three|four|five|six)([- ]or[- ](\d+|one|two|three|four|five|six))?[- ]?(?:br\b|bed(?:room)?s?)/g)) {
    for (const raw of [m[1], m[3]]) {
      if (!raw) continue;
      const n = WORD_NUM[raw] ?? parseInt(raw, 10);
      if (!Number.isNaN(n) && n > 0 && n <= 20) bedrooms.push(n);
    }
  }

  const purpose = /\b(rent|renting|lease)\b/.test(lower) && !/\brental (yield|income)/.test(lower) ? 'RENT' : /\b(buy|purchas|invest|to live in|own use)/.test(lower) ? 'BUY' : null;
  const typeHit = ['PENTHOUSE', 'TOWNHOUSE', 'APARTMENT', 'VILLA', 'PLOT', 'OFFICE'].find((t) =>
    lower.includes(t.toLowerCase()),
  );
  const timeline = lower.match(
    /\b(?:by|before|within|next)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|month|year|week|\d+\s+(?:days?|weeks?|months?|years?))\b/,
  );

  // The first customer line an extraction actually hit — the provenance quote.
  const evidence =
    lines.find(
      (l) =>
        (!attributed || l.side === 'OTHER') &&
        (parseAmounts(l.text).length > 0 || /(\d+|one|two|three|four|five|six)[- ]?(?:br\b|bed)/i.test(l.lower)),
    )?.text ?? null;

  const detected: DetectedRequirement = {
    purpose,
    budgetMin: amounts.length > 1 ? Math.min(...amounts) : null,
    budgetMax: amounts.length ? Math.max(...amounts) : null,
    bedroomsMin: bedrooms.length ? Math.min(...bedrooms) : null,
    bedroomsMax: bedrooms.length ? Math.max(...bedrooms) : null,
    propertyType: typeHit ?? null,
    locations: [],
    timeline: timeline ? timeline[0] : null,
    // A keyword pass is honest about being one.
    confidence: 0.4,
    evidence: evidence ? evidence.slice(0, 300) : null,
  };
  // Judged on the fact fields only — confidence/evidence are metadata and must
  // not make an empty extraction look like a finding.
  const { confidence: _c, evidence: _e, ...facts } = detected;
  const anything = Object.values(facts).some((v) => (Array.isArray(v) ? v.length : v != null));
  return anything ? detected : null;
}

export function simulateAnalysis(input: AnalysisInput): AnalysisResult {
  const lines = parseTranscript(input.transcript);
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
    // The rep's own commitments, not the client's: a simulated action item that
    // puts the client's words in the rep's task list is worse than an empty list.
    actionItems: pick(
      lines.filter((l) => l.side !== 'OTHER'),
      SIGNALS.commitment,
      3,
    ),
    topicsDiscussed,
    topicsMissed,
    sentiment,
    sentimentScore,
    suggestedStatus: buyingSignals.length > objections.length ? 'INTERESTED' : null,
    complianceFlags,
    uncertainItems: ['This is a keyword-based simulation, not a model analysis. Verify findings against the call.'],
    detectedRequirement: extractRequirement(input.transcript),
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
  const lines = parseTranscript(input.transcript);

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
