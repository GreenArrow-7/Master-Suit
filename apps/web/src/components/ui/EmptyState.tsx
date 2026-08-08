import SalesLink from '@/components/workspace/SalesLink';

/**
 * An empty screen is an invitation to act, never an apology. The copy names what
 * the person can do next in the same words the button uses.
 */
export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  icon = '◇',
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: string;
}) {
  return (
    <div className="lf-empty">
      <div className="lf-empty__mark" aria-hidden="true">
        {icon}
      </div>
      <div className="lf-h2">{title}</div>
      {description && (
        <p style={{ margin: '6px auto 0', maxWidth: 380, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          {description}
        </p>
      )}
      {actionLabel && actionHref && (
        <SalesLink className="lf-btn" href={actionHref} style={{ marginTop: 'var(--lf-space-5)' }}>
          {actionLabel}
        </SalesLink>
      )}
    </div>
  );
}
