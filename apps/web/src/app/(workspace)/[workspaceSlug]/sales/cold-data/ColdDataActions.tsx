'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink, { useModuleBase } from '@/components/workspace/SalesLink';
import { STATUS_LABEL } from '@/lib/leads/coldDataStatus';

async function send(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the server. Nothing was saved.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
  return data;
}

/** What the call found, and — when there is something there — the lead. */
export function RecordActions({
  id,
  status,
  convertedLeadId,
  canEdit,
  canConvert,
}: {
  id: string;
  status: keyof typeof STATUS_LABEL;
  convertedLeadId: string | null;
  canEdit: boolean;
  canConvert: boolean;
}) {
  const router = useRouter();
  const base = useModuleBase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held here, so the pick shows at once rather than snapping back until the refresh lands.
  const [outcome, setOutcome] = useState<string>(status);
  const run = async (write: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await write();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  if (convertedLeadId) return <SalesLink href={`/leads/${convertedLeadId}`}>Converted — open the lead</SalesLink>;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        className="lf-input"
        aria-label="Outcome"
        value={outcome}
        disabled={!canEdit || busy}
        style={{ fontSize: 'var(--lf-text-sm)', minWidth: 0 }}
        onChange={(e) => {
          const next = e.target.value;
          setOutcome(next);
          void run(async () => {
            try {
              await send(`/api/v1/cold-data/${id}`, { status: next }, 'PATCH');
            } catch (err) {
              setOutcome(status);
              throw err;
            }
            router.refresh();
          });
        }}
      >
        {Object.entries(STATUS_LABEL)
          .filter(([key]) => key !== 'CONVERTED')
          .map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
      </select>
      {canConvert && (
        <button
          className="lf-btn lf-btn--sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { leadId } = await send(`/api/v1/cold-data/${id}/convert`);
              router.push(`${base}/leads/${leadId}`);
            })
          }
        >
          Make lead
        </button>
      )}
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Hand a list's unconverted contacts to one agent. */
export function ListAssign({ list, agents }: { list: string; agents: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        className="lf-input"
        aria-label={`Assign ${list} to`}
        defaultValue=""
        disabled={busy}
        style={{ fontSize: 'var(--lf-text-sm)', minWidth: 0 }}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          try {
            await send('/api/v1/cold-data/assign', { batch: list, ownerId: e.target.value || null });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <option value="">Choose an agent…</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.fullName}
          </option>
        ))}
      </select>
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
