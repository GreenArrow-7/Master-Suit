'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Create a campaign — the front door the module was missing. Wires to
 * POST /api/v1/campaigns; the detail page takes over from there (audience,
 * scripts, WhatsApp send, dialer).
 */
const TYPES = ['OUTBOUND', 'CALLING', 'NURTURE', 'EVENT', 'PROMOTION'] as const;
const CHANNELS = [
  ['WHATSAPP', 'WhatsApp'],
  ['VOICE', 'Calls'],
  ['EMAIL', 'Email'],
  ['SMS', 'SMS'],
] as const;

const EMPTY = {
  name: '',
  campaignType: 'OUTBOUND',
  channel: 'WHATSAPP',
  startDate: '',
  endDate: '',
  budget: '',
  whatsappTemplate: '',
  schedule: false,
};

export default function CampaignComposer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          campaignType: form.campaignType,
          channel: form.channel,
          status: form.schedule && form.startDate ? 'SCHEDULED' : 'DRAFT',
          ...(form.startDate ? { startDate: form.startDate } : {}),
          ...(form.endDate ? { endDate: form.endDate } : {}),
          ...(form.budget ? { budget: Number(form.budget) } : {}),
          ...(form.whatsappTemplate ? { whatsappTemplate: form.whatsappTemplate } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this campaign.');
        return;
      }
      setForm(EMPTY);
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn lf-btn--sm" onClick={() => setOpen(true)}>
        New campaign
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="lf-card"
      style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-4)' }}
      noValidate
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New campaign</h2>
        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="c-name">
          Name
        </label>
        <input id="c-name" className="lf-input" value={form.name} onChange={set('name')} required autoFocus />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--lf-space-4)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="c-type">
            Type
          </label>
          <select id="c-type" className="lf-input" value={form.campaignType} onChange={set('campaignType')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="c-channel">
            Channel
          </label>
          <select id="c-channel" className="lf-input" value={form.channel} onChange={set('channel')}>
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="c-start">
            Starts
          </label>
          <input id="c-start" className="lf-input" type="date" value={form.startDate} onChange={set('startDate')} />
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="c-end">
            Ends
          </label>
          <input id="c-end" className="lf-input" type="date" value={form.endDate} onChange={set('endDate')} />
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="c-budget">
            Budget (AED)
          </label>
          <input id="c-budget" className="lf-input" type="number" min={0} value={form.budget} onChange={set('budget')} />
        </div>
      </div>

      {form.channel === 'WHATSAPP' && (
        <div className="lf-field">
          <label className="lf-label" htmlFor="c-template">
            Approved WhatsApp template
          </label>
          <input
            id="c-template"
            className="lf-input"
            value={form.whatsappTemplate}
            onChange={set('whatsappTemplate')}
            placeholder="promo_launch_v1"
          />
          <p className="lf-hint" style={{ margin: '4px 0 0' }}>
            {form.schedule
              ? 'The scheduler sends with this template when the start date arrives.'
              : 'Optional now — you can also enter one when you press Send on the campaign page.'}
          </p>
        </div>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input type="checkbox" checked={form.schedule} onChange={set('schedule')} disabled={!form.startDate} />
        Schedule: start automatically on the start date
      </label>

      <div>
        <button
          className="lf-btn"
          type="submit"
          disabled={busy || (form.schedule && form.channel === 'WHATSAPP' && !form.whatsappTemplate)}
        >
          {busy ? 'Creating…' : 'Create campaign'}
        </button>
      </div>
    </form>
  );
}
