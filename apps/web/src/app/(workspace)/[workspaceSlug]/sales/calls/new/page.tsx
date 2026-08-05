'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function NewCallPage() {
  const router = useRouter();
  const base = useModuleBase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    body.recipientNumber = fd.get('recipientNumber') as string;
    body.direction = fd.get('direction') as string;
    if (fd.get('leadId')) body.leadId = fd.get('leadId') as string;
    if (fd.get('campaignId')) body.campaignId = fd.get('campaignId') as string;
    if (fd.get('notes')) body.notes = fd.get('notes') as string;

    const res = await fetch('/api/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? 'Failed to create call');
      setSubmitting(false);
      return;
    }

    const call = await res.json();
    router.push(`${base}/calls/${call.id}`);
  }

  return (
    <>
      <h1 className="lf-h1">New Call</h1>
      <form onSubmit={handleSubmit} className="lf-card" style={{ padding: 'var(--lf-space-5)', maxWidth: 480, display: 'grid', gap: 'var(--lf-space-4)' }}>
        <label className="lf-field">
          <span className="lf-label">Phone Number *</span>
          <input name="recipientNumber" type="tel" required className="lf-input" placeholder="+971 50 123 4567" />
        </label>

        <label className="lf-field">
          <span className="lf-label">Direction</span>
          <select name="direction" className="lf-input" defaultValue="OUTBOUND">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
        </label>

        <label className="lf-field">
          <span className="lf-label">Lead ID</span>
          <input name="leadId" className="lf-input" placeholder="Optional — paste lead CUID" />
        </label>

        <label className="lf-field">
          <span className="lf-label">Campaign ID</span>
          <input name="campaignId" className="lf-input" placeholder="Optional — paste campaign CUID" />
        </label>

        <label className="lf-field">
          <span className="lf-label">Notes</span>
          <textarea name="notes" className="lf-input" rows={3} placeholder="Pre-call notes..." />
        </label>

        {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}

        <button type="submit" className="lf-btn lf-btn--primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Call'}
        </button>
      </form>
    </>
  );
}
