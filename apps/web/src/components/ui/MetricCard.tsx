import type { Tone } from './Badge';
import SalesLink from '@/components/workspace/SalesLink';

export interface MetricCardProps {
  label: string;
  value: number | string;
  /** Set small and muted before the figure: a currency code. */
  unit?: string;
  /** Set at the mid size after the figure: a compact-notation letter or a percent sign. */
  suffix?: string;
  /** "of N", set at the mid size after a slash. */
  denominator?: number | string;
  /** Semantic ink on the figure. The label carries the meaning; the ink adds urgency. */
  tone?: Tone;
  href?: string;
}

/**
 * One large figure on the metric rule — 28→32px/600 Inter tabular, the same
 * family as the dashboard's .lf-kpi. The unit/suffix/denominator spans are what
 * turn "AED 21.3M" from a digit wall into a set figure.
 *
 * No delta slot: nothing in the product computes a comparison window, and a
 * trend with no data behind it is a fabrication, not a style.
 */
export default function MetricCard({ label, value, unit, suffix, denominator, tone, href }: MetricCardProps) {
  const body = (
    <>
      <span className="lf-metric-card__label">{label}</span>
      <span className="lf-metric-card__value" data-tone={tone}>
        {unit && <span className="lf-figure__unit">{unit}</span>}
        {typeof value === 'number' ? value.toLocaleString('en-AE') : value}
        {suffix && <span className="lf-figure__suffix">{suffix}</span>}
        {denominator !== undefined && (
          <span className="lf-figure__denom">
            <span className="lf-figure__slash">/</span>
            {denominator}
          </span>
        )}
      </span>
    </>
  );

  return href ? (
    <SalesLink className="lf-metric-card" href={href}>
      {body}
    </SalesLink>
  ) : (
    <div className="lf-metric-card">{body}</div>
  );
}
