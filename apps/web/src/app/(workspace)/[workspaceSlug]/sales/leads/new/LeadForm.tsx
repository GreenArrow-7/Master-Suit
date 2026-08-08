'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function LeadForm() {
  const router = useRouter();
  const base = useModuleBase();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName,
          source: 'MANUAL',
          priority,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(company ? { company } : {}),
          ...(jobTitle ? { jobTitle } : {}),
          ...(country ? { country } : {}),
          ...(city ? { city } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Could not create lead.');
        return;
      }
      router.push(`${base}/leads/${data.id}`);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="fullName">
          Full name *
        </label>
        <input
          id="fullName"
          className="lf-input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="email">
          Email
        </label>
        <input id="email" className="lf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="phone">
          Phone
        </label>
        <input id="phone" className="lf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="company">
          Company
        </label>
        <input id="company" className="lf-input" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="jobTitle">
          Job title
        </label>
        <input id="jobTitle" className="lf-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-3)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="country">
            Country
          </label>
          <input id="country" className="lf-input" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="city">
            City
          </label>
          <input id="city" className="lf-input" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="priority">
          Priority
        </label>
        <select id="priority" className="lf-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-2)' }}>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create lead'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href="/leads">
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
