'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Filters: a toolbar on a desktop, a bottom sheet on a phone.
 *
 * A filter bar is five to ten controls. On a desktop that is a row; on a phone
 * it is a screenful of dropdowns stacked above the list they filter, so the
 * results get pushed off-screen by the controls that produce them.
 *
 * The fields are rendered once and never unmounted — only repositioned by CSS.
 * That matters more than it looks: these live inside a `<form method="get">`,
 * and unmounting them when the sheet closes would drop their values from the
 * submission. Hidden fields still submit; absent ones do not.
 */
export default function FilterSheet({
  children,
  label = 'Filters',
  /** Shown on the trigger when filters are applied, so the state is visible while collapsed. */
  activeCount,
}: {
  children: ReactNode;
  label?: string;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm lf-filter-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {label}
        {activeCount ? ` · ${activeCount}` : ''}
      </button>

      {open && <div className="lf-sheet__scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="lf-filterbox" data-open={open || undefined}>
        <div className="lf-filterbox__head">
          <h2>{label}</h2>
          <button
            type="button"
            className="lf-sheet__close"
            onClick={() => setOpen(false)}
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>
        <div className="lf-filterbox__body">{children}</div>
      </div>
    </>
  );
}
