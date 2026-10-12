'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';
import Field from '@/components/forms/Field';
import SourcePicker, { type SourceOption } from '@/components/forms/SourcePicker';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { parseTags } from '@/lib/leads/tags';

/**
 * Required markers mirror the API schema (`createBody` in api/v1/leads/route.ts):
 * `fullName` is the only required field, so it is the only one starred. The
 * form stays `noValidate` — the design system draws the error, not the browser
 * bubble — and `useFormErrors` runs the same required check before the round
 * trip, then maps the API's per-field 422 list onto fields after it.
 */
export default function LeadForm({ sources }: { sources: SourceOption[] }) {
  const router = useRouter();
  const base = useModuleBase();
  const formRef = useRef<HTMLFormElement>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // On unless the number is not on WhatsApp (a landline).
  const [phoneIsWhatsapp, setPhoneIsWhatsapp] = useState(true);
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [nationality, setNationality] = useState('');
  const [source, setSource] = useState({ sourceId: '', subSourceId: '' });
  const [campaignName, setCampaignName] = useState('');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [referrer, setReferrer] = useState('');
  const [busy, setBusy] = useState(false);
  const { fieldErrors, formError, setFormError, reset, clear, validateRequired, applyProblem } = useFormErrors();
  // The catalogue's Referral entry (or a sub-source under it) is a REFERRAL lead,
  // which names who referred it (M6-15).
  const referral = sources.find((s) => s.id === source.sourceId)?.key === 'referral';

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
          source: referral ? 'REFERRAL' : 'MANUAL',
          ...(referral && referrer ? { sourceDetail: referrer } : {}),
          priority,
          ...(email ? { email } : {}),
          ...(phone ? { phone, phoneIsWhatsapp } : {}),
          ...(company ? { company } : {}),
          ...(jobTitle ? { jobTitle } : {}),
          ...(country ? { country } : {}),
          ...(city ? { city } : {}),
          ...(nationality ? { nationality } : {}),
          // The sub-source when one is chosen, else the source.
          ...(source.subSourceId || source.sourceId ? { sourceId: source.subSourceId || source.sourceId } : {}),
          ...(campaignName ? { campaignName } : {}),
          tags: parseTags(tags),
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
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input
          type="checkbox"
          name="phoneIsWhatsapp"
          checked={phoneIsWhatsapp}
          onChange={(e) => setPhoneIsWhatsapp(e.target.checked)}
        />
        On WhatsApp
      </label>

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

      <Field label="Nationality" htmlFor="nationality" error={fieldErrors.nationality}>
        <input
          id="nationality"
          name="nationality"
          className="lf-input"
          value={nationality}
          onChange={(e) => {
            setNationality(e.target.value);
            clear('nationality');
          }}
        />
      </Field>

      <SourcePicker
        sources={sources}
        sourceId={source.sourceId}
        subSourceId={source.subSourceId}
        onChange={(sourceId, subSourceId) => {
          setSource({ sourceId, subSourceId });
          clear('sourceId');
        }}
        error={fieldErrors.sourceId}
      />

      {referral && (
        <Field label="Referred by" htmlFor="sourceDetail" required error={fieldErrors.sourceDetail}>
          <input
            id="sourceDetail"
            name="sourceDetail"
            className="lf-input"
            value={referrer}
            placeholder="A client, a partner, a colleague"
            required
            onChange={(e) => {
              setReferrer(e.target.value);
              clear('sourceDetail');
            }}
          />
        </Field>
      )}

      <Field label="Campaign" htmlFor="campaignName" error={fieldErrors.campaignName}>
        <input
          id="campaignName"
          name="campaignName"
          className="lf-input"
          placeholder="e.g. Marina launch"
          value={campaignName}
          onChange={(e) => {
            setCampaignName(e.target.value);
            clear('campaignName');
          }}
        />
      </Field>

      <Field label="Tags" htmlFor="tags" error={fieldErrors.tags}>
        <input
          id="tags"
          name="tags"
          className="lf-input"
          placeholder="Comma-separated, e.g. vip, investor"
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            clear('tags');
          }}
        />
      </Field>

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
