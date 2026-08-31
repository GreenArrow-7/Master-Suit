'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

export interface PlaybookRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  leadTags: string[];
  discoveryQuestions: string[];
  approvedClaims: string[];
  objectionGuidance: string | null;
  closingStrategy: string | null;
  followUpStrategy: string | null;
  complianceNotes: string | null;
}

const EMPTY: PlaybookRow = {
  id: '',
  name: '',
  description: null,
  isActive: true,
  isDefault: false,
  leadTags: [],
  discoveryQuestions: [],
  approvedClaims: [],
  objectionGuidance: null,
  closingStrategy: null,
  followUpStrategy: null,
  complianceNotes: null,
};

const lines = (v: string) =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Buyer-type playbooks: the strategy the live coach sells under. One list, one
 * inline form; the matched playbook (lead tags first, default as fallback) is
 * folded into every coach prompt for that lead's calls.
 */
export default function BuyerPlaybooks({ playbooks, canEdit }: { playbooks: PlaybookRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlaybookRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    const body = {
      name: editing.name,
      description: editing.description || undefined,
      isActive: editing.isActive,
      isDefault: editing.isDefault,
      leadTags: editing.leadTags,
      discoveryQuestions: editing.discoveryQuestions,
      approvedClaims: editing.approvedClaims,
      objectionGuidance: editing.objectionGuidance || undefined,
      closingStrategy: editing.closingStrategy || undefined,
      followUpStrategy: editing.followUpStrategy || undefined,
      complianceNotes: editing.complianceNotes || undefined,
    };
    try {
      const res = await fetch(editing.id ? `/api/v1/sales-playbooks/${editing.id}` : '/api/v1/sales-playbooks', {
        method: editing.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Save failed (${res.status})`);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm('Retire this playbook? Calls already coached against it keep their history.')) return;
    setBusy(true);
    const res = await fetch(`/api/v1/sales-playbooks/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  const set = <K extends keyof PlaybookRow>(key: K, value: PlaybookRow[K]) =>
    setEditing((p) => (p ? { ...p, [key]: value } : p));

  const area = (label: string, key: 'objectionGuidance' | 'closingStrategy' | 'followUpStrategy' | 'complianceNotes') => (
    <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
      {label}
      <textarea
        className="lf-input"
        rows={2}
        maxLength={4000}
        value={editing?.[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div className="lf-eyebrow">Buyer playbooks</div>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            How you sell to each kind of buyer. The live coach folds the matched playbook — by lead tag, or the
            default — into its guidance, and only ever asserts the approved claims written here.
          </p>
        </div>
        {canEdit && !editing && (
          <button className="lf-btn lf-btn--sm" onClick={() => setEditing(EMPTY)}>
            New playbook
          </button>
        )}
      </div>

      {playbooks.length === 0 && !editing && (
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)', marginTop: 'var(--lf-space-3)' }}>
          None yet. Try “Dubai Investor”, “First-Time Home Buyer” or “Off-Plan Investor”.
        </p>
      )}

      {playbooks.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }}>
          {playbooks.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                borderBottom: '1px solid var(--lf-line)',
                paddingBottom: 'var(--lf-space-2)',
              }}
            >
              <strong style={{ fontSize: 'var(--lf-text-sm)' }}>{p.name}</strong>
              {p.isDefault && <Badge tone="wine">default</Badge>}
              {!p.isActive && <Badge tone="slate">inactive</Badge>}
              {p.leadTags.length > 0 && (
                <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                  tags: {p.leadTags.join(', ')}
                </span>
              )}
              <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-4)' }}>
                {p.discoveryQuestions.length} questions · {p.approvedClaims.length} approved claims
              </span>
              {canEdit && (
                <button
                  className="lf-btn lf-btn--sm lf-btn--ghost"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setEditing(p)}
                >
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <form onSubmit={save} style={{ display: 'grid', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }}>
          {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-2)' }}>
            <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              Name
              <input
                className="lf-input"
                required
                maxLength={120}
                value={editing.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Dubai Investor"
              />
            </label>
            <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              Lead tags that select it (comma-separated)
              <input
                className="lf-input"
                value={editing.leadTags.join(', ')}
                onChange={(e) => set('leadTags', csv(e.target.value))}
                placeholder="investor, off-plan"
              />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            Description
            <input
              className="lf-input"
              maxLength={1000}
              value={editing.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            Discovery questions (one per line)
            <textarea
              className="lf-input"
              rows={3}
              value={editing.discoveryQuestions.join('\n')}
              onChange={(e) => set('discoveryQuestions', lines(e.target.value))}
              placeholder={'Is rental yield or capital appreciation more important to you?\nCash or finance?'}
            />
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            Approved claims — the coach asserts nothing beyond these (one per line)
            <textarea
              className="lf-input"
              rows={3}
              value={editing.approvedClaims.join('\n')}
              onChange={(e) => set('approvedClaims', lines(e.target.value))}
              placeholder={'Service charges are written into the SPA.\nHandover is escrow-guaranteed.'}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-2)' }}>
            {area('Objection handling', 'objectionGuidance')}
            {area('Closing strategy', 'closingStrategy')}
            {area('Follow-up strategy', 'followUpStrategy')}
            {area('Compliance guidance', 'complianceNotes')}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
              <input type="checkbox" checked={editing.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Active
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
              <input type="checkbox" checked={editing.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
              Default when no tag matches
            </label>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {editing.id && (
                <button
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--ghost"
                  onClick={() => remove(editing.id)}
                  disabled={busy}
                >
                  Retire
                </button>
              )}
              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="lf-btn lf-btn--sm" disabled={busy || !editing.name.trim()}>
                {busy ? 'Saving…' : 'Save playbook'}
              </button>
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
