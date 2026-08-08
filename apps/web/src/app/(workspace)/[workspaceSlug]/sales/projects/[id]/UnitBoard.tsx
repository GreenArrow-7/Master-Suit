'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';

interface Unit {
  id: string;
  tower: string | null;
  floor: number | null;
  unitNumber: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'SOLD' | 'BLOCKED';
  price: string | null;
  currency: string;
  areaSqft: number | null;
  facing: string | null;
  heldUntil: string | null;
  unitPlan: { id: string; name: string; unitType: string } | null;
}

const TONE: Record<Unit['status'], 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  AVAILABLE: 'viridian',
  HELD: 'brass',
  BOOKED: 'vermillion',
  SOLD: 'slate',
  BLOCKED: 'slate',
};

/** Mirrors the server state machine so the UI offers only legal moves. */
const NEXT: Record<Unit['status'], Unit['status'][]> = {
  AVAILABLE: ['HELD', 'BLOCKED'],
  HELD: ['AVAILABLE', 'BLOCKED'],
  BOOKED: ['SOLD', 'AVAILABLE'],
  SOLD: [],
  BLOCKED: ['AVAILABLE'],
};

/**
 * Live inventory for one project.
 *
 * Painted from the server with the rest of the page, then refetched on demand.
 * An effect that fetched on mount would flash an empty board on every open —
 * and this is the section a salesperson looks at first on a call.
 *
 * It is still a client component, because it is the one section that goes stale
 * while you are looking at it: after a hold, and on Refresh, it reloads.
 *
 * BOOKED is not offered as a move from AVAILABLE even though the server permits
 * it, because booking a unit means naming the buyer, and that belongs to the
 * booking flow in M9 rather than to a dropdown that would have to invent a lead
 * picker to be honest about it.
 */
export default function UnitBoard({
  projectId,
  canEdit,
  initialUnits,
}: {
  projectId: string;
  canEdit: boolean;
  initialUnits: Unit[];
}) {
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/units?limit=500`);
      if (!res.ok) throw new Error('load failed');
      setUnits((await res.json()).data ?? []);
    } catch {
      setError('Could not load inventory.');
    }
  }

  async function move(unit: Unit, to: Unit['status']) {
    setBusyId(unit.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.errors?.[0]?.message ?? data.detail ?? 'That change was refused.');
        return;
      }
      // Reloaded rather than patched in place: a refusal elsewhere in the tower
      // means somebody else is moving units too, and a stale board is how two
      // people hold the same flat.
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          Inventory
        </h2>
        <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && (
        <p className="lf-hint lf-hint--error" role="alert">
          {error}
        </p>
      )}

      {units.length === 0 ? (
        <p className="lf-hint" style={{ margin: 0 }}>
          No units have been entered for this project yet.
        </p>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Plan</th>
                <th style={{ textAlign: 'right' }}>Area</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th>Status</th>
                {canEdit && <th>Move</th>}
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>
                    {u.tower ? `${u.tower} · ` : ''}
                    {u.unitNumber}
                  </td>
                  <td>{u.unitPlan ? `${u.unitPlan.name} (${u.unitPlan.unitType})` : '—'}</td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {u.areaSqft ? u.areaSqft.toLocaleString('en-GB') : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {u.price ? `${u.currency} ${Number(u.price).toLocaleString('en-AE')}` : '—'}
                  </td>
                  <td>
                    <Badge value={u.status} tone={TONE[u.status]} />
                    {u.status === 'HELD' && u.heldUntil && (
                      <span className="lf-hint" style={{ marginLeft: 6 }}>
                        until {new Date(u.heldUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        {NEXT[u.status].map((to) => (
                          <button
                            key={to}
                            type="button"
                            className="lf-btn lf-btn--secondary lf-btn--sm"
                            disabled={busyId !== null}
                            onClick={() => void move(u, to)}
                          >
                            {to === 'AVAILABLE' ? 'Release' : to.charAt(0) + to.slice(1).toLowerCase()}
                          </button>
                        ))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
