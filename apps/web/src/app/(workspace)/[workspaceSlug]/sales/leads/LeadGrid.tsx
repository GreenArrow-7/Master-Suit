'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import type { ColumnDef } from '@/lib/grid/columns';

export interface LeadRow {
  id: string; reference: string; fullName: string;
  email?: string | null; phone?: string | null; company?: string | null;
  score: number; grade?: string | null; priority: string; slaState: string;
  nextFollowUpAt?: string | Date | null; updatedAt: string | Date;
  ownerId?: string | null;
  stage: { key: string; name: string; color: string };
  owner?: { fullName: string } | null;
}

type SortKey = 'fullName' | 'score' | 'updatedAt' | 'nextFollowUpAt';
const SORTABLE = new Set<string>(['fullName', 'score', 'updatedAt', 'nextFollowUpAt']);

type BulkAction = 'assign' | 'stage' | 'task';

export default function LeadGrid({
  rows, columns, stages, users, taskTypes, canAssign, canEdit,
}: {
  rows: LeadRow[];
  columns: ColumnDef[];
  stages: { id: string; key: string; name: string }[];
  users: { id: string; fullName: string }[];
  taskTypes: { id: string; name: string }[];
  canAssign: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' });
  const [action, setAction] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const allSelected = selected.size > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Runs `send` for every selected lead and reports how many failed. */
  async function run(send: (leadId: string) => Promise<Response>) {
    setBusy(true);
    setError('');
    const ids = [...selected];
    const results = await Promise.all(ids.map((id) => send(id).catch(() => null)));
    const failed = results.filter((res) => !res || !res.ok).length;
    setBusy(false);
    if (failed > 0) {
      setError(`${failed} of ${ids.length} could not be updated.`);
      return;
    }
    setAction(null);
    setSelected(new Set());
    router.refresh();
  }

  const post = (url: string, body: unknown, method = 'POST') =>
    fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function assign(ownerId: string) {
    setBusy(true);
    setError('');
    // A single bulk endpoint, so the assignment history is written in one transaction.
    const res = await post('/api/v1/leads/assign', { leadIds: [...selected], ownerId });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? 'Could not assign the selected leads.');
      return;
    }
    setAction(null);
    setSelected(new Set());
    router.refresh();
  }

  const changeStage = (stageId: string) =>
    run((leadId) => post(`/api/v1/leads/${leadId}`, { stageId }, 'PATCH'));

  const addTask = (form: FormData) =>
    run((leadId) => post('/api/v1/tasks', {
      leadId,
      typeId: String(form.get('typeId')),
      title: String(form.get('title')),
      dueAt: new Date(String(form.get('dueAt'))).toISOString(),
      priority: String(form.get('priority')),
    }));

  function header(column: ColumnDef) {
    const sortable = SORTABLE.has(column.key);
    const active = sortable && sort.key === column.key;
    return (
      <th
        key={column.key}
        className={column.key === 'reference' ? 'lf-sticky' : undefined}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
        onClick={sortable ? () => setSort({ key: column.key as SortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' }) : undefined}
        style={{ textAlign: column.align ?? 'left' }}
      >
        {column.label}
        {active && <span aria-hidden="true" style={{ marginLeft: 4 }}>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
      </th>
    );
  }

  return (
    <>
      {/* Bulk bar appears in place rather than as a floating overlay, so it never
          covers the rows you just selected. */}
      {selected.size > 0 && (
        <div className="lf-toast" style={{ marginBottom: 'var(--lf-space-3)', flexWrap: 'wrap' }} role="status">
          <span className="lf-num">{selected.size}</span> selected
          <span style={{ display: 'flex', gap: 'var(--lf-space-2)', marginLeft: 'auto' }}>
            {canAssign && <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setAction(action === 'assign' ? null : 'assign')}>Assign</button>}
            {canEdit && <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setAction(action === 'stage' ? null : 'stage')}>Change stage</button>}
            {canEdit && <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setAction(action === 'task' ? null : 'task')}>Add task</button>}
            <button className="lf-toast__action" onClick={() => { setSelected(new Set()); setAction(null); }}>Clear</button>
          </span>

          {action && (
            <div style={{ flexBasis: '100%', marginTop: 'var(--lf-space-3)', paddingTop: 'var(--lf-space-3)', borderTop: '1px solid var(--lf-line)' }}>
              {action === 'assign' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  Assign to
                  <select className="lf-input" defaultValue="" disabled={busy}
                          onChange={(event) => event.target.value && assign(event.target.value)}>
                    <option value="" disabled>Choose a user…</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                  </select>
                </label>
              )}

              {action === 'stage' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  Move to stage
                  <select className="lf-input" defaultValue="" disabled={busy}
                          onChange={(event) => event.target.value && changeStage(event.target.value)}>
                    <option value="" disabled>Choose a stage…</option>
                    {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select>
                </label>
              )}

              {action === 'task' && (
                <form
                  onSubmit={(event) => { event.preventDefault(); addTask(new FormData(event.currentTarget)); }}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
                >
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>Title
                    <input className="lf-input" name="title" required maxLength={200} placeholder="Call back" />
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>Type
                    <select className="lf-input" name="typeId" required>
                      {taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>Due
                    <input className="lf-input" name="dueAt" type="datetime-local" required />
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>Priority
                    <select className="lf-input" name="priority" defaultValue="MEDIUM">
                      {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
                    </select>
                  </label>
                  <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
                    {busy ? 'Adding…' : `Add to ${selected.size}`}
                  </button>
                </form>
              )}

              {error && <p style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', margin: '8px 0 0' }}>{error}</p>}
            </div>
          )}
        </div>
      )}

      <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
        <table className="lf-grid">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={allSelected} aria-label="Select all rows"
                       onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
              {columns.map(header)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} aria-selected={selected.has(row.id)}>
                <td>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}
                         aria-label={`Select ${row.fullName}`} />
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={column.key === 'reference' ? 'lf-sticky' : undefined}
                    data-hide-mobile={column.hideMobile ? '' : undefined}
                    style={{ textAlign: column.align ?? 'left' }}
                  >
                    {cell(column.key, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function cell(key: string, row: LeadRow) {
  switch (key) {
    case 'reference':
      return (
        <SalesLink href={`/leads/${row.id}`} style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}>
          {row.reference}
        </SalesLink>
      );
    case 'fullName':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
          <span className="lf-avatar">{row.fullName.split(' ').slice(0, 2).map((p) => p[0]).join('')}</span>
          <SalesLink href={`/leads/${row.id}`} style={{ fontWeight: 500, color: 'var(--lf-ink)' }}>{row.fullName}</SalesLink>
        </span>
      );
    case 'company':
      return <span style={{ color: 'var(--lf-ink-2)' }}>{row.company ?? '—'}</span>;
    case 'stage':
      return <Badge value={row.stage.key}>{row.stage.name}</Badge>;
    case 'score':
      return (
        <span className="lf-score">
          <span className="lf-score__bar"><span className="lf-score__fill" style={{ width: `${row.score}%` }} /></span>
          {row.score}
        </span>
      );
    case 'priority':
      return <Badge value={row.priority} />;
    case 'slaState':
      return <Badge value={row.slaState} />;
    case 'owner':
      return row.owner?.fullName ?? <em style={{ color: 'var(--lf-wine-700)' }}>Unassigned</em>;
    case 'nextFollowUpAt':
      return <span style={{ color: overdueColor(row.nextFollowUpAt) }}>{formatDate(row.nextFollowUpAt)}</span>;
    case 'email':
      return <span style={{ color: 'var(--lf-ink-2)' }}>{row.email ?? '—'}</span>;
    case 'phone':
      return <span style={{ color: 'var(--lf-ink-2)', fontFamily: 'var(--lf-font-mono)' }}>{row.phone ?? '—'}</span>;
    case 'grade':
      return row.grade ? <Badge value={row.grade} /> : '—';
    case 'updatedAt':
      return <span style={{ color: 'var(--lf-ink-3)' }}>{formatDate(row.updatedAt)}</span>;
    default:
      return '—';
  }
}

function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function overdueColor(value?: string | Date | null) {
  if (!value) return 'var(--lf-ink-3)';
  return new Date(value) < new Date() ? 'var(--lf-vermillion)' : 'var(--lf-ink-2)';
}
