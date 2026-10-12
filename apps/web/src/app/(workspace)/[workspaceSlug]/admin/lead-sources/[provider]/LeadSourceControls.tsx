'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** The API's own words for a refusal, or that it could not be reached. */
async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the server. Nothing was saved.');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
  }
}

/** Rows of sender field → lead field, saved whole (M6-20). */
export function FieldMapEditor({
  provider,
  canEdit,
  initial,
  fields,
}: {
  provider: string;
  canEdit: boolean;
  initial: [string, string][];
  fields: { value: string; label: string }[];
}) {
  const router = useRouter();
  const blank = (): [string, string] => ['', fields[0]!.value];
  const [rows, setRows] = useState<[string, string][]>(initial.length ? initial : [blank()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const set = (i: number, row: [string, string]) => setRows(rows.map((r, j) => (j === i ? row : r)));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const fieldMap = Object.fromEntries(
        rows.filter(([key]) => key.trim()).map(([key, field]) => [key.trim(), field]),
      );
      await send(`/api/v1/integrations/${provider}`, 'PATCH', { fieldMap });
      setMessage({ text: 'Saved. New deliveries, and any you replay, are read with this mapping.' });
      router.refresh();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
    setBusy(false);
  }

  return (
    <section className="lf-card" style={{ padding: 18 }}>
      <p className="lf-hint" style={{ marginTop: 0, marginBottom: 'var(--lf-space-4)' }}>
        Without a mapping, a delivery is read for name, first_name, last_name, phone, mobile, email, message and
        source_detail, and the portals’ own field names. Map any other field the sender uses here; a field inside
        another is parent.field. A mapped name or phone is the only one read: any other the delivery carries is set
        aside.
      </p>
      <div className="lf-stack" style={{ ['--lf-stack-gap' as string]: '12px' } as React.CSSProperties}>
        {rows.map(([key, field], i) => (
          <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="lf-field" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label className="lf-label" htmlFor={`map-key-${i}`}>
                Sender field
              </label>
              <input
                id={`map-key-${i}`}
                className="lf-input"
                value={key}
                placeholder="e.g. mobile_no"
                autoComplete="off"
                disabled={!canEdit}
                onChange={(e) => set(i, [e.target.value, field])}
              />
            </div>
            <div className="lf-field" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label className="lf-label" htmlFor={`map-field-${i}`}>
                Lead field
              </label>
              <select
                id={`map-field-${i}`}
                className="lf-input"
                value={field}
                disabled={!canEdit}
                onChange={(e) => set(i, [key, e.target.value])}
              >
                {fields.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            {canEdit && (
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            onClick={() => setRows([...rows, blank()])}
          >
            Add a field
          </button>
          <button type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      )}
      {message && (
        <p className={message.error ? 'lf-hint lf-hint--error' : 'lf-hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/** Queue a stored delivery again (M6-21). */
export function ReplayButton({ provider, id }: { provider: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function replay() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/v1/integrations/${provider}/deliveries`, 'POST', { id });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={replay}>
        {busy ? 'Replaying…' : 'Replay'}
      </button>
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
