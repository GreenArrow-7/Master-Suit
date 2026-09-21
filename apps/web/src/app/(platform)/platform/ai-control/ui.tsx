import type { UsageStatus } from '@/lib/ai/allowance';

/**
 * The small pieces every AI Control Center screen shares: how a status reads,
 * how a usage bar looks, and how numbers, money and times are written.
 *
 * Here rather than repeated per page so that "Warning" means the same thing and
 * looks the same on the workspace list, the user list and the user's own page.
 * A bar is drawn beside its percentage and carries the figure in its label, not
 * only in its width: a bar alone is unreadable to a screen reader and to anyone
 * who cannot distinguish the colour.
 */
export const STATUS_LABEL: Record<UsageStatus, string> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
  'limit-reached': 'Limit reached',
  disabled: 'AI disabled',
  'no-limit': 'No limit',
};

export const STATUS_TONE: Record<UsageStatus, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  normal: 'viridian',
  warning: 'brass',
  critical: 'vermillion',
  'limit-reached': 'vermillion',
  disabled: 'slate',
  'no-limit': 'slate',
};

const numberFormat = new Intl.NumberFormat('en-GB');
export const nf = (n: number) => numberFormat.format(n);
export const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

/** "3 minutes ago", or the date once it is old enough for a date to be clearer. */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))} days ago`;
  return then.toLocaleDateString('en-GB');
}

export function UsageBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="lf-muted">no limit</span>;
  const width = Math.min(100, Math.max(0, percent));
  const tone = percent >= 100 ? 'vermillion' : percent >= 85 ? 'brass' : 'viridian';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span
        aria-hidden
        style={{
          flex: '0 0 64px',
          height: 6,
          borderRadius: 3,
          background: 'var(--lf-surface-2)',
          overflow: 'hidden',
        }}
      >
        <span style={{ display: 'block', width: `${width}%`, height: '100%', background: `var(--lf-${tone})` }} />
      </span>
      <span className="lf-num">{percent}%</span>
    </span>
  );
}

/** Where an allowance came from, in words an operator would use. */
export const SOURCE_LABEL: Record<string, string> = {
  user: 'set for this person',
  workspace: 'workspace default',
  plan: 'plan default',
  platform: 'platform default',
  'plan-limit': 'plan limit',
  none: 'nobody has set one',
};
