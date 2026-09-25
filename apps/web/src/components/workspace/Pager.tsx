import SalesLink from '@/components/workspace/SalesLink';

/**
 * Prev/next pagination over `?page=N`, preserving the rest of the query string.
 * Server-rendered; pages fetch `take + 1` rows and pass `hasMore`, so a count
 * query is optional — with one, the status can say "Page 3 of 26".
 */
export default function Pager({
  page,
  hasMore,
  totalPages,
  basePath,
  params,
}: {
  page: number;
  hasMore: boolean;
  totalPages?: number;
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
    <nav className="lf-pager" aria-label="Pagination">
      {page > 1 && (
        <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={href(page - 1)}>
          &larr; Previous
        </SalesLink>
      )}
      <span className="lf-pager__status">
        Page {page}
        {totalPages ? ` of ${totalPages.toLocaleString('en-GB')}` : ''}
      </span>
      {hasMore && (
        <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={href(page + 1)}>
          Next &rarr;
        </SalesLink>
      )}
    </nav>
  );
}
