'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

const steps = ['Company details', 'Administrator', 'Subscription', 'Modules', 'Review'];

export default function NewWorkspaceForm({ plans }: { plans: { code: string; name: string; modules: string[] }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, FormDataEntryValue>>({});
  const [created, setCreated] = useState<{ id: string; slug: string; displayName: string } | null>(null);

  function move(next: number) {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step-panel="${step}"]`);
    const controls = [...(panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? [])];
    const invalid = controls.find((control) => !control.checkValidity());
    if (next > step && invalid) {
      invalid.reportValidity();
      return;
    }
    if (next === 5 && formRef.current) setSummary(Object.fromEntries(new FormData(formRef.current).entries()));
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError(null);
    const form = new FormData(formElement);
    /**
     * Empty optional fields are dropped, not sent as "".
     *
     * An untouched input still appears in FormData with an empty string, and
     * `companyEmail` is `z.string().email().optional()` — so leaving the
     * optional Company email blank failed the whole submission with
     * "Validation failed" and no indication of which field was at fault.
     * WorkspaceRecordForm already filters the same way.
     */
    const body = Object.fromEntries([...form.entries()].filter(([, value]) => value !== ''));
    try {
      const response = await fetch('/api/v1/platform/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          enabledModules: form.getAll('enabledModules'),
          maxEmployees: Number(body.maxEmployees),
          maxUsers: Number(body.maxUsers),
          maxStorageMb: Number(body.maxStorageMb),
          trialStartDate: body.trialStartDate || null,
          trialEndDate: body.trialEndDate || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.detail ?? data.title ?? 'The workspace could not be created. Check the fields and try again.');
        return;
      }
      setCreated(data.workspace);
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <section className="lf-form-section" aria-live="polite">
        <div
          className="lf-empty__mark"
          style={{
            margin: 0,
            color: 'var(--lf-viridian)',
            background: 'var(--lf-viridian-sub)',
            borderColor: 'var(--lf-viridian)',
          }}
        >
          ✓
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Workspace created</h2>
          <p style={{ color: 'var(--lf-ink-3)', marginBottom: 0 }}>
            {created.displayName} is ready and its administrator account has been provisioned.
          </p>
        </div>
        <WorkspaceSummary
          rows={[
            ['Workspace URL', `http://localhost:3000/${created.slug}/dashboard`],
            ['Administrator invitation', 'Account created'],
            ['Workspace ID', created.id],
          ]}
        />
        <div className="lf-page-actions" style={{ justifyContent: 'flex-start' }}>
          <Link className="lf-btn" href={`/${created.slug}/dashboard`}>
            Open workspace
          </Link>
          <Link className="lf-btn lf-btn--secondary" href={`/platform/workspaces/${created.id}`}>
            View workspace details
          </Link>
        </div>
      </section>
    );

  return (
    <form ref={formRef} onSubmit={submit} className="lf-page-stack" noValidate>
      <ol className="lf-wizard-steps" aria-label="Workspace creation progress">
        {steps.map((label, index) => (
          <li className="lf-wizard-step" data-active={step === index + 1} key={label}>
            <span>Step {index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <section className="lf-form-section" data-step-panel="1" hidden={step !== 1}>
        <SectionHeading
          title="Company details"
          description="Set the legal identity, regional defaults and workspace address."
        />
        <div className="lf-form-grid">
          <Field label="Workspace name" name="workspaceName" placeholder="Manath Homes" required />
          <Field label="Display name" name="displayName" required />
          <Field label="Legal name" name="legalName" required />
          <Field
            label="Workspace slug"
            name="slug"
            hint="Lowercase letters, numbers and hyphens."
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <Field label="Industry" name="industry" />
          <Field label="Company size" name="companySize" placeholder="51–200" />
          <Field label="Country code" name="country" defaultValue="AE" maxLength={2} required />
          <Field label="Timezone" name="timezone" defaultValue="Asia/Dubai" required />
          <Field label="Currency" name="currency" defaultValue="AED" maxLength={3} required />
          <Field label="Company logo URL" name="logoUrl" type="url" />
          <Field label="Company email" name="companyEmail" type="email" />
          <Field label="Company phone" name="companyPhone" />
          <label className="lf-field" style={{ gridColumn: '1 / -1' }}>
            <span className="lf-label">Company address</span>
            <textarea className="lf-textarea" name="companyAddress" rows={3} />
          </label>
        </div>
        <StepActions step={step} onMove={move} />
      </section>

      <section className="lf-form-section" data-step-panel="2" hidden={step !== 2}>
        <SectionHeading
          title="Primary administrator"
          description="Create the first company administrator and secure their initial access."
        />
        <div className="lf-form-grid">
          <Field label="Administrator name" name="primaryAdminName" required />
          <Field label="Administrator email" name="primaryAdminEmail" type="email" required />
          <Field
            label="Initial password"
            name="primaryAdminPassword"
            type="password"
            minLength={16}
            hint="Use at least 16 characters. The administrator can change it after login."
            required
          />
        </div>
        <div className="lf-alert" data-tone="brass">
          Multi-factor authentication can be enabled from the workspace Security page after first sign-in.
        </div>
        <StepActions step={step} onMove={move} />
      </section>

      <section className="lf-form-section" data-step-panel="3" hidden={step !== 3}>
        <SectionHeading
          title="Subscription and limits"
          description="Choose the commercial plan, access period and capacity limits."
        />
        <label className="lf-field">
          <span className="lf-label">Plan</span>
          <select className="lf-input" name="planCode" required defaultValue={plans[0]?.code}>
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name} · {plan.modules.join(' + ')}
              </option>
            ))}
          </select>
        </label>
        <div className="lf-form-grid">
          <Field label="Maximum employees" name="maxEmployees" type="number" defaultValue="100" min="1" required />
          <Field label="Maximum users" name="maxUsers" type="number" defaultValue="100" min="1" required />
          <Field label="Storage limit (MB)" name="maxStorageMb" type="number" defaultValue="10240" min="1" required />
          <label className="lf-field">
            <span className="lf-label">Workspace status</span>
            <select className="lf-input" name="status" defaultValue="ACTIVE">
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </label>
          <Field label="Trial start" name="trialStartDate" type="date" />
          <Field label="Trial end" name="trialEndDate" type="date" />
        </div>
        <StepActions step={step} onMove={move} />
      </section>

      <section className="lf-form-section" data-step-panel="4" hidden={step !== 4}>
        <SectionHeading
          title="Enabled modules"
          description="Choose the products this workspace can access. Entitlements are enforced server-side."
        />
        <div className="lf-form-grid">
          <ModuleChoice
            name="enabledModules"
            value="SALES"
            title="Sales"
            description="Leads, opportunities, accounts, activities, campaigns and reporting."
          />
          <ModuleChoice
            name="enabledModules"
            value="HRMS"
            title="People / HRMS"
            description="Employees, attendance, leave, shifts, documents and organisation."
          />
        </div>
        <StepActions step={step} onMove={move} />
      </section>

      <section className="lf-form-section" data-step-panel="5" hidden={step !== 5}>
        <SectionHeading
          title="Review workspace"
          description="Confirm the company, administrator, subscription and modules before provisioning."
        />
        <WorkspaceSummary
          rows={[
            ['Company', String(summary.displayName ?? summary.workspaceName ?? '—')],
            ['Workspace URL', `http://localhost:3000/${String(summary.slug ?? '')}/dashboard`],
            ['Administrator', `${String(summary.primaryAdminName ?? '')} · ${String(summary.primaryAdminEmail ?? '')}`],
            ['Plan', plans.find((plan) => plan.code === summary.planCode)?.name ?? String(summary.planCode ?? '—')],
            [
              'Limits',
              `${String(summary.maxEmployees ?? '—')} employees · ${String(summary.maxUsers ?? '—')} users · ${String(summary.maxStorageMb ?? '—')} MB`,
            ],
            [
              'Region',
              `${String(summary.country ?? '—')} · ${String(summary.timezone ?? '—')} · ${String(summary.currency ?? '—')}`,
            ],
          ]}
        />
        <StepActions step={step} onMove={move} busy={busy} />
      </section>
    </form>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="lf-form-section__heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function StepActions({ step, onMove, busy }: { step: number; onMove: (next: number) => void; busy?: boolean }) {
  return (
    <div className="lf-page-actions">
      {step > 1 && (
        <button type="button" className="lf-btn lf-btn--secondary" onClick={() => onMove(step - 1)}>
          Back
        </button>
      )}
      {step < 5 ? (
        <button type="button" className="lf-btn" onClick={() => onMove(step + 1)}>
          Continue
        </button>
      ) : (
        /**
         * Never type="submit".
         *
         * React reconciles these two branches onto the same DOM node — same
         * element type, same position — and mutates it in place rather than
         * replacing it. So the click that advanced step 4 to step 5 ran its
         * handler, React synchronously turned that very node into a submit
         * button, and the browser then applied the submit default action to it.
         * One click on "Continue" both reached the review step and provisioned
         * the workspace, which meant the review step gated nothing at all.
         *
         * A button with no submit default action cannot do that, whatever the
         * reconciler does with it.
         */
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      )}
    </div>
  );
}

function ModuleChoice({
  name,
  value,
  title,
  description,
}: {
  name: string;
  value: string;
  title: string;
  description: string;
}) {
  return (
    <label className="lf-card" style={{ display: 'flex', gap: 12, padding: 16, cursor: 'pointer' }}>
      <input type="checkbox" name={name} value={value} defaultChecked />
      <span>
        <strong style={{ display: 'block', fontSize: 13 }}>{title}</strong>
        <span style={{ display: 'block', marginTop: 4, color: 'var(--lf-ink-3)', fontSize: 11 }}>{description}</span>
      </span>
    </label>
  );
}

function WorkspaceSummary({ rows }: { rows: [string, string][] }) {
  return (
    <div className="lf-table-wrap">
      <table className="lf-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" style={{ width: 180 }}>
                {label}
              </th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  const { label, hint, ...inputProps } = props;
  return (
    <label className="lf-field">
      <span className="lf-label">{label}</span>
      <input className="lf-input" {...inputProps} />
      {hint && <span className="lf-hint">{hint}</span>}
    </label>
  );
}
