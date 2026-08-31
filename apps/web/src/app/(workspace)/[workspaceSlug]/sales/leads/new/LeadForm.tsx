'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';
import Field from '@/components/forms/Field';
import { useFormErrors } from '@/components/forms/useFormErrors';

/**
 * Required markers mirror the API schema (`createBody` in api/v1/leads/route.ts):
 * `fullName` is the only required field, so it is the only one starred. The
 * form stays `noValidate` — the design system draws the error, not the browser
 * bubble — and `useFormErrors` runs the same required check before the round
 * trip, then maps the API's per-field 422 list onto fields after it.
 */
export default function LeadForm() {
  const router = useRouter();
  const base = useModuleBase();
  const formRef = useRef<HTMLFormElement>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [busy, setBusy] = useState(false);
  const { fieldErrors, formError, setFormError, reset, clear, validateRequired, applyProblem } = useFormErrors();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    if (!validateRequired(formRef.current!)) return;
    setBusy(true);
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
        applyProblem(data, formRef.current);
        return;
      }
      router.push(`${base}/leads/${data.id}`);
      router.refresh();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {formError && (
        <div className="lf-alert" role="alert">
          {formError}
        </div>
      )}

      <Field label="Full name" htmlFor="fullName" required error={fieldErrors.fullName}>
        <input
          id="fullName"
          name="fullName"
          className="lf-input"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            clear('fullName');
          }}
          required
          autoFocus
        />
      </Field>

      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <input
          id="email"
          name="email"
          className="lf-input"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clear('email');
          }}
        />
      </Field>

      <Field label="Phone" htmlFor="phone" error={fieldErrors.phone}>
        <input
          id="phone"
          name="phone"
          className="lf-input"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            clear('phone');
          }}
        />
      </Field>

      <Field label="Company" htmlFor="company" error={fieldErrors.company}>
        <input
          id="company"
          name="company"
          className="lf-input"
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            clear('company');
          }}
        />
      </Field>

      <Field label="Job title" htmlFor="jobTitle" error={fieldErrors.jobTitle}>
        <input
          id="jobTitle"
          name="jobTitle"
          className="lf-input"
          value={jobTitle}
          onChange={(e) => {
            setJobTitle(e.target.value);
            clear('jobTitle');
          }}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-3)' }}>
        <Field label="Country" htmlFor="country" error={fieldErrors.country}>
          <input
            id="country"
            name="country"
            className="lf-input"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              clear('country');
            }}
          />
        </Field>
        <Field label="City" htmlFor="city" error={fieldErrors.city}>
          <input
            id="city"
            name="city"
            className="lf-input"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              clear('city');
            }}
          />
        </Field>
      </div>

      <Field label="Priority" htmlFor="priority" error={fieldErrors.priority}>
        <select
          id="priority"
          name="priority"
          className="lf-input"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </Field>

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
