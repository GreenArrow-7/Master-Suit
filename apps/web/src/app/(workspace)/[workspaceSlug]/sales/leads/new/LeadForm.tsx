'use client';

import { Fragment, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';
import Field from '@/components/forms/Field';
import CustomFieldInput from '@/components/forms/CustomFieldInput';
import SourcePicker, { type SourceOption } from '@/components/forms/SourcePicker';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { parseTags } from '@/lib/leads/tags';
import type { LayoutField, LeadFormKey } from '@/lib/leads/formLayout';
import type { LeadField } from '@/services/leads/customFields';

/**
 * Required markers mirror the API schema (`createBody` in api/v1/leads/route.ts):
 * `fullName`, and the workspace's required custom fields (M18-03), are the
 * starred ones. The form stays `noValidate` — the design system draws the
 * error, not the browser bubble — and `useFormErrors` runs the same required
 * check before the round trip, then maps the API's per-field 422 list onto
 * fields after it. The fields after Full name come in the workspace's order,
 * its hidden ones left out (`layout`, M18-04).
 */
export default function LeadForm({
  sources,
  layout,
  customFields,
}: {
  sources: SourceOption[];
  /** The shown fields, in order (lib/leads/formLayout.ts). */
  layout: LayoutField[];
  /** The workspace's active custom fields. */
  customFields: LeadField[];
}) {
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
  // Custom field values as typed, by key; '' is none.
  const [custom, setCustom] = useState<Record<string, string>>({});
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
          custom: Object.fromEntries(Object.entries(custom).filter(([, value]) => value.trim())),
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

  /** A plain text field of the form. */
  const text = (
    name: string,
    label: string,
    value: string,
    set: (v: string) => void,
    extra: { type?: string; placeholder?: string } = {},
  ) => (
    <Field label={label} htmlFor={name} error={fieldErrors[name]}>
      <input
        id={name}
        name={name}
        className="lf-input"
        {...extra}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          clear(name);
        }}
      />
    </Field>
  );

  const blocks: Record<LeadFormKey, React.ReactNode> = {
    email: text('email', 'Email', email, setEmail, { type: 'email' }),
    phone: (
      <>
        {text('phone', 'Phone', phone, setPhone)}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input
            type="checkbox"
            name="phoneIsWhatsapp"
            checked={phoneIsWhatsapp}
            onChange={(e) => setPhoneIsWhatsapp(e.target.checked)}
          />
          On WhatsApp
        </label>
      </>
    ),
    company: text('company', 'Company', company, setCompany),
    jobTitle: text('jobTitle', 'Job title', jobTitle, setJobTitle),
    country: text('country', 'Country', country, setCountry),
    city: text('city', 'City', city, setCity),
    nationality: text('nationality', 'Nationality', nationality, setNationality),
    source: (
      <>
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
      </>
    ),
    campaignName: text('campaignName', 'Campaign', campaignName, setCampaignName, {
      placeholder: 'e.g. Marina launch',
    }),
    tags: text('tags', 'Tags', tags, setTags, { placeholder: 'Comma-separated, e.g. vip, investor' }),
    priority: (
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
    ),
    // Added on the lead page, once the lead exists.
    otherNumbers: null,
  };

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

      {layout.map((field) => (
        <Fragment key={field.key}>{blocks[field.key]}</Fragment>
      ))}

      {customFields.map((field) => {
        const name = `custom.${field.key}`;
        return (
          <Field
            key={field.key}
            label={field.label}
            htmlFor={name}
            required={field.isRequired}
            error={fieldErrors[name]}
          >
            <CustomFieldInput
              id={name}
              field={field}
              value={custom[field.key] ?? ''}
              onChange={(value) => {
                setCustom((current) => ({ ...current, [field.key]: value }));
                clear(name);
              }}
            />
          </Field>
        );
      })}

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
