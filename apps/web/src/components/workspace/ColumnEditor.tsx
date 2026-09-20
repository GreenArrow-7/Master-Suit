'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { GRID_COLUMNS, type GridObject } from '@/lib/grid/columns';

/**
 * Lets an administrator choose which columns a list grid shows, and in what order.
 * Fixed columns are listed but locked — removing the reference or the name would
 * leave a row with no way through to its record.
 *
 * Desktop: a popover under the button, kept inside the viewport. Phone: a bottom
 * sheet with a heading, a close control, a scrolling list and reachable actions —
 * the popover used to open at x = −219 behind the left edge of the screen and run
 * past the bottom of it. Opening it closes the ••• menu it lives in, the page
 * behind stops scrolling, Escape closes it, and focus returns to the button.
 */
export default function ColumnEditor({ object, current }: { object: GridObject; current: string[] }) {
  const catalogue = GRID_COLUMNS[object];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(current.filter((key) => !catalogue.find((c) => c.key === key)?.fixed));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  // Desktop popover position, measured from the button so the panel can live in a
  // portal: rendered in place it inherits whatever containing block an ancestor's
  // `contain: paint` or transform creates, and on Leads that clipped it to 46px.
  const [place, setPlace] = useState<CSSProperties>({});

  const fixed = catalogue.filter((column) => column.fixed);
  const optional = catalogue.filter((column) => !column.fixed);
  const label = (key: string) => catalogue.find((column) => column.key === key)?.label ?? key;

  function measure() {
    const at = trigger.current?.getBoundingClientRect();
    if (!at || window.innerWidth <= 760) return setPlace({});
    const width = Math.min(320, window.innerWidth - 32);
    const left = Math.max(16, Math.min(at.right - width, window.innerWidth - width - 16));
    setPlace({ top: at.bottom + 6, left });
  }
  function show() {
    // The button usually sits inside the ••• disclosure; a child panel opening
    // over a still-open parent menu is two overlays fighting for the same thumb.
    trigger.current?.closest('details[open]')?.removeAttribute('open');
    measure();
    setOpen(true);
  }
  // Focus goes back to the button, or — when the button lives in a ••• menu that
  // closed as the sheet opened — to that menu's summary, so keyboard users are
  // never dropped on a hidden control.
  function refocus() {
    const button = trigger.current;
    if (!button) return;
    // A closed <details> keeps its children laid out (offsetParent is set) but
    // not visible, so ask the menu, not the box model.
    const menu = button.closest('details');
    if (menu && !menu.open) return menu.querySelector<HTMLElement>('summary')?.focus();
    button.focus();
  }
  const returnFocus = useRef(false);
  function hide() {
    returnFocus.current = true;
    setOpen(false);
  }
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    // After the portal has unmounted: focusing while the sheet is still in the
    // DOM lets the browser drop focus to <body> when the focused close button
    // goes away a moment later.
    const frame = requestAnimationFrame(refocus);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      document.body.style.overflow = previous;
    };
  }, [open]);

  function toggle(key: string) {
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function move(key: string, delta: number) {
    setChosen((prev) => {
      const index = prev.indexOf(key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/admin/grid-columns', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object, columns: chosen }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? data.title ?? 'Could not save columns');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const row = (key: string, children: ReactNode, muted = false) => (
    <li key={key} className="lf-colmenu__row" data-muted={muted || undefined}>
      {children}
    </li>
  );

  return (
    <span className="lf-colmenu__anchor">
      <button
        ref={trigger}
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        onClick={() => (open ? hide() : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Columns
      </button>
      {open &&
        createPortal(
          <>
            <div className="lf-colmenu__scrim" onClick={hide} aria-hidden="true" />
            <div className="lf-colmenu" role="dialog" aria-modal="true" aria-labelledby={headingId} style={place}>
              <div className="lf-colmenu__head">
                <strong id={headingId}>Grid columns</strong>
                <button
                  ref={closeButton}
                  type="button"
                  className="lf-sheet__close"
                  onClick={hide}
                  aria-label="Close column editor"
                >
                  ✕
                </button>
              </div>

              <ul className="lf-colmenu__list">
                {fixed.map((column) =>
                  row(
                    column.key,
                    <>
                      <input type="checkbox" checked disabled aria-label={`${column.label} is always shown`} />
                      {column.label}
                      <span className="lf-colmenu__note">always</span>
                    </>,
                    true,
                  ),
                )}

                {chosen.map((key, index) =>
                  row(
                    key,
                    <>
                      <input type="checkbox" checked onChange={() => toggle(key)} aria-label={`Hide ${label(key)}`} />
                      {label(key)}
                      <span className="lf-colmenu__move">
                        <button
                          type="button"
                          className="lf-btn lf-btn--ghost lf-btn--icon"
                          onClick={() => move(key, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${label(key)} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="lf-btn lf-btn--ghost lf-btn--icon"
                          onClick={() => move(key, 1)}
                          disabled={index === chosen.length - 1}
                          aria-label={`Move ${label(key)} down`}
                        >
                          ↓
                        </button>
                      </span>
                    </>,
                  ),
                )}

                {optional
                  .filter((column) => !chosen.includes(column.key))
                  .map((column) =>
                    row(
                      column.key,
                      <>
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggle(column.key)}
                          aria-label={`Show ${column.label}`}
                        />
                        {column.label}
                      </>,
                      true,
                    ),
                  )}
              </ul>

              {error && (
                <p className="lf-colmenu__error" role="alert">
                  {error}
                </p>
              )}

              <div className="lf-colmenu__actions">
                <button type="button" className="lf-btn lf-btn--sm" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save for workspace'}
                </button>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--secondary"
                  onClick={() => setChosen([])}
                  disabled={busy}
                >
                  Reset to default
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </span>
  );
}
