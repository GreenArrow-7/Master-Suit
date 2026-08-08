export function Skeleton({ w = '100%', h = 12, r }: { w?: number | string; h?: number; r?: number }) {
  return <div className="lf-skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

/** Matches the real grid's row height and column widths, so the layout does not
 *  jump when data arrives. A skeleton that shifts is worse than a spinner. */
export function GridSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="lf-grid-wrap" aria-busy="true" aria-live="polite">
      <div style={{ height: 36, background: 'var(--lf-surface-2)', borderBottom: '1px solid var(--lf-line)' }} />
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `2fr ${'1fr '.repeat(cols - 1)}`,
            gap: 'var(--lf-space-4)',
            alignItems: 'center',
            height: 'var(--lf-row)',
            padding: '0 var(--lf-space-3)',
            borderBottom: '1px solid var(--lf-line)',
          }}
        >
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} h={10} w={c === 0 ? '70%' : `${40 + ((r * 7 + c * 13) % 40)}%`} />
          ))}
        </div>
      ))}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>Loading records</span>
    </div>
  );
}
