import SalesLink from '@/components/workspace/SalesLink';

/**
 * An empty screen is an invitation to act, never an apology. Left-aligned type
 * on the canvas — no plate, no glyph — and the copy names what the person can
 * do next in the same words the link uses.
 */
export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  /** Accepted for the callers that still pass one; nothing renders it. */
  icon?: string;
}) {
  return (
    <div className="lf-empty">
      <div className="lf-h2">{title}</div>
      {description && <p>{description}</p>}
      {actionLabel && actionHref && (
        <SalesLink className="lf-link" href={actionHref}>
          {actionLabel}
        </SalesLink>
      )}
    </div>
  );
}
