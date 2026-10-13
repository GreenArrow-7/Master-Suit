'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Field from '@/components/forms/Field';
import { send, useRun } from '@/components/forms/useRun';

interface Entry {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  /** The points a new lead from this entry starts with (M4-11). */
  weight: number;
  /** Of the leads the viewer may see; null without `leads:VIEW`. */
  leads: number | null;
}

const API = '/api/v1/lead-sources';

export default function SourceEditor({ canEdit, entries }: { canEdit: boolean; entries: Entry[] }) {
  const parents = entries.filter((entry) => !entry.parentId);
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      {parents.map((parent) => (
        <section
          key={parent.id}
          className="lf-card"
          style={{ padding: 'var(--lf-space-4)' }}
          aria-label={`Source ${parent.name}`}
        >
          <EntryRow entry={parent} canEdit={canEdit} heading />
          <ul
            style={{
              listStyle: 'none',
              margin: 'var(--lf-space-3) 0 0',
              padding: '0 0 0 var(--lf-space-4)',
              display: 'grid',
              gap: 'var(--lf-space-2)',
              borderLeft: '2px solid var(--lf-line)',
            }}
          >
            {entries
              .filter((entry) => entry.parentId === parent.id)
              .map((child) => (
                <li key={child.id}>
                  <EntryRow entry={child} canEdit={canEdit} />
                </li>
              ))}
            {canEdit && (
              <li>
                <NewEntry
                  parentId={parent.id}
                  label={`Add a sub-source to ${parent.name}`}
                  placeholder="e.g. Marina campaign"
                />
              </li>
            )}
          </ul>
        </section>
      ))}
      {canEdit && <NewEntry label="New source" placeholder="e.g. Channel partner" card />}
    </div>
  );
}

function EntryRow({ entry, canEdit, heading }: { entry: Entry; canEdit: boolean; heading?: boolean }) {
  const { busy, run, note } = useRun();
  const [name, setName] = useState(entry.name);
  const [isActive, setIsActive] = useState(entry.isActive);
  const [weight, setWeight] = useState(String(entry.weight));
  const points = Math.min(100, Math.max(0, Math.round(Number(weight) || 0)));
  const dirty = name.trim() !== entry.name || isActive !== entry.isActive || points !== entry.weight;
  const leads = entry.leads === null ? null : `${entry.leads} lead${entry.leads === 1 ? '' : 's'}`;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {canEdit ? (
        <input
          className="lf-input"
          aria-label={heading ? `Source ${entry.name}` : `Sub-source ${entry.name}`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0, fontWeight: heading ? 600 : undefined }}
        />
      ) : (
        <span style={{ flex: '1 1 160px', fontWeight: heading ? 600 : undefined }}>{entry.name}</span>
      )}
      {leads && <Badge tone="slate">{leads}</Badge>}
      {canEdit ? (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          Starts at
          <input
            className="lf-input"
            type="number"
            min={0}
            max={100}
            aria-label={`Starting score for ${entry.name}`}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            style={{ width: 64 }}
          />
        </label>
      ) : (
        entry.weight > 0 && <Badge tone="slate">{`Starts at ${entry.weight}`}</Badge>
      )}
      {canEdit ? (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Offered on the form
        </label>
      ) : (
        !entry.isActive && <Badge tone="slate">Not offered</Badge>
      )}
      {canEdit && (
        <button
          className="lf-btn lf-btn--sm"
          disabled={busy || !dirty || !name.trim()}
          onClick={() =>
            run(() => send(`${API}?id=${entry.id}`, 'PATCH', { name: name.trim(), isActive, weight: points }), 'Saved.')
          }
        >
          Save
        </button>
      )}
      {note && <div style={{ flexBasis: '100%' }}>{note}</div>}
    </div>
  );
}

function NewEntry({
  parentId,
  label,
  placeholder,
  card,
}: {
  parentId?: string;
  label: string;
  placeholder: string;
  card?: boolean;
}) {
  const { busy, run, note } = useRun();
  const [name, setName] = useState('');
  const id = `new-source-${parentId ?? 'root'}`;
  return (
    <form
      className={card ? 'lf-card' : undefined}
      style={{
        padding: card ? 'var(--lf-space-4)' : 0,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await send(API, 'POST', { name: name.trim(), ...(parentId && { parentId }) });
          setName('');
        }, 'Added.');
      }}
    >
      <Field label={label} htmlFor={id}>
        <input
          id={id}
          className="lf-input"
          required
          maxLength={80}
          placeholder={placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !name.trim()}>
        Add
      </button>
      {note && <div style={{ flexBasis: '100%' }}>{note}</div>}
    </form>
  );
}
