import type { ReactNode } from 'react';

/**
 * A page heading for phone screens: eyebrow, h1, at most one sentence, and the
 * long explanation folded into a native <details> so it is there when wanted
 * and out of the way when not. Decision-point warnings (consent, approval
 * rules, destructive actions) do NOT belong in `help` — keep those visible
 * next to the control they govern.
 */
export default function PageIntro({
  title,
  summary,
  help,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  summary?: string;
  help?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="lf-page-intro">
      <div className="lf-page-intro__copy">
        {eyebrow && <div className="lf-eyebrow">{eyebrow}</div>}
        <h1 className="lf-page-intro__title">{title}</h1>
        {summary && <p className="lf-page-intro__summary">{summary}</p>}
        {help && (
          <details className="lf-help">
            <summary>How this works</summary>
            <div className="lf-help__body">{help}</div>
          </details>
        )}
      </div>
      {actions && <div className="lf-page-intro__actions">{actions}</div>}
    </header>
  );
}
