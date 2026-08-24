'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pick who the campaign talks to, from the lead directory. Search, tick, add.
 * Attaching sets lead.campaignId server-side, which is what the WhatsApp send
 * and the dialer queue already select on.
 */
interface LeadRow {
  id: string;
  fullName: string;
  phone: string | null;
}

export default function AudiencePicker({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/leads?q=${encodeURIComponent(q)}&limit=25`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Search failed.');
        return;
      }
      setRows((data.data ?? []).map((r: LeadRow) => ({ id: r.id, fullName: r.fullName, phone: r.phone })));
      setSearched(true);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add() {
    if (picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}/audience`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ add: [...picked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not add these leads.');
        return;
      }
      setPicked(new Set());
      setRows([]);
      setSearched(false);
      setQ('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(true)}>
        Add leads
      </button>
    );
  }

  return (
    <div className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Add leads to this campaign</h2>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Close
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={search} style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
        <input
          className="lf-input"
          placeholder="Search leads by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search leads to add"
        />
        <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searched && rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>No leads matched.</p>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'grid', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
          {rows.map((row) => (
            <label
              key={row.id}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                fontSize: 'var(--lf-text-sm)',
                background: picked.has(row.id) ? 'var(--lf-surface-2)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={picked.has(row.id)} onChange={() => toggle(row.id)} />
              <span style={{ fontWeight: 500 }}>{row.fullName}</span>
              <span style={{ color: 'var(--lf-ink-3)' }}>{row.phone ?? 'no phone'}</span>
            </label>
          ))}
        </div>
      )}

      <div>
        <button type="button" className="lf-btn" disabled={busy || picked.size === 0} onClick={add}>
          {busy ? 'Adding…' : `Add ${picked.size || ''} lead${picked.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
