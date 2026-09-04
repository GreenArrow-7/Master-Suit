/**
 * Post-call lead temperature: COLD → READY_TO_ACT, with the arithmetic shown.
 *
 * Deterministic over what the analysis already extracted — the spec's rule is
 * "do not produce an unexplained score", so every point on the board is a
 * visible reason with a sign, and applying it to the lead is the agent's
 * explicit act (a LeadScoreHistory row records why), never automatic.
 */

export type LeadTemperature = 'COLD' | 'WARM' | 'HOT' | 'READY_TO_ACT';

export interface TemperatureReason {
  text: string;
  delta: number;
}

export interface TemperatureResult {
  temperature: LeadTemperature;
  /** 0–100, aligned with Lead.score. */
  score: number;
  reasons: TemperatureReason[];
}

export interface TemperatureInput {
  buyingSignals: readonly string[];
  objections: readonly string[];
  commitments: readonly string[];
  sentimentScore: number | null;
  budgetStated: boolean;
  timelineStated: boolean;
}

const COMMITMENT = /\b(viewing|visit|book|schedule|reserve|meet|appointment)\b/i;

/** The one adapter from a stored AIAnalysis row to the calculator's input. */
export function temperatureFromAnalysis(analysis: {
  buyingSignals: unknown;
  objections: unknown;
  commitments: unknown;
  sentimentScore: number | null;
  rawOutput: unknown;
}): TemperatureResult {
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const detected = (analysis.rawOutput as { detectedRequirement?: Record<string, unknown> } | null)
    ?.detectedRequirement;
  return leadTemperature({
    buyingSignals: list(analysis.buyingSignals),
    objections: list(analysis.objections),
    commitments: list(analysis.commitments),
    sentimentScore: analysis.sentimentScore,
    budgetStated: detected?.budgetMax != null || detected?.budgetMin != null,
    timelineStated: detected?.timeline != null,
  });
}

export function leadTemperature(input: TemperatureInput): TemperatureResult {
  const reasons: TemperatureReason[] = [{ text: 'Base for a completed conversation', delta: 20 }];

  const signals = Math.min(input.buyingSignals.length, 3);
  if (signals) reasons.push({ text: `${input.buyingSignals.length} buying signal(s) detected`, delta: signals * 10 });

  if (input.budgetStated) reasons.push({ text: 'Budget stated by the customer', delta: 15 });
  if (input.timelineStated) reasons.push({ text: 'Purchase timeline stated', delta: 10 });

  const committed = input.commitments.some((c) => COMMITMENT.test(c));
  if (committed) reasons.push({ text: 'A concrete next step was agreed', delta: 15 });

  if (input.sentimentScore != null && input.sentimentScore > 0.2) {
    reasons.push({ text: 'Overall sentiment positive', delta: 10 });
  } else if (input.sentimentScore != null && input.sentimentScore < -0.2) {
    reasons.push({ text: 'Overall sentiment negative', delta: -10 });
  }

  const objections = Math.min(input.objections.length, 3);
  if (objections) reasons.push({ text: `${input.objections.length} objection(s) raised`, delta: objections * -8 });

  const score = Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, r) => sum + r.delta, 0),
    ),
  );

  const temperature: LeadTemperature =
    score >= 75 && committed ? 'READY_TO_ACT' : score >= 55 ? 'HOT' : score >= 35 ? 'WARM' : 'COLD';

  return { temperature, score, reasons };
}
