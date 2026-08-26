'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A dismissible surface: a right-hand drawer on a desktop, a bottom sheet on a
 * phone. One component so the two can never drift into different behaviours.
 *
 * Everything a dismissible surface owes the person using it is here rather than
 * re-implemented per screen: Escape closes it, the scrim closes it, focus moves
 * in on open and returns to the trigger on close, and the page behind cannot be
 * scrolled while it is up.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember what opened this, so closing returns the caret rather than
    // dropping it at the top of the document.
    restoreTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // The page behind a sheet must not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="lf-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className="lf-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="lf-sheet__head">
          <h2>{title}</h2>
          <button type="button" className="lf-sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="lf-sheet__body">{children}</div>
        {footer && <div className="lf-sheet__foot">{footer}</div>}
      </div>
    </>
  );
}
