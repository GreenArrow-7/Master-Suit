'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Field from '@/components/forms/Field';
import { FIELD_LABELS, LEAD_FIELDS } from '@/lib/leads/importMapping';

type Category = 'OPEN' | 'CONVERSION' | 'TERMINAL_NEGATIVE' | 'TERMINAL_JUNK';

interface StageRow {
  id: string;
  key: string;
  name: string;
  category: Category;
  isDefault: boolean;
  slaMinutes: number | null;
  position: number;
  requiresReason: boolean;
  reasons: string[];
  requiredFields: string[];
  leads: number;
}

const CATEGORIES: [Category, string][] = [
  ['OPEN', 'Open'],
  ['CONVERSION', 'Won'],
  ['TERMINAL_NEGATIVE', 'Lost'],
  ['TERMINAL_JUNK', 'Junk'],
];
/** The name is always there; these may be required before a lead enters a stage. */
const FIELDS = LEAD_FIELDS.filter((field) => field !== 'fullName');

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the server. Nothing was saved.');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
  }
}

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const run = async (write: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await write();
      setMessage({ text: done });
      router.refresh();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
    setBusy(false);
  };
  const note = message && (
    <p className={message.error ? 'lf-hint lf-hint--error' : 'lf-hint'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  );
  return { busy, run, note };
}

export default function StageEditor({
  workspaceSlug,
  canEdit,
  stages,
}: {
  workspaceSlug: string;
  canEdit: boolean;
  stages: StageRow[];
}) {
  const api = `/api/v1/workspaces/${workspaceSlug}/sales/stages`;
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      {stages.map((stage) => (
        <StageCard key={stage.id} stage={stage} api={api} canEdit={canEdit} />
      ))}
      {canEdit && <NewStage api={api} position={stages.length + 1} />}
    </div>
  );
}

function StageCard({ stage, api, canEdit }: { stage: StageRow; api: string; canEdit: boolean }) {
  const { busy, run, note } = useRun();
  const [form, setForm] = useState({
    name: stage.name,
    category: stage.category,
    sla: stage.slaMinutes ? String(stage.slaMinutes) : '',
    position: String(stage.position),
    requiresReason: stage.requiresReason,
    reasons: stage.reasons.join(', '),
    requiredFields: stage.requiredFields,
  });
  const id = (field: string) => `${stage.id}-${field}`;
  const url = `${api}?id=${stage.id}`;

  const save = () =>
    run(
      () =>
        send(url, 'PATCH', {
          name: form.name.trim(),
          category: form.category,
          slaMinutes: form.sla ? Number(form.sla) : null,
          position: Number(form.position) || 0,
          requiresReason: form.requiresReason,
          reasons: form.reasons
            .split(',')
            .map((reason) => reason.trim())
            .filter(Boolean),
          requiredFields: form.requiredFields,
        }),
      'Saved.',
    );

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)' }} aria-label={`Stage ${stage.name}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{stage.name}</strong>
        {stage.isDefault && <Badge tone="viridian">New leads land here</Badge>}
        <Badge tone="slate">
          {stage.leads} lead{stage.leads === 1 ? '' : 's'}
        </Badge>
      </div>

      <fieldset
        disabled={!canEdit || busy}
        style={{
          border: 0,
          padding: 0,
          margin: 'var(--lf-space-3) 0 0',
          display: 'grid',
          gap: 'var(--lf-space-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <Field label="Name" htmlFor={id('name')}>
          <input
            id={id('name')}
            className="lf-input"
            value={form.name}
            maxLength={80}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Kind" htmlFor={id('category')}>
          <select
            id={id('category')}
            className="lf-input"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
          >
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order" htmlFor={id('position')}>
          <input
            id={id('position')}
            className="lf-input"
            type="number"
            min={0}
            max={100}
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
          />
        </Field>
        <Field label="Respond within (minutes)" htmlFor={id('sla')}>
          <input
            id={id('sla')}
            className="lf-input"
            type="number"
            min={1}
            max={43200}
            placeholder="No limit"
            value={form.sla}
            onChange={(e) => setForm((f) => ({ ...f, sla: e.target.value }))}
          />
        </Field>
        <Field label="Reasons, comma-separated" htmlFor={id('reasons')}>
          <input
            id={id('reasons')}
            className="lf-input"
            placeholder="e.g. Budget, Bought elsewhere"
            value={form.reasons}
            onChange={(e) => setForm((f) => ({ ...f, reasons: e.target.value }))}
          />
        </Field>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input
            type="checkbox"
            checked={form.requiresReason}
            onChange={(e) => setForm((f) => ({ ...f, requiresReason: e.target.checked }))}
          />
          A reason is required to enter it
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="lf-label">Must be filled before a lead enters it</div>
          <div style={{ display: 'flex', gap: 'var(--lf-space-3)', flexWrap: 'wrap', marginTop: 4 }}>
            {FIELDS.map((field) => (
              <label
                key={field}
                style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}
              >
                <input
                  type="checkbox"
                  checked={form.requiredFields.includes(field)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      requiredFields: e.target.checked
                        ? [...f.requiredFields, field]
                        : f.requiredFields.filter((x) => x !== field),
                    }))
                  }
                />
                {FIELD_LABELS[field]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--lf-space-3)' }}>
          <button className="lf-btn lf-btn--sm" disabled={busy || !form.name.trim()} onClick={save}>
            Save
          </button>
          {!stage.isDefault && (
            <button
              className="lf-btn lf-btn--secondary lf-btn--sm"
              disabled={busy}
              onClick={() => run(() => send(url, 'PATCH', { isDefault: true }), 'New leads now land here.')}
            >
              Make default
            </button>
          )}
          {!stage.isDefault && stage.leads === 0 && (
            <button
              className="lf-btn lf-btn--ghost lf-btn--sm"
              disabled={busy}
              onClick={() =>
                window.confirm(`Remove the stage ${stage.name}?`) && run(() => send(url, 'DELETE'), 'Removed.')
              }
            >
              Remove
            </button>
          )}
        </div>
      )}
      {note}
    </section>
  );
}

function NewStage({ api, position }: { api: string; position: number }) {
  const { busy, run, note } = useRun();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('OPEN');
  // The key is the stable name automations and reports use; derived, not typed.
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return (
    <form
      className="lf-card"
      style={{ padding: 'var(--lf-space-4)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await send(api, 'POST', { key, name: name.trim(), category, position });
          setName('');
        }, 'Added.');
      }}
    >
      <Field label="New stage" htmlFor="new-stage-name">
        <input
          id="new-stage-name"
          className="lf-input"
          required
          maxLength={80}
          placeholder="e.g. Viewing booked"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Kind" htmlFor="new-stage-category">
        <select
          id="new-stage-category"
          className="lf-input"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <button className="lf-btn lf-btn--sm" disabled={busy || key.length < 2}>
        Add stage
      </button>
      <div style={{ flexBasis: '100%' }}>{note}</div>
    </form>
  );
}
