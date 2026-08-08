'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Plan {
  code: string;
  name: string;
}

export interface WorkspaceEditValues {
  workspaceName: string;
  legalName: string;
  displayName: string;
  industry: string;
  country: string;
  timezone: string;
  currency: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  logoUrl: string;
  planCode: string;
  modules: string[];
  maxUsers: string;
  maxEmployees: string;
  maxStorageMb: string;
  trialStartedAt: string;
  trialEndsAt: string;
}

/**
 * Everything `PATCH /api/v1/platform/workspaces/[id]` has always accepted.
 *
 * The endpoint took plan, modules, seat and storage limits and trial dates from
 * the day it was written; the only interface to it was four buttons that sent
 * `status` and `revokeSessions`. So a customer upgrading their plan, adding a
 * module or buying seats needed a developer with a REST client — the backend
 * work was done and simply unreachable.
 */
export default function WorkspaceEditForm({
  workspaceId,
  plans,
  initial,
}: {
  workspaceId: string;
  plans: Plan[];
  initial: WorkspaceEditValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const set = <K extends keyof WorkspaceEditValues>(key: K, value: WorkspaceEditValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  function toggleModule(module: string) {
    setValues((current) => ({
      ...current,
      modules: current.modules.includes(module)
        ? current.modules.filter((item) => item !== module)
        : [...current.modules, module],
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (values.modules.length === 0) {
      setMessage({
        tone: 'error',
        text: 'A workspace needs at least one module. Suspend it instead if that is the intent.',
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/platform/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceName: values.workspaceName,
          legalName: values.legalName,
          displayName: values.displayName,
          industry: values.industry || null,
          country: values.country,
          timezone: values.timezone,
          currency: values.currency,
          companyEmail: values.companyEmail || null,
          companyPhone: values.companyPhone || null,
          companyAddress: values.companyAddress || null,
          logoUrl: values.logoUrl || null,
          planCode: values.planCode,
          enabledModules: values.modules,
          // Empty means "no limit", which the API models as null rather than 0.
          maxUsers: values.maxUsers ? Number(values.maxUsers) : null,
          maxEmployees: values.maxEmployees ? Number(values.maxEmployees) : null,
          maxStorageMb: values.maxStorageMb ? Number(values.maxStorageMb) : null,
          trialStartedAt: values.trialStartedAt || null,
          trialEndsAt: values.trialEndsAt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.detail ?? 'That change was refused.' });
        return;
      }
      setMessage({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-card" style={{ padding: 18, display: 'grid', gap: 'var(--lf-space-5)' }}>
      {message && (
        <div className="lf-alert" role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      <Section title="Subscription">
        <Field label="Plan">
          <select
            className="lf-input"
            value={values.planCode}
            onChange={(event) => set('planCode', event.target.value)}
          >
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          <legend className="lf-label" style={{ padding: 0 }}>
            Modules
          </legend>
          {[
            ['HRMS', 'People'],
            ['SALES', 'Sales CRM'],
          ].map(([value, label]) => (
            <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
              <input type="checkbox" checked={values.modules.includes(value)} onChange={() => toggleModule(value)} />
              {label}
            </label>
          ))}
          <span className="lf-hint">
            Removing a module cancels its entitlement — the workspace loses those screens and APIs immediately.
          </span>
        </fieldset>
      </Section>

      <Section title="Limits">
        <Field label="Maximum users" hint="Blank means no limit.">
          <input
            className="lf-input"
            type="number"
            min={1}
            value={values.maxUsers}
            onChange={(event) => set('maxUsers', event.target.value)}
          />
        </Field>
        <Field label="Maximum employees" hint="Blank means no limit.">
          <input
            className="lf-input"
            type="number"
            min={1}
            value={values.maxEmployees}
            onChange={(event) => set('maxEmployees', event.target.value)}
          />
        </Field>
        <Field label="Storage (MB)" hint="Blank means no limit.">
          <input
            className="lf-input"
            type="number"
            min={1}
            value={values.maxStorageMb}
            onChange={(event) => set('maxStorageMb', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Trial">
        <Field label="Trial starts">
          <input
            className="lf-input"
            type="date"
            value={values.trialStartedAt}
            onChange={(event) => set('trialStartedAt', event.target.value)}
          />
        </Field>
        <Field label="Trial ends">
          <input
            className="lf-input"
            type="date"
            value={values.trialEndsAt}
            onChange={(event) => set('trialEndsAt', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Company profile">
        <Field label="Workspace name">
          <input
            className="lf-input"
            value={values.workspaceName}
            onChange={(event) => set('workspaceName', event.target.value)}
          />
        </Field>
        <Field label="Display name">
          <input
            className="lf-input"
            value={values.displayName}
            onChange={(event) => set('displayName', event.target.value)}
          />
        </Field>
        <Field label="Legal name">
          <input
            className="lf-input"
            value={values.legalName}
            onChange={(event) => set('legalName', event.target.value)}
          />
        </Field>
        <Field label="Industry">
          <input
            className="lf-input"
            value={values.industry}
            onChange={(event) => set('industry', event.target.value)}
          />
        </Field>
        <Field label="Country" hint="Two-letter code.">
          <input
            className="lf-input"
            maxLength={2}
            value={values.country}
            onChange={(event) => set('country', event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Time zone">
          <input
            className="lf-input"
            value={values.timezone}
            onChange={(event) => set('timezone', event.target.value)}
          />
        </Field>
        <Field label="Currency" hint="Three-letter code.">
          <input
            className="lf-input"
            maxLength={3}
            value={values.currency}
            onChange={(event) => set('currency', event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Company email">
          <input
            className="lf-input"
            type="email"
            value={values.companyEmail}
            onChange={(event) => set('companyEmail', event.target.value)}
          />
        </Field>
        <Field label="Company phone">
          <input
            className="lf-input"
            value={values.companyPhone}
            onChange={(event) => set('companyPhone', event.target.value)}
          />
        </Field>
        <Field label="Address">
          <input
            className="lf-input"
            value={values.companyAddress}
            onChange={(event) => set('companyAddress', event.target.value)}
          />
        </Field>
        <Field label="Logo URL">
          <input
            className="lf-input"
            type="url"
            value={values.logoUrl}
            onChange={(event) => set('logoUrl', event.target.value)}
          />
        </Field>
      </Section>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-md)', margin: 0 }}>
        {title}
      </h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="lf-field">
      <span className="lf-label">{label}</span>
      {children}
      {hint && <span className="lf-hint">{hint}</span>}
    </label>
  );
}
