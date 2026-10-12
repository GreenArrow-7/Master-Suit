'use client';

import { useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';
import SalesLink from '@/components/workspace/SalesLink';

type Project = { id: string; name: string };
type Listing = { id: string; reference: string; title: string };

/**
 * The projects and listings the lead asked about (M4-06). The pickers offer
 * what the viewer can see; each link opens its project or listing where the
 * viewer may.
 */
export default function InterestsCard({
  leadId,
  projects,
  listings,
  projectOptions,
  listingOptions,
  canEdit,
  opens,
}: {
  leadId: string;
  projects: Project[];
  listings: Listing[];
  /** What the picker offers: the workspace's live projects and listings, when the viewer may see them. */
  projectOptions: Project[] | null;
  listingOptions: Listing[] | null;
  canEdit: boolean;
  opens: { projects: boolean; listings: boolean };
}) {
  const { busy, run, note } = useRun();
  const [projectId, setProjectId] = useState('');
  const [listingId, setListingId] = useState('');
  const url = `/api/v1/leads/${leadId}/interests`;
  const add = (body: { projectId: string } | { listingId: string }, reset: () => void) =>
    run(async () => {
      await send(url, 'POST', body);
      reset();
    }, 'Added.');
  const remove = (query: string) => run(() => send(`${url}?${query}`, 'DELETE'), 'Removed.');

  const chip = (key: string, label: string, href: string | null, query: string) => (
    <li
      key={key}
      className="lf-chip"
      style={{ display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: '100%' }}
    >
      <span style={{ overflowWrap: 'anywhere' }}>{href ? <SalesLink href={href}>{label}</SalesLink> : label}</span>
      {canEdit && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost lf-btn--sm"
          style={{ padding: '0 4px', minHeight: 0 }}
          aria-label={`Remove ${label}`}
          disabled={busy}
          onClick={() => remove(query)}
        >
          ×
        </button>
      )}
    </li>
  );
  const freeProjects = projectOptions?.filter((p) => !projects.some((linked) => linked.id === p.id)) ?? [];
  const freeListings = listingOptions?.filter((l) => !listings.some((linked) => linked.id === l.id)) ?? [];

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }} aria-label="Interested in">
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Interested in
      </div>
      {projects.length + listings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          No projects or listings yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {projects.map((p) =>
            chip(`p-${p.id}`, p.name, opens.projects ? `/projects/${p.id}` : null, `projectId=${p.id}`),
          )}
          {listings.map((l) =>
            chip(
              `l-${l.id}`,
              `${l.reference} · ${l.title}`,
              opens.listings ? `/listings/${l.id}` : null,
              `listingId=${l.id}`,
            ),
          )}
        </ul>
      )}
      {canEdit && (projectOptions || listingOptions) && (
        <div style={{ display: 'grid', gap: 8, marginTop: 'var(--lf-space-3)' }}>
          {projectOptions && (
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (projectId) void add({ projectId }, () => setProjectId(''));
              }}
            >
              <select
                className="lf-input"
                aria-label="Add a project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={{ flex: '1 1 180px', minWidth: 0 }}
              >
                <option value="">{freeProjects.length ? 'Add a project…' : 'No other project'}</option>
                {freeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !projectId}>
                Add project
              </button>
            </form>
          )}
          {listingOptions && (
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (listingId) void add({ listingId }, () => setListingId(''));
              }}
            >
              <select
                className="lf-input"
                aria-label="Add a listing"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                style={{ flex: '1 1 180px', minWidth: 0 }}
              >
                <option value="">{freeListings.length ? 'Add a listing…' : 'No other listing'}</option>
                {freeListings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.reference} · {l.title}
                  </option>
                ))}
              </select>
              <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !listingId}>
                Add listing
              </button>
            </form>
          )}
        </div>
      )}
      {note}
    </section>
  );
}
