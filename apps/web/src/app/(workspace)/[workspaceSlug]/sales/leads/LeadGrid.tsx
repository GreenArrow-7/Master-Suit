'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge, { labelFor } from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import { cellType, headAlign } from '@/components/workspace/ConfigurableGrid';
import type { ColumnDef } from '@/lib/grid/columns';

export interface LeadRow {
  id: string;
  reference: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  score: number;
  grade?: string | null;
  priority: string;
  slaState: string;
  nextFollowUpAt?: string | Date | null;
  updatedAt: string | Date;
  ownerId?: string | null;
  stage: { key: string; name: string; color: string };
  owner?: { fullName: string } | null;
}

type SortKey = 'fullName' | 'score' | 'updatedAt' | 'nextFollowUpAt';
const SORTABLE = new Set<string>(['fullName', 'score', 'updatedAt', 'nextFollowUpAt']);

type BulkAction = 'assign' | 'stage' | 'task';
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function LeadGrid({
  rows,
  columns,
  stages,
  users,
  taskTypes,
  canAssign,
  canEdit,
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
  const fieldId = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' });
  const [action, setAction] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scrolled, setScrolled] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key] ?? '',
        bv = b[sort.key] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  // Both are about the loaded page only, which is why every label says so.
  const allSelected = selected.size > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clear() {
    setSelected(new Set());
    setAction(null);
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
    clear();
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
    clear();
    router.refresh();
  }

  const changeStage = (stageId: string) => run((leadId) => post(`/api/v1/leads/${leadId}`, { stageId }, 'PATCH'));

  const addTask = (form: FormData) =>
    run((leadId) =>
      post('/api/v1/tasks', {
        leadId,
        typeId: String(form.get('typeId')),
        title: String(form.get('title')),
        dueAt: new Date(String(form.get('dueAt'))).toISOString(),
        priority: String(form.get('priority')),
      }),
    );

  // One control serves the header row and the bulk bar — only one is mounted
  // at a time. `indeterminate` has no attribute form, hence the ref.
  const selectAll = (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      aria-label={`Select all ${rows.length} on this page`}
      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
    />
  );

  function header(column: ColumnDef) {
    const sortable = SORTABLE.has(column.key);
    const active = sortable && sort.key === column.key;
    return (
      <th
        key={column.key}
        className={column.key === 'reference' ? 'lf-sticky' : undefined}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
        data-align={headAlign(cellType(column))}
      >
        {sortable ? (
          <button
            type="button"
            onClick={() => setSort({ key: column.key as SortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
          >
            {column.label}
          </button>
        ) : (
          column.label
        )}
      </th>
    );
  }

  const bulkButton = (key: BulkAction, label: string) => (
    <button
      type="button"
      className="lf-btn lf-btn--secondary lf-btn--sm"
      aria-expanded={action === key}
      onClick={() => setAction(action === key ? null : key)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="lf-grid-wrap"
      data-scrolled={scrolled ? 'true' : undefined}
      data-bulk={selected.size > 0 ? '' : undefined}
      onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
    >
      {/* The bulk bar takes the header row's place while a selection is active
          (the stylesheet hides the row it replaces), so nothing moves and no
          row is covered. */}
      {selected.size > 0 && (
        <div className="lf-bulkbar">
          {selectAll}
          <span role="status">{selected.size} selected</span>
          <span className="lf-bulkbar__actions">
            {canAssign && bulkButton('assign', 'Assign')}
            {canEdit && bulkButton('stage', 'Change stage')}
            {canEdit && bulkButton('task', 'Add task')}
            <button type="button" className="lf-linkbtn" onClick={clear}>
              Clear
            </button>
          </span>
        </div>
      )}

      {selected.size > 0 && action && (
        <div className="lf-bulkbar__panel">
          {action === 'assign' && (
            <div className="lf-field">
              <label className="lf-label" htmlFor={`${fieldId}-owner`}>
                Assign to
              </label>
              <select
                id={`${fieldId}-owner`}
                className="lf-select"
                defaultValue=""
                disabled={busy}
                onChange={(event) => event.target.value && assign(event.target.value)}
              >
                <option value="" disabled>
                  Choose a user…
                </option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {action === 'stage' && (
            <div className="lf-field">
              <label className="lf-label" htmlFor={`${fieldId}-stage`}>
                Move to stage
              </label>
              <select
                id={`${fieldId}-stage`}
                className="lf-select"
                defaultValue=""
                disabled={busy}
                onChange={(event) => event.target.value && changeStage(event.target.value)}
              >
                <option value="" disabled>
                  Choose a stage…
                </option>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {action === 'task' && (
            <form
              className="lf-bulkbar__form"
              onSubmit={(event) => {
                event.preventDefault();
                void addTask(new FormData(event.currentTarget));
              }}
            >
              <div className="lf-field">
                <label className="lf-label" htmlFor={`${fieldId}-title`}>
                  Title
                </label>
                <input
                  id={`${fieldId}-title`}
                  className="lf-input"
                  name="title"
                  required
                  maxLength={200}
                  placeholder="Call back"
                />
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor={`${fieldId}-type`}>
                  Type
                </label>
                <select id={`${fieldId}-type`} className="lf-select" name="typeId" required>
                  {taskTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor={`${fieldId}-due`}>
                  Due
                </label>
                <input id={`${fieldId}-due`} className="lf-input" name="dueAt" type="datetime-local" required />
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor={`${fieldId}-priority`}>
                  Priority
                </label>
                <select id={`${fieldId}-priority`} className="lf-select" name="priority" defaultValue="MEDIUM">
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {labelFor(p)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="lf-btn" type="submit" disabled={busy}>
                {busy ? 'Adding…' : `Add to ${selected.size}`}
              </button>
            </form>
          )}

          {error && (
            <p className="lf-hint lf-hint--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <table className="lf-grid">
        <thead>
          <tr>
            <th className="lf-grid__select">{selectAll}</th>
            {columns.map(header)}
            <th className="lf-grid__actions">
              <span className="lf-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} aria-selected={selected.has(row.id)}>
              <td className="lf-grid__select" data-label="">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  aria-label={`Select ${row.fullName}`}
                />
              </td>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.key === 'reference' ? 'lf-sticky' : undefined}
                  data-type={cellType(column)}
                  data-hide-mobile={column.hideMobile ? '' : undefined}
                  data-label={column.label}
                  data-priority={column.primary ? 'primary' : undefined}
                >
                  {cell(column.key, row)}
                </td>
              ))}
              <td className="lf-grid__actions" data-role="actions" data-label="">
                <SalesLink
                  className="lf-btn lf-btn--ghost lf-grid__more"
                  href={`/leads/${row.id}`}
                  aria-label={`Open ${row.fullName}`}
                >
                  <span aria-hidden="true">⋯</span>
                </SalesLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY = <span className="lf-cell--empty">—</span>;

const muted = (value: string | null | undefined) => (value ? <span className="lf-cell--muted">{value}</span> : EMPTY);

/** Plain text whose word carries the state; the data attribute only adds colour. */
const state = (value: string) => (
  <span className="lf-cell--state" data-state={value}>
    {labelFor(value)}
  </span>
);

function cell(key: string, row: LeadRow) {
  switch (key) {
    case 'reference':
      // The td's data-type sets the mono face; the link inherits it.
      return <SalesLink href={`/leads/${row.id}`}>{row.reference}</SalesLink>;
    case 'fullName':
      return (
        <SalesLink className="lf-cell--name" href={`/leads/${row.id}`}>
          {row.fullName}
        </SalesLink>
      );
    case 'company':
      return muted(row.company);
    case 'email':
      return muted(row.email);
    case 'phone':
      return muted(row.phone);
    case 'grade':
      return muted(row.grade);
    case 'stage':
      // The row's one tag. The stage's own colour only matters for a custom
      // stage the semantic map does not know.
      return (
        <Badge value={row.stage.key} color={row.stage.color}>
          {row.stage.name}
        </Badge>
      );
    case 'score':
      return (
        <span className="lf-cell--score" data-band={row.score >= 70 ? 'high' : row.score < 40 ? 'low' : undefined}>
          {row.score}
        </span>
      );
    case 'priority':
      return state(row.priority);
    case 'slaState':
      return state(row.slaState);
    case 'owner':
      return row.owner?.fullName ?? <em className="lf-cell--unassigned">Unassigned</em>;
    case 'nextFollowUpAt':
      return followUp(row.nextFollowUpAt);
    case 'updatedAt': {
      const ago = relative(row.updatedAt);
      return (
        <>
          {formatDate(row.updatedAt)}
          {ago && (
            // Computed from "now", so the server's and the browser's copy can differ by a minute.
            <span className="lf-cell__meta" suppressHydrationWarning>
              {ago}
            </span>
          )}
        </>
      );
    }
    default:
      return EMPTY;
  }
}

function followUp(value?: string | Date | null) {
  if (!value) return EMPTY;
  if (new Date(value) >= new Date()) return formatDate(value);
  return (
    <>
      <span className="lf-cell--overdue">{formatDate(value)}</span>
      <span className="lf-cell__meta">Overdue</span>
    </>
  );
}

/** "5 Sep" this year, "5 Sep 2025" otherwise. */
function formatDate(value: string | Date) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** A recency-ordered column must show recency; past a week the date alone says enough. */
function relative(value: string | Date) {
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return days < 7 ? `${days}d ago` : '';
}
