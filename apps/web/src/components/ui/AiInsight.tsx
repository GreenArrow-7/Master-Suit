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
 * Deliberately thin: a label and a cyan hairline down the left edge. The content inside renders on the page's own
 * surface, at the page's own contrast, because a recommendation is only useful
 * if it is as readable as the data it is about.
 */
export default function AiInsight({
  label = 'AI insight',
  action,
  children,
}: {
  /** AI INSIGHT, NEXT BEST ACTION, RISK DETECTED, BUYING SIGNAL… */
  label?: string;
  /** The one thing to do about it, if there is one. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="lf-ai-surface">
      {/* A flex row, so the inline-flex label sits on no line box of its own. */}
      <div style={{ display: 'flex' }}>
        <span className="lf-ai-label">{label}</span>
      </div>
      <div style={{ marginTop: 'var(--lf-space-2)' }}>{children}</div>
      {action && <div style={{ marginTop: 'var(--lf-space-3)' }}>{action}</div>}
    </section>
  );
}
