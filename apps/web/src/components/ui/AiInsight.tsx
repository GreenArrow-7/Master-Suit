import type { ReactNode } from 'react';

/**
 * The wrapper for anything a model produced.
 *
 * It exists so the question "is this observed or inferred?" has one answer in
 * one place. Screens were labelling model output ad hoc — an italic grey
 * sentence here, a bordered box there, nothing at all on the third — which
 * means a person cannot learn the signal, and a signal nobody learns is
 * decoration.
 *
 * Deliberately thin: a label, an optional confidence read-out, and a cyan
 * hairline down the left edge. The content inside renders on the page's own
 * surface, at the page's own contrast, because a recommendation is only useful
 * if it is as readable as the data it is about.
 */
export default function AiInsight({
  label = 'AI insight',
  confidence,
  action,
  children,
}: {
  /** AI INSIGHT, NEXT BEST ACTION, RISK DETECTED, BUYING SIGNAL… */
  label?: string;
  /** 0–1. Omit when the model does not report one — do not invent a number. */
  confidence?: number;
  /** The one thing to do about it, if there is one. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="lf-ai-surface">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', flexWrap: 'wrap' }}>
        <span className="lf-ai-label">{label}</span>
        {confidence !== undefined && <Confidence value={confidence} />}
      </div>
      <div style={{ marginTop: 'var(--lf-space-2)' }}>{children}</div>
      {action && <div style={{ marginTop: 'var(--lf-space-3)' }}>{action}</div>}
    </section>
  );
}

/**
 * Clamped rather than trusted: the value comes from a model response, and a
 * bar drawn at 240% is a rendering bug reported as confidence.
 */
function Confidence({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span
      className="lf-ai-confidence"
      data-level={pct < 60 ? 'low' : 'ok'}
      title={`Model confidence: ${pct}%`}
      aria-label={`Model confidence ${pct} percent`}
    >
      <span className="lf-ai-confidence__bar">
        <span className="lf-ai-confidence__fill" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
