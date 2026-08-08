/**
 * The shape of a page while its data is in flight.
 *
 * Every screen in this application is a Server Component that awaits Postgres
 * before it renders anything, and there was no loading.tsx anywhere — so a slow
 * query left the previous page on screen with no indication that a navigation
 * had even been accepted. People click again, and the second click is the one
 * that creates the duplicate record.
 *
 * Deliberately blocky rather than an exact replica of any one page: a skeleton
 * that promises a layout it does not deliver is its own kind of lie.
 */
export default function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="lf-page-stack" aria-busy="true" aria-live="polite">
      <span className="sr-only" style={SR_ONLY}>
        Loading
      </span>
      <div style={{ ...BLOCK, width: 180, height: 12 }} />
      <div style={{ ...BLOCK, width: 320, height: 26 }} />
      <div className="lf-table-wrap" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 10 }}>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} style={{ ...BLOCK, height: 14, width: `${92 - index * 6}%` }} />
        ))}
      </div>
    </div>
  );
}

const BLOCK: React.CSSProperties = {
  borderRadius: 'var(--lf-radius-sm)',
  background: 'var(--lf-surface-2, #f1f5f9)',
  // No animation: `prefers-reduced-motion` would have to switch it off again,
  // and a static block already says "not ready yet".
};

const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
