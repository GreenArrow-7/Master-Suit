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

/**
 * What the call found, and — when there is something there — the lead. Each
 * outcome picked is a logged call (M5-06); a redial that finds the same again
 * (still not reachable) is logged with Called again, since a select fires nothing
 * when its own value is picked.
 */
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
  const [attached, setAttached] = useState(false);
  const [logged, setLogged] = useState(false);
  const run = async (write: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setLogged(false);
    try {
      await write();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const log = (next: string) =>
    run(async () => {
      try {
        await send(`/api/v1/cold-data/${id}`, { status: next }, 'PATCH');
      } catch (err) {
        setOutcome(status);
        throw err;
      }
      // Not contacted is the reset, not a call.
      setLogged(next !== 'NOT_CONTACTED');
      router.refresh();
    });

  if (convertedLeadId) return <SalesLink href={`/leads/${convertedLeadId}`}>Converted — open the lead</SalesLink>;
  // The page passes no id when the viewer cannot open the lead.
  if (status === 'CONVERTED') return <span className="lf-hint">Converted — the lead is not yours to open</span>;
  // No refresh: converted rows leave the list, and the sentence would go with them.
  if (attached)
    return (
      <span className="lf-hint" role="status">
        Already a lead you cannot open; the enquiry was added to it.
      </span>
    );
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        className="lf-input"
        aria-label="Outcome"
        value={outcome}
        disabled={!canEdit || busy}
        style={{ fontSize: 'var(--lf-text-sm)', minWidth: 0 }}
        onChange={(e) => {
          setOutcome(e.target.value);
          void log(e.target.value);
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
      {canEdit && outcome !== 'NOT_CONTACTED' && (
        <button className="lf-btn lf-btn--sm" disabled={busy} onClick={() => log(outcome)}>
          Called again
        </button>
      )}
      {canConvert && (
        <button
          className="lf-btn lf-btn--sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { leadId, visible } = await send(`/api/v1/cold-data/${id}/convert`);
              if (visible) router.push(`${base}/leads/${leadId}`);
              else setAttached(true);
            })
          }
        >
          Make lead
        </button>
      )}
      {logged && (
        <span className="lf-hint" role="status">
          Call logged.
        </span>
      )}
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

type Agent = { id: string; fullName: string };

/** Hand a list's unconverted contacts to one agent. */
export function ListAssign({ list, agents }: { list: string; agents: Agent[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <>
      <select
        className="lf-input"
        aria-label={`Assign ${list} to`}
        defaultValue=""
        disabled={busy}
        style={{ fontSize: 'var(--lf-text-sm)', minWidth: 0 }}
        onChange={async (e) => {
          const next = e.target.value;
          setBusy(true);
          setError(null);
          setDone(null);
          try {
            const { assigned } = await send('/api/v1/cold-data/assign', { batch: list, ownerId: next || null });
            setDone(next ? `${assigned} handed to ${nameOf(agents, next)}.` : `${assigned} unassigned.`);
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
      <Outcome done={done} error={error} />
    </>
  );
}

/** Whose record this is; only an assigner sees it, and a converted record keeps its text. */
export function RecordAssign({
  id,
  ownerId,
  ownerName,
  agents,
}: {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  agents: Agent[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Held here so the pick shows at once (same reason as RecordActions' outcome).
  const [owner, setOwner] = useState(ownerId ?? '');
  // A current owner who has left is not in `agents`; without this the control would read Unassigned.
  const known = !ownerId || agents.some((a) => a.id === ownerId);
  return (
    <>
      <select
        className="lf-input"
        aria-label="Agent"
        value={owner}
        disabled={busy}
        style={{ fontSize: 'var(--lf-text-sm)', minWidth: 0 }}
        onChange={async (e) => {
          const next = e.target.value;
          setOwner(next);
          setBusy(true);
          setError(null);
          setDone(null);
          try {
            await send(`/api/v1/cold-data/${id}`, { ownerId: next || null }, 'PATCH');
            setDone(next ? `Handed to ${nameOf(agents, next)}.` : 'Unassigned.');
            router.refresh();
          } catch (err) {
            setOwner(ownerId ?? '');
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <option value="">Unassigned</option>
        {!known && (
          <option value={ownerId!} disabled>
            {ownerName ?? 'Former member'}
          </option>
        )}
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.fullName}
          </option>
        ))}
      </select>
      <Outcome done={done} error={error} />
    </>
  );
}

const nameOf = (agents: Agent[], id: string) => agents.find((a) => a.id === id)?.fullName;

function Outcome({ done, error }: { done: string | null; error: string | null }) {
  return (
    <>
      {done && (
        <span className="lf-hint" role="status">
          {done}
        </span>
      )}
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
