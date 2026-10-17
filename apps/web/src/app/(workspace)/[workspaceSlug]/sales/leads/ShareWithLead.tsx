'use client';

import { useEffect, useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';
import SalesLink from '@/components/workspace/SalesLink';

interface LeadOption {
  id: string;
  reference: string;
  fullName: string;
}

interface Shared {
  lead: LeadOption;
  url: string;
  whatsapp: string | null;
}

/**
 * Share this listing or project with a lead (M10-09), from the stock's page:
 * find the lead, and its link is made by the lead's own share
 * (`POST /api/v1/leads/{id}/shares`), so it is on the lead's timeline, counts
 * openings and is listed (and revoked) on the lead's page. Share via WhatsApp
 * opens WhatsApp with the link written to the lead's number, where the sharer
 * reads it and the lead may be messaged; Copy link otherwise.
 */
export default function ShareWithLead({ shareTarget }: { shareTarget: { listingId: string } | { projectId: string } }) {
  const { busy, run, note } = useRun();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<LeadOption[]>([]);
  const [shared, setShared] = useState<Shared | null>(null);
  const [copied, setCopied] = useState(false);
  const typed = query.trim();

  useEffect(() => {
    if (typed.length < 2) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/v1/leads?q=${encodeURIComponent(typed)}&pageSize=8`).catch(() => null);
      if (res?.ok) setFound(((await res.json()).data ?? []) as LeadOption[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const share = (lead: LeadOption) =>
    run(async () => {
      const link = (await send(`/api/v1/leads/${lead.id}/shares`, 'POST', shareTarget)) as Omit<Shared, 'lead'>;
      setShared({ lead, url: link.url, whatsapp: link.whatsapp });
      setCopied(false);
      setQuery('');
    }, 'Link ready. It is on the lead’s timeline.');

  return (
    <section className="lf-card" style={{ padding: 18 }} aria-label="Share with a lead">
      <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
        Share with a lead
      </h2>
      <input
        className="lf-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a lead by name, phone or reference…"
        aria-label="Find a lead"
        autoComplete="off"
        style={{ width: '100%' }}
      />
      {typed.length >= 2 && found.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
          {found.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={busy}
                onClick={() => share(lead)}
                style={{ maxWidth: '100%', overflowWrap: 'anywhere', textAlign: 'start' }}
              >
                Share with {lead.fullName} · {lead.reference}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note}
      {shared && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{shared.lead.fullName}</span>
          {shared.whatsapp && (
            <a className="lf-btn lf-btn--secondary lf-btn--sm" href={shared.whatsapp} target="_blank" rel="noreferrer">
              Share via WhatsApp
            </a>
          )}
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(shared.url).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <SalesLink className="lf-btn lf-btn--ghost lf-btn--sm" href={`/leads/${shared.lead.id}`}>
            Open the lead
          </SalesLink>
        </div>
      )}
    </section>
  );
}
