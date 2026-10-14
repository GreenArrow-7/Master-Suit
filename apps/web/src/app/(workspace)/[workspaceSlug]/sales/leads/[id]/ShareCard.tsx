'use client';

import { useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';

export interface LeadShareRow {
  id: string;
  title: string;
  kind: 'listing' | 'project';
  url: string;
  views: number;
  /** On the workspace's clock. */
  lastViewed: string | null;
  until: string;
  live: boolean;
}

/**
 * Share a project or a listing with the lead (M4-30): a link to its public
 * page, which logs on the timeline when the client opens it. Share via
 * WhatsApp opens WhatsApp with the link written, where the lead has a number
 * marked as on WhatsApp the viewer may see; Copy link otherwise. A link lapses
 * after 30 days, or is revoked here.
 */
export default function ShareCard({
  leadId,
  firstName,
  whatsapp,
  projectOptions,
  listingOptions,
  shares,
}: {
  leadId: string;
  firstName: string;
  /** wa.me for the lead's WhatsApp number, or null (none marked, or masked to the viewer). */
  whatsapp: string | null;
  projectOptions: { id: string; name: string }[] | null;
  listingOptions: { id: string; reference: string; title: string }[] | null;
  shares: LeadShareRow[];
}) {
  const { busy, run, note } = useRun();
  const [target, setTarget] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const url = `/api/v1/leads/${leadId}/shares`;

  const create = () =>
    run(async () => {
      const [kind, id] = target.split(':');
      await send(url, 'POST', kind === 'project' ? { projectId: id } : { listingId: id });
      setTarget('');
    }, 'Link ready. Share it below.');
  const revoke = (id: string) => run(() => send(`${url}?share=${id}`, 'DELETE'), 'Revoked.');
  const copy = async (share: LeadShareRow) => {
    await navigator.clipboard?.writeText(share.url).catch(() => undefined);
    setCopied(share.id);
  };
  const message = (share: LeadShareRow) => `Hi ${firstName}, here are the details of ${share.title}: ${share.url}`;

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }} aria-label="Share a property">
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Share a property
      </div>
      {(projectOptions || listingOptions) && (
        <form
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (target) void create();
          }}
        >
          <select
            className="lf-input"
            aria-label="Project or listing to share"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={{ flex: '1 1 180px', minWidth: 0 }}
          >
            <option value="">Choose a listing or project…</option>
            {listingOptions && listingOptions.length > 0 && (
              <optgroup label="Listings">
                {listingOptions.map((l) => (
                  <option key={l.id} value={`listing:${l.id}`}>
                    {l.reference} · {l.title}
                  </option>
                ))}
              </optgroup>
            )}
            {projectOptions && projectOptions.length > 0 && (
              <optgroup label="Projects">
                {projectOptions.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !target}>
            Create link
          </button>
        </form>
      )}
      {note}
      {shares.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 'var(--lf-space-3) 0 0', padding: 0, display: 'grid', gap: 10 }}>
          {shares.map((share) => (
            <li
              key={share.id}
              aria-label={`Shared ${share.title}`}
              style={{ borderTop: '1px solid var(--lf-line)', paddingTop: 8, minWidth: 0 }}
            >
              <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{share.title}</div>
              <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                {[
                  share.kind === 'listing' ? 'Listing' : 'Project',
                  share.views ? `opened ${share.views} time${share.views === 1 ? '' : 's'}` : 'not opened yet',
                  share.lastViewed && `last ${share.lastViewed}`,
                  share.live ? `until ${share.until}` : 'no longer works',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {share.live && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {whatsapp && (
                    <a
                      className="lf-btn lf-btn--secondary lf-btn--sm"
                      href={`${whatsapp}?text=${encodeURIComponent(message(share))}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Share via WhatsApp
                    </a>
                  )}
                  <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => copy(share)}>
                    {copied === share.id ? 'Copied' : 'Copy link'}
                  </button>
                  <a className="lf-btn lf-btn--ghost lf-btn--sm" href={share.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button
                    type="button"
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    disabled={busy}
                    onClick={() => revoke(share.id)}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
