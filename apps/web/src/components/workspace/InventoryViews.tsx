'use client';

import { useId, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SalesLink, { useModuleBase } from '@/components/workspace/SalesLink';

/**
 * The viewer's own saved views of the project catalogue or the listing book
 * (M11-08, M12-05): a chip each, Save view, which keeps the filters as they
 * stand under a name, and Delete view for the one open.
 */
export default function InventoryViews({
  endpoint,
  listPath,
  views,
}: {
  /** `/api/v1/projects/views` or `/api/v1/listings/views`. */
  endpoint: string;
  /** The list with no view open, module-relative: where deleting the open view lands. */
  listPath: string;
  views: { id: string; name: string; href: string }[];
}) {
  const router = useRouter();
  const base = useModuleBase();
  const params = useSearchParams();
  const id = useId();
  const activeId = params.get('saved');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit, then: (data: { href?: string }) => string) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(typeof data.detail === 'string' ? data.detail : 'Could not reach the server.');
      return;
    }
    setOpen(false);
    router.push(`${base}${then(data)}`);
  }

  return (
    <div className="lf-views">
      <nav className="lf-chips" aria-label="My views">
        {views.map((view) => (
          <SalesLink
            key={view.id}
            className="lf-chip"
            href={view.href}
            aria-current={view.id === activeId ? 'page' : undefined}
          >
            {view.name}
          </SalesLink>
        ))}
        {activeId && views.some((v) => v.id === activeId) && (
          <button
            type="button"
            className="lf-chip"
            disabled={busy}
            onClick={() => void send(`${endpoint}?viewId=${activeId}`, { method: 'DELETE' }, () => listPath)}
          >
            Delete view
          </button>
        )}
        <button type="button" className="lf-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          Save view
        </button>
      </nav>
      {error && (
        <p className="lf-field__error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <form
          className="lf-card lf-views__form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get('name') ?? '');
            const filters = Object.fromEntries(
              [...params.entries()].filter(([key]) => key !== 'saved' && key !== 'page'),
            );
            void send(
              endpoint,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name, params: filters }),
              },
              (data) => data.href ?? listPath,
            );
          }}
        >
          <label className="lf-field" htmlFor={`${id}-name`}>
            <span className="lf-label" data-required="">
              Name this view
            </span>
            <input id={`${id}-name`} name="name" className="lf-input" required maxLength={60} />
          </label>
          <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </div>
  );
}
