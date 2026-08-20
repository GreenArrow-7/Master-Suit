'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

export interface ObjectionView {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  triggerPhrases: string[];
  recommendedResponses: string[];
  isActive: boolean;
  matchCount: number;
}

interface FormState {
  id?: string;
  name: string;
  description: string;
  tags: string;
  triggerPhrases: string;
  recommendedResponses: string;
}

const empty: FormState = { name: '', description: '', tags: '', triggerPhrases: '', recommendedResponses: '' };

/** Textareas hold one phrase per line; the API wants arrays. */
const toLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export default function PlaybookEditor({ objections, canEdit }: { objections: ObjectionView[]; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        tags: toLines(form.tags),
        triggerPhrases: toLines(form.triggerPhrases),
        recommendedResponses: toLines(form.recommendedResponses),
      };
      const res = await fetch(form.id ? `/api/v1/objections/${form.id}` : '/api/v1/objections', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Save failed (${res.status})`);
      }
      setForm(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm('Retire this objection? Past call matches are kept; new calls stop matching it.')) return;
    setBusy(true);
    try {
      await fetch(`/api/v1/objections/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const edit = (o: ObjectionView) =>
    setForm({
      id: o.id,
      name: o.name,
      description: o.description ?? '',
      tags: o.tags.join('\n'),
      triggerPhrases: o.triggerPhrases.join('\n'),
      recommendedResponses: o.recommendedResponses.join('\n'),
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      {canEdit && !form && (
        <div>
          <button className="lf-btn lf-btn--primary" onClick={() => setForm(empty)}>
            Add objection
          </button>
        </div>
      )}

      {form && (
        <form onSubmit={save} className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 8 }}>
          <div className="lf-eyebrow">{form.id ? 'Edit objection' : 'New objection'}</div>
          {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}
          <input
            className="lf-input"
            placeholder="Name, e.g. Too expensive"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={200}
          />
          <textarea
            className="lf-input"
            rows={2}
            placeholder="What this objection usually means (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <label style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500 }}>
            Trigger phrases — one per line, the prospect’s words
            <textarea
              className="lf-input"
              rows={3}
              placeholder={'too expensive\nover our budget'}
              value={form.triggerPhrases}
              onChange={(e) => setForm({ ...form, triggerPhrases: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500 }}>
            Recommended responses — one per line
            <textarea
              className="lf-input"
              rows={3}
              placeholder="Acknowledge, then reframe around the payment plan…"
              value={form.recommendedResponses}
              onChange={(e) => setForm({ ...form, recommendedResponses: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500 }}>
            Tags — one per line (optional)
            <textarea
              className="lf-input"
              rows={2}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn lf-btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {objections.map((o) => (
        <div key={o.id} className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{o.name}</span>
              {!o.isActive && <Badge tone="slate">inactive</Badge>}
              {o.tags.map((tag) => (
                <Badge key={tag} tone="slate">
                  {tag}
                </Badge>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                matched on {o.matchCount} call{o.matchCount === 1 ? '' : 's'}
              </span>
              {canEdit && (
                <>
                  <button className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => edit(o)} disabled={busy}>
                    Edit
                  </button>
                  <button
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    style={{ color: 'var(--lf-vermillion)' }}
                    onClick={() => remove(o.id)}
                    disabled={busy}
                  >
                    Retire
                  </button>
                </>
              )}
            </div>
          </div>
          {o.description && (
            <p style={{ margin: '6px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
              {o.description}
            </p>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--lf-space-4)',
              marginTop: 'var(--lf-space-3)',
              fontSize: 'var(--lf-text-sm)',
            }}
          >
            <div>
              <div className="lf-eyebrow" style={{ marginBottom: 4 }}>
                They say
              </div>
              <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', color: 'var(--lf-ink-2)' }}>
                {o.triggerPhrases.map((phrase, i) => (
                  <li key={i}>“{phrase}”</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="lf-eyebrow" style={{ marginBottom: 4 }}>
                We answer
              </div>
              <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', color: 'var(--lf-ink-2)' }}>
                {o.recommendedResponses.map((response, i) => (
                  <li key={i}>{response}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
