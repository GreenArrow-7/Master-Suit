'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the server. Nothing was saved.');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
  }
}

/**
 * A new QR capture link: what it is for, who gets its leads, and what the page
 * says. Without `agents` (no leads:ASSIGN) the link is the maker's own.
 */
export default function CaptureLinkForm({ agents }: { agents: { id: string; fullName: string }[] | null }) {
  const router = useRouter();
  const blank = { label: '', headline: '', ownerId: '', campaign: '' };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="lf-card"
      style={{
        padding: 'var(--lf-space-4)',
        display: 'grid',
        gap: 'var(--lf-space-3)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
        alignItems: 'end',
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await send('/api/v1/capture-links', 'POST', {
            label: form.label,
            headline: form.headline || undefined,
            ownerId: form.ownerId || null,
            campaign: form.campaign || undefined,
          });
          setForm(blank);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <Field label="What it is for" htmlFor="capture-label" required>
        <input
          id="capture-label"
          className="lf-input"
          required
          minLength={2}
          maxLength={80}
          placeholder="e.g. Cityscape stand"
          value={form.label}
          onChange={set('label')}
        />
      </Field>
      {agents && (
        <Field label="Leads go to" htmlFor="capture-owner">
          <select id="capture-owner" className="lf-input" value={form.ownerId} onChange={set('ownerId')}>
            <option value="">Distribution decides</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.fullName}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Project or campaign" htmlFor="capture-campaign">
        <input
          id="capture-campaign"
          className="lf-input"
          maxLength={80}
          placeholder="e.g. Sidra Villas"
          value={form.campaign}
          onChange={set('campaign')}
        />
      </Field>
      <Field label="Headline on the page" htmlFor="capture-headline">
        <input
          id="capture-headline"
          className="lf-input"
          maxLength={120}
          placeholder="Leave your details and we will call you"
          value={form.headline}
          onChange={set('headline')}
        />
      </Field>
      <button className="lf-btn lf-btn--sm" disabled={busy || form.label.trim().length < 2}>
        Make QR code
      </button>
      {error && (
        <p className="lf-hint lf-hint--error" role="alert" style={{ gridColumn: '1 / -1', margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}

/** On or off. An off link's page is a 404, and its printed codes stop collecting. */
export function LinkSwitch({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await send(`/api/v1/capture-links/${id}`, 'PATCH', { isActive: !active });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {active ? 'Switch off' : 'Switch on'}
      </button>
      {error && (
        <p className="lf-hint lf-hint--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
