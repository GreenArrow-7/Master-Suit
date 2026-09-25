import type { ReactNode } from 'react';
import { ASSISTANT_NAME } from '@/lib/branding';

/**
 * The wrapper for anything a model produced.
 *
 * It exists so the question "is this observed or inferred?" has one answer in
 * one place. Screens were labelling model output ad hoc — an italic grey
 * sentence here, a bordered box there, nothing at all on the third — which
 * means a person cannot learn the signal, and a signal nobody learns is
 * decoration.
 *
 * Deliberately thin: a violet label, a 2px violet rule down the left edge, and
 * an optional low-confidence line. The content inside renders on the page's
 * own surface, at the page's own contrast, because a recommendation is only
 * useful if it is as readable as the data it is about.
 */
export default function AiInsight({
  label = ASSISTANT_NAME,
  confidence,
  action,
  children,
}: {
  /** Sentence case: "Next best action", "Risk detected", "Buying signal"… */
  label?: string;
  /** 0–1. Omit when the model does not report one — do not invent a number. */
  confidence?: number;
  /** The one thing to do about it, if there is one — a text link, not a button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="lf-ai-surface">
      <span className="lf-ai-label">{label}</span>
      <div className="lf-ai-surface__body">{children}</div>
      {confidence !== undefined && <Confidence value={confidence} />}
      {action && <div className="lf-ai-actionlink">{action}</div>}
    </section>
  );
}

/**
 * Clamped rather than trusted: the value comes from a model response, and a
 * figure of 240% is a rendering bug reported as confidence. Nothing renders at
 * or above 60%; below it, one line says so in words.
 */
function Confidence({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  if (pct >= 60) return null;
  return (
    <p className="lf-ai-confidence--low" title={`Model confidence: ${pct}%`}>
      Low confidence — verify before acting
    </p>
  );
}
