import type { Tone } from './Badge';
import SalesLink from '@/components/workspace/SalesLink';

const COLOR: Record<Tone, string> = {
  slate: 'var(--lf-ink)',
  wine: 'var(--lf-wine-700)',
  brass: 'var(--lf-brass)',
  viridian: 'var(--lf-viridian)',
  vermillion: 'var(--lf-vermillion)',
};

export interface MetricCardProps {
  label: string;
  value: number | string;
  tone?: Tone;
  delta?: { value: number; label: string };
  href?: string;
}

/**
 * The only place besides the wordmark where the display serif appears. These four
 * numbers are what a manager reads first each morning; making them typographically
 * distinct from every other figure in the product is functional, not decorative.
 */
export default function MetricCard({ label, value, tone = 'slate', delta, href }: MetricCardProps) {
  const body = (
    <>
      <div className="lf-eyebrow">{label}</div>
      <div className="lf-hero-figure" style={{ color: COLOR[tone], marginTop: 6 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {delta && (
        <div style={{ marginTop: 6, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          <span
            className="lf-num"
            style={{ color: delta.value >= 0 ? 'var(--lf-viridian)' : 'var(--lf-vermillion)', fontWeight: 600 }}
          >
            {delta.value >= 0 ? '↑' : '↓'} {Math.abs(delta.value)}%
          </span>{' '}
          {delta.label}
        </div>
      )}
    </>
  );

  const style: React.CSSProperties = {
    padding: 'var(--lf-space-5)',
    display: 'block',
    textDecoration: 'none',
    color: 'inherit',
  };

  return href ? (
    <SalesLink className="lf-card" style={style} href={href}>
      {body}
    </SalesLink>
  ) : (
    <div className="lf-card" style={style}>
      {body}
    </div>
  );
}
