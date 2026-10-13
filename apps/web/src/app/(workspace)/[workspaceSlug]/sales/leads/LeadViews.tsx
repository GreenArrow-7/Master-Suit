'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';
import SalesLink, { useModuleBase } from '@/components/workspace/SalesLink';
import type { LeadListParams } from '@/services/leads/leadList';

/**
 * The viewer's own saved views of the lead grid (M4-19): a chip each, and Save
 * view, which keeps the grid as it stands — its filters, search, sort and
 * layout — under a name, with the columns ticked here. Only its owner lists,
 * opens or deletes a view (`/api/v1/leads/views`).
 */
export default function LeadViews({
  views,
  activeId,
  params,
  columns,
  listHref,
}: {
  views: { id: string; name: string; href: string }[];
  activeId: string | null;
  /** The grid's URL as it stands: what Save view keeps. */
  params: LeadListParams;
  /** The columns a view may show (the record's link columns always show), and which show now. */
  columns: { key: string; label: string; shown: boolean }[];
  /** The same list with no view open: where deleting the open view lands. */
  listHref: string;
}) {
  const router = useRouter();
  const base = useModuleBase();
  const id = useId();
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

  const save = (form: FormData) =>
    send(
      '/api/v1/leads/views',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: String(form.get('name') ?? ''), params, columns: form.getAll('columns') }),
      },
      (data) => data.href ?? listHref,
    );

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
        {activeId && (
          <button
            type="button"
            className="lf-chip"
            disabled={busy}
            onClick={() => void send(`/api/v1/leads/views/${activeId}`, { method: 'DELETE' }, () => listHref)}
          >
            Delete view
          </button>
        )}
        <button type="button" className="lf-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          Save view
        </button>
      </nav>
      {error && !open && (
        <p className="lf-field__error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <form
          className="lf-card lf-views__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <Field label="Name this view" htmlFor={`${id}-name`} required>
            <input
              id={`${id}-name`}
              name="name"
              className="lf-input"
              required
              maxLength={60}
              placeholder="My overdue Bayut leads"
            />
          </Field>
          <fieldset className="lf-views__columns">
            <legend className="lf-label">Columns</legend>
            {columns.map((column) => (
              <label key={column.key}>
                <input type="checkbox" name="columns" value={column.key} defaultChecked={column.shown} /> {column.label}
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="lf-field__error" role="alert">
              {error}
            </p>
          )}
          <div className="lf-views__actions">
            <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="lf-btn lf-btn--sm" disabled={busy}>
              Save view
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
