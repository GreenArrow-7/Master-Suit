'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * The demo social-lead connector, on the screen where the enquiries land.
 *
 * It says "Demo Mode" and never "Connected". The leads it makes are real rows in
 * the real Leads table — that is the whole point, they go through the same
 * ingestion the Meta webhook uses — so the panel is careful not to imply a
 * provider is attached. A workspace that mistook simulated traffic for real
 * traffic would draw conclusions from it.
 *
 * Rendered only for a workspace marked `isDemo`; the server refuses anything
 * else regardless of what this component does.
 */
type Source = { key: string; label: string; recordSource: string };
type Outcome =
  { kind: 'created'; leadId: string; slug: string } | { kind: 'duplicate' } | { kind: 'error'; message: string };

export default function DemoLeadConnector({ slug, sources }: { slug: string; sources: Source[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function generate(source: string) {
    setBusy(source);
    setOutcome(null);
    try {
      const res = await fetch('/api/v1/integrations/demo-leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutcome({ kind: 'error', message: typeof data.detail === 'string' ? data.detail : 'That did not work.' });
        return;
      }
      // The pipeline's own answer, reported rather than smoothed over: a replay
      // is a duplicate, and saying "created" would be a lie about what happened.
      setOutcome(data.leadId ? { kind: 'created', leadId: data.leadId, slug } : { kind: 'duplicate' });
    } catch {
      setOutcome({ kind: 'error', message: 'The request could not be sent.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lf-card" style={{ padding: '1rem 1.15rem', display: 'grid', gap: '.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <strong>Demo social lead integration</strong>
        <span className="lf-badge" style={{ background: 'rgb(180 130 20 / .16)', color: '#8a6200' }}>
          Demo mode — simulated
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '.86rem', opacity: 0.78 }}>
        No provider is connected. These generate a lead through the same ingestion pipeline a real Facebook or Instagram
        lead uses — deduplication, routing, assignment and automation all run — so the lead appears in{' '}
        <Link href={`/${slug}/sales/leads`}>Leads</Link> like any other.
      </p>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        {sources.map((source) => (
          <button
            key={source.key}
            type="button"
            className="lf-btn lf-btn--ghost"
            disabled={busy !== null}
            onClick={() => generate(source.key)}
          >
            {busy === source.key ? 'Generating…' : `Generate ${source.label} lead`}
          </button>
        ))}
      </div>

      {outcome?.kind === 'created' && (
        <p style={{ margin: 0, fontSize: '.86rem' }}>
          Lead created —{' '}
          <Link href={`/${outcome.slug}/sales/leads/${outcome.leadId}`}>open it in the normal lead screen</Link>.
        </p>
      )}
      {outcome?.kind === 'duplicate' && (
        <p style={{ margin: 0, fontSize: '.86rem', opacity: 0.78 }}>
          That provider event had already been ingested, so no second lead was created.
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--lf-danger, #b42318)' }}>{outcome.message}</p>
      )}
    </section>
  );
}
