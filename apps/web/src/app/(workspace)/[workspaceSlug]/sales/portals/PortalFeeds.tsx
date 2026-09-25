'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PortalKey } from '@/lib/inventory/portalFeed';

export interface FeedView {
  key: PortalKey;
  label: string;
  isActive: boolean;
  path: string | null;
  lastBuiltAt: string | null;
  lastItemCount: number;
}

/**
 * The feeds, and the switches on them.
 *
 * The paragraph at the top prevents more support calls than anything else on
 * the page: a portal fetches on its own schedule, so publishing is not
 * instant, and nobody should be waiting for it to be.
 *
 * State comes down from the server component rather than being fetched on
 * mount — the page already holds it, and a second round trip on every visit
 * buys nothing.
 */
export default function PortalFeeds({ portals }: { portals: FeedView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(portal: PortalKey, patch: Record<string, unknown>, message: string) {
    setBusy(portal);
    setNote(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/portals', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ portal, ...patch }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new Error(failure.detail ?? failure.title ?? 'That did not work.');
      }
      const result = (await response.json()) as { included: number | null };
      setNote(result.included === null ? message : `${result.included} listings are in the feed.`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-5)' }}>
      <p style={{ margin: 0, color: 'var(--lf-ink-3)' }}>
        The portals collect listings from an address you give them rather than accepting a push, so nothing appears the
        moment you publish it — they fetch on their own schedule, usually every few hours. Give each portal its own
        address, and never the same one twice.
      </p>

      {note && <p style={{ margin: 0, color: 'var(--lf-viridian, #0E7C66)' }}>{note}</p>}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion, #B3261E)' }}>
          {error}
        </p>
      )}

      {portals.map((feed) => (
        <div key={feed.key} className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong>{feed.label}</strong>
            <span
              style={{
                fontSize: 'var(--lf-text-xs)',
                color: feed.isActive ? 'var(--lf-viridian, #0E7C66)' : 'var(--lf-ink-3)',
              }}
            >
              {feed.isActive ? 'live' : 'off'}
            </span>
            {feed.lastBuiltAt && (
              <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                last built {new Date(feed.lastBuiltAt).toLocaleString('en-GB')} · {feed.lastItemCount}{' '}
                {feed.lastItemCount === 1 ? 'listing' : 'listings'}
              </span>
            )}

            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="lf-btn lf-btn--ghost"
                disabled={busy === feed.key}
                onClick={() =>
                  void change(
                    feed.key,
                    { isActive: !feed.isActive },
                    feed.isActive ? 'Feed switched off.' : 'Feed is live. Give the address to the portal.',
                  )
                }
              >
                {feed.isActive ? 'Switch off' : 'Switch on'}
              </button>

              {feed.isActive && (
                <>
                  <button
                    type="button"
                    className="lf-btn lf-btn--ghost"
                    disabled={busy === feed.key}
                    onClick={() => void change(feed.key, { rebuild: true }, 'Built.')}
                  >
                    Build now
                  </button>
                  <button
                    type="button"
                    className="lf-btn lf-btn--ghost"
                    disabled={busy === feed.key}
                    onClick={() =>
                      void change(
                        feed.key,
                        { rotateKey: true },
                        'New address. The portal gets nothing until you give them this one.',
                      )
                    }
                  >
                    New address
                  </button>
                </>
              )}
            </span>
          </div>

          {feed.isActive && feed.path && (
            <input
              className="lf-input"
              readOnly
              defaultValue={feed.path}
              onFocus={(event) => event.currentTarget.select()}
              aria-label={`${feed.label} feed address`}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--lf-text-xs)' }}
            />
          )}
        </div>
      ))}
    </section>
  );
}
