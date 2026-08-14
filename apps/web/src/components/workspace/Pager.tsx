import SalesLink from '@/components/workspace/SalesLink';

/**
 * Prev/next pagination over `?page=N`, preserving the rest of the query string.
 * Server-rendered; pages fetch `take + 1` rows and pass `hasMore` so no count
 * query is needed.
 */
export default function Pager({
  page,
  hasMore,
  basePath,
  params,
}: {
  page: number;
  hasMore: boolean;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (page <= 1 && !hasMore) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set('page', String(target));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--lf-space-3)',
        justifyContent: 'flex-end',
        marginTop: 'var(--lf-space-4)',
      }}
    >
      {page > 1 ? (
        <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={href(page - 1)}>
          &larr; Previous
        </SalesLink>
      ) : (
        <span />
      )}
      <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>Page {page}</span>
      {hasMore && (
        <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={href(page + 1)}>
          Next &rarr;
        </SalesLink>
      )}
    </nav>
  );
}
