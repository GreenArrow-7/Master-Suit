'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import { DateTimeInput } from '@/components/forms/DateInput';
import SalesLink from '@/components/workspace/SalesLink';
import { columnPriority, type ColumnDef } from '@/lib/grid/columns';
import { summarizeBulk, type BulkFailure, type BulkOutcome } from '@/lib/grid/bulkOutcomes';
import { parseTags } from '@/lib/leads/tags';
import RowDetails from '@/components/workspace/RowDetails';
import StageReason, { asksBeforeMove, type ReasonedStage, type StageMove } from '@/components/workspace/StageReason';
import { dialable } from '@/components/workspace/CallLink';
import CallLogDialog, { useAfterDial, type CallLogLead } from './CallLogDialog';

export interface LeadRow {
  id: string;
  reference: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  score: number;
  grade?: string | null;
  tags?: string[];
  /** The custom-field columns' values, by column key (`cf:<key>`). */
  custom?: Record<string, string | null>;
  priority: string;
  slaState: string;
  /** The viewer's own next obligation on this lead — never the lead-wide one. */
  nextFollowUpAt?: string | Date | null;
  updatedAt: string | Date;
  ownerId?: string | null;
  /** Its call can be logged: `leads:EDIT` reaches this lead (`leadReach`). */
  canLog?: boolean;
  stage: { key: string; name: string; color: string };
  owner?: { fullName: string } | null;
}

export type SortKey = 'fullName' | 'score' | 'updatedAt' | 'nextFollowUpAt';
export type GridSort = { key: SortKey; dir: 'asc' | 'desc' } | null;
const SORTABLE = new Set<string>(['fullName', 'score', 'updatedAt', 'nextFollowUpAt']);

type BulkAction = 'assign' | 'stage' | 'task' | 'tag' | 'closeout';

export default function LeadGrid({
  rows,
  columns,
  stages,
  projects,
  users,
  taskTypes,
  canAssign,
  canEdit,
  canDelete,
  canMoveToData,
  emptyLabel,
  sort: initialSort = { key: 'updatedAt', dir: 'desc' },
  timeZone,
}: {
  rows: LeadRow[];
  columns: ColumnDef[];
  stages: (ReasonedStage & { key: string })[];
  /** The mini-form's site visit picker (bookableProjects). */
  projects: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  taskTypes: { id: string; name: string }[];
  canAssign: boolean;
  canEdit: boolean;
  /** `leads:DELETE`; the endpoint asserts it again whatever this renders. */
  canDelete: boolean;
  /** `leads:CREATE` (the cold record) and `leads:EDIT` (the close-out); asserted again by the endpoint. */
  canMoveToData: boolean;
  /** What an empty follow-up cell says for this viewer. */
  emptyLabel: string;
  /** The order the server sent, as a column sort; null keeps the rows as sent (a sort no column shows). */
  sort?: GridSort;
  /** The workspace's, for the call log's follow-up clock. */
  timeZone: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<GridSort>(initialSort);
  const [action, setAction] = useState<BulkAction | null>(null);
  /** The chosen stage, while its mini-form is open. */
  const [reasonFor, setReasonFor] = useState<ReasonedStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<BulkOutcome | null>(null);
  /** The leads the last bulk delete removed, while their Undo stands; then what the Undo did. */
  const [deleted, setDeleted] = useState<string[]>([]);
  const [undoNote, setUndoNote] = useState('');
  /** Focus or the pointer is on the toast: its 10 seconds wait. */
  const [held, setHeld] = useState(false);
  const undoButton = useRef<HTMLButtonElement>(null);

  // Undo stands for 10 seconds (M4-36), counted while it is neither focused nor
  // under the pointer; its outcome shows for as long.
  useEffect(() => {
    if ((!deleted.length && !undoNote) || held) return;
    const timer = setTimeout(() => {
      setDeleted([]);
      setUndoNote('');
    }, 10_000);
    return () => clearTimeout(timer);
  }, [deleted, undoNote, held]);
  // The delete took the bulk bar, and the focused Delete with it: focus goes to Undo.
  useEffect(() => {
    if (deleted.length) undoButton.current?.focus();
  }, [deleted]);
  /** The lead whose call is being logged (PROP-02.2): from its row, or on return from dialling it. */
  const [logFor, setLogFor] = useState<CallLogLead | null>(null);
  const dialled = useAfterDial(setLogFor);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (!sort) return copy;
    if (sort.key === 'nextFollowUpAt') {
      // "Nothing owed" is not an early date. Floating it to the top of an
      // ascending sort is how a lead nobody scheduled anything for gets
      // mistaken for the most urgent one, so it sinks in both directions and
      // ties break on id so the order is stable between renders.
      copy.sort((a, b) => {
        const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : null;
        const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : null;
        if (av === null && bv === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av !== bv) return sort.dir === 'asc' ? av - bv : bv - av;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return copy;
    }
    copy.sort((a, b) => {
      const av = a[sort.key] ?? '',
        bv = b[sort.key] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const allSelected = selected.size > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Runs `send` for every selected lead, one independent request each, and
   * reports each refusal with the server's own sentence. Answers the ids that went through.
   */
  async function run(send: (leadId: string) => Promise<Response>): Promise<string[]> {
    setBusy(true);
    setFailure(null);
    const ids = [...selected];
    const failures: BulkFailure[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const res = await send(id).catch(() => null);
        if (res?.ok) return;
        const data = res ? await res.json().catch(() => ({})) : {};
        failures.push({
          id,
          detail:
            typeof data.detail === 'string'
              ? data.detail
              : res
                ? `Request failed (${res.status}).`
                : 'Could not reach the server.',
        });
      }),
    );
    setBusy(false);
    const done = ids.filter((id) => !failures.some((f) => f.id === id));
    if (failures.length) {
      // The mini-form closes so the refusals show; choosing the stage again reopens it.
      setReasonFor(null);
      // Only what failed stays selected: a retry must not add a second task to,
      // or re-send, the leads that worked. The refresh shows those their new state.
      setSelected(new Set(failures.map((f) => f.id)));
      setFailure(summarizeBulk(ids.length, failures, rows));
      router.refresh();
      return done;
    }
    setAction(null);
    setReasonFor(null);
    setSelected(new Set());
    router.refresh();
    return done;
  }

  const post = (url: string, body: unknown, method = 'POST') =>
    fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function assign(ownerId: string) {
    setBusy(true);
    setFailure(null);
    // A single bulk endpoint, so the assignment history is written in one transaction.
    const res = await post('/api/v1/leads/assign', { leadIds: [...selected], ownerId });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFailure({ summary: data.detail ?? 'Could not assign the selected leads.', groups: [] });
      return;
    }
    // The endpoint moves only the leads inside the caller's ASSIGN scope and
    // answers with how many; the list is drawn by VIEW, which a custom role may
    // hold wider, so a short count is the only sign of the ones left behind.
    const { assigned } = await res.json().catch(() => ({ assigned: selected.size }));
    if (assigned < selected.size) {
      setFailure({
        summary: `${selected.size - assigned} of ${selected.size} could not be assigned: outside your assignment scope.`,
        groups: [],
      });
      router.refresh();
      return;
    }
    setAction(null);
    setSelected(new Set());
    router.refresh();
  }

  const changeStage = (stageId: string, move: StageMove = {}) =>
    run((leadId) => post(`/api/v1/leads/${leadId}`, { stageId, ...move }, 'PATCH'));

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

  /**
   * Delete from the list (ported from the BUG-006 fix, 21705d7). The only delete a
   * lead had was one at a time behind "More" on the detail page. Soft delete: the row
   * keeps its history and leaves every list.
   */
  const deleteSelected = async () => {
    if (!window.confirm(`Delete ${selected.size} lead(s)? They will no longer appear in any list.`)) return;
    setUndoNote('');
    setDeleted(await run((leadId) => fetch(`/api/v1/leads/${leadId}`, { method: 'DELETE' })));
  };

  /** Undo: each deleted lead back (POST …/restore, under the delete's own permission and scope). */
  async function undoDelete() {
    const ids = deleted;
    setDeleted([]);
    // The focused Undo is gone, and a removed element may never blur.
    setHeld(false);
    setBusy(true);
    const answers = await Promise.all(
      ids.map((id) => fetch(`/api/v1/leads/${id}/restore`, { method: 'POST' }).catch(() => null)),
    );
    setBusy(false);
    const back = answers.filter((res) => res?.ok).length;
    setUndoNote(
      back === ids.length
        ? `Restored ${back} lead${back === 1 ? '' : 's'}.`
        : `${ids.length - back} of ${ids.length} could not be restored.`,
    );
    router.refresh();
  }

  /**
   * Move to Data (M4-39): each lead becomes a contact on the day's "From
   * pipeline" list in Cold Data, still its owner's, and is closed out of the lead lists.
   */
  const moveToData = () => {
    if (
      !window.confirm(
        `Move ${selected.size} lead(s) to Cold Data? Each becomes a contact on today's "From pipeline" list and leaves the lead lists.`,
      )
    )
      return;
    void run((leadId) => post(`/api/v1/leads/${leadId}/move-to-data`, {}));
  };

  function header(column: ColumnDef) {
    const sortable = SORTABLE.has(column.key);
    const active = sortable && sort?.key === column.key;
    return (
      <th
        key={column.key}
        className={column.key === 'reference' ? 'lf-sticky' : undefined}
        aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
        onClick={
          sortable
            ? () => setSort({ key: column.key as SortKey, dir: active && sort?.dir === 'desc' ? 'asc' : 'desc' })
            : undefined
        }
        style={{ textAlign: column.align ?? 'left' }}
      >
        {column.label}
        {active && (
          <span aria-hidden="true" style={{ marginLeft: 4 }}>
            {sort?.dir === 'desc' ? '↓' : '↑'}
          </span>
        )}
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
            {canAssign && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => setAction(action === 'assign' ? null : 'assign')}
              >
                Assign
              </button>
            )}
            {canEdit && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => {
                  setReasonFor(null);
                  setAction(action === 'stage' ? null : 'stage');
                }}
              >
                Change stage
              </button>
            )}
            {canEdit && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => setAction(action === 'task' ? null : 'task')}
              >
                Add task
              </button>
            )}
            {canEdit && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => setAction(action === 'tag' ? null : 'tag')}
              >
                Add tag
              </button>
            )}
            {canEdit && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                onClick={() => setAction(action === 'closeout' ? null : 'closeout')}
              >
                Close out
              </button>
            )}
            {canMoveToData && (
              <button className="lf-btn lf-btn--sm lf-btn--secondary" disabled={busy} onClick={moveToData}>
                Move to Data
              </button>
            )}
            {canDelete && (
              <button
                className="lf-btn lf-btn--sm lf-btn--secondary"
                style={{ color: 'var(--lf-vermillion)' }}
                disabled={busy}
                onClick={() => void deleteSelected()}
              >
                Delete
              </button>
            )}
            <button
              className="lf-toast__action"
              onClick={() => {
                setSelected(new Set());
                setAction(null);
                setFailure(null);
              }}
            >
              Clear
            </button>
          </span>
          {action && (
            <div
              style={{
                flexBasis: '100%',
                marginTop: 'var(--lf-space-3)',
                paddingTop: 'var(--lf-space-3)',
                borderTop: '1px solid var(--lf-line)',
              }}
            >
              {action === 'assign' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  Assign to
                  <select
                    className="lf-input"
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
                </label>
              )}

              {action === 'stage' && !reasonFor && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  Move to stage
                  <select
                    className="lf-input"
                    defaultValue=""
                    disabled={busy}
                    onChange={(event) => {
                      const stage = stages.find((s) => s.id === event.target.value);
                      if (stage && asksBeforeMove(stage)) setReasonFor(stage);
                      else if (stage) void changeStage(stage.id);
                    }}
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
                </label>
              )}

              {action === 'closeout' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  Mark selected as
                  <select
                    className="lf-input"
                    defaultValue=""
                    disabled={busy}
                    onChange={(event) =>
                      event.target.value &&
                      void run((leadId) => post(`/api/v1/leads/${leadId}/close-out`, { status: event.target.value }))
                    }
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    <option value="INVALID">Invalid</option>
                    <option value="DUPLICATE">Duplicate</option>
                    <option value="ARCHIVED">Archived</option>
                    <option value="OPEN">Reopened</option>
                  </select>
                </label>
              )}

              {action === 'tag' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const tags = parseTags(String(new FormData(event.currentTarget).get('tags')));
                    // Added to each lead's own on the server: none is removed.
                    if (tags.length) void run((leadId) => post(`/api/v1/leads/${leadId}`, { addTags: tags }, 'PATCH'));
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
                >
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>
                    Tags to add
                    <input className="lf-input" name="tags" required maxLength={800} placeholder="investor, vip" />
                  </label>
                  <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
                    {busy ? 'Adding…' : `Add to ${selected.size}`}
                  </button>
                </form>
              )}

              {action === 'task' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addTask(new FormData(event.currentTarget));
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
                >
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>
                    Title
                    <input className="lf-input" name="title" required maxLength={200} placeholder="Call back" />
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>
                    Type
                    <select className="lf-input" name="typeId" required>
                      {taskTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>
                    Due
                    <DateTimeInput name="dueAt" required aria-label="Due" />
                  </label>
                  <label style={{ fontSize: 'var(--lf-text-2xs)' }}>
                    Priority
                    <select className="lf-input" name="priority" defaultValue="MEDIUM">
                      {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                        <option key={p} value={p}>
                          {p.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
                    {busy ? 'Adding…' : `Add to ${selected.size}`}
                  </button>
                </form>
              )}
            </div>
          )}
          {/* Outside the action panel: a refused Delete runs with no panel open. */}
          {failure && (
            <div
              role="alert"
              style={{ flexBasis: '100%', color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', marginTop: 8 }}
            >
              {failure.summary}
              {failure.groups.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {failure.groups.map((g) => (
                    <li key={g.detail}>
                      {g.detail} — {g.refs.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Outside the bar, whose colours it would otherwise inherit. */}
      {action === 'stage' && reasonFor && (
        <StageReason
          stage={reasonFor}
          projects={projects}
          busy={busy}
          onMove={(move) => void changeStage(reasonFor.id, move)}
          onCancel={() => setReasonFor(null)}
        />
      )}

      {/* Mounted empty, so the text put into it is announced. */}
      <div role="status">
        {(deleted.length > 0 || undoNote) && (
          <div
            className="lf-toast lf-outbox"
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
          >
            {deleted.length > 0 ? (
              <div>
                {deleted.length} lead{deleted.length === 1 ? '' : 's'} deleted.{' '}
                <button
                  ref={undoButton}
                  type="button"
                  className="lf-toast__action"
                  disabled={busy}
                  onClick={() => void undoDelete()}
                >
                  Undo
                </button>
              </div>
            ) : (
              <div>{undoNote}</div>
            )}
          </div>
        )}
      </div>

      {/* With no rows the page shows its empty state; the grid stays mounted for the Undo above. */}
      {rows.length > 0 && (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    aria-label="Select all rows"
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
                {columns.map(header)}
                <th className="lf-grid__actions">
                  <span className="lf-visually-hidden">Call</span>
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
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={column.key === 'reference' ? 'lf-sticky' : undefined}
                      data-hide-mobile={column.hideMobile ? '' : undefined}
                      data-label={column.label}
                      data-priority={columnPriority(column, index, columns)}
                      style={{ textAlign: column.align ?? 'left' }}
                    >
                      {leadCell(column.key, row, emptyLabel)}
                    </td>
                  ))}
                  {/* Unlabelled, so it is a full-width line at the foot of the phone card. A
                      masked number is not dialable, so it gets no tel: link. */}
                  <td className="lf-grid__actions" data-label="">
                    <span style={{ display: 'flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
                      {dialable(row.phone) && (
                        <a
                          className="lf-btn lf-btn--secondary lf-btn--sm"
                          href={`tel:${dialable(row.phone)}`}
                          aria-label={`Call ${row.fullName}`}
                          style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                          onClick={() => row.canLog && dialled(row)}
                        >
                          Call
                        </a>
                      )}
                      {row.canLog && (
                        <button
                          type="button"
                          className="lf-btn lf-btn--secondary lf-btn--sm"
                          aria-label={`Log call for ${row.fullName}`}
                          style={{ whiteSpace: 'nowrap' }}
                          onClick={() => setLogFor(row)}
                        >
                          Log call
                        </button>
                      )}
                    </span>
                  </td>
                  <RowDetails />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logFor && (
        <CallLogDialog
          lead={logFor}
          timeZone={timeZone}
          onClose={() => setLogFor(null)}
          onLogged={() => router.refresh()}
        />
      )}
    </>
  );
}

export function leadCell(key: string, row: LeadRow, emptyLabel: string) {
  if (key.startsWith('cf:')) return row.custom?.[key] ?? '—';
  switch (key) {
    case 'reference':
      return (
        <SalesLink
          href={`/leads/${row.id}`}
          style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}
        >
          {row.reference}
        </SalesLink>
      );
    case 'fullName':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
          <span className="lf-avatar">
            {row.fullName
              .split(' ')
              .slice(0, 2)
              .map((p) => p[0])
              .join('')}
          </span>
          <SalesLink href={`/leads/${row.id}`} style={{ fontWeight: 500, color: 'var(--lf-ink)' }}>
            {row.fullName}
          </SalesLink>
        </span>
      );
    case 'company':
      return <span style={{ color: 'var(--lf-ink-2)' }}>{row.company ?? '—'}</span>;
    case 'stage':
      return <Badge value={row.stage.key}>{row.stage.name}</Badge>;
    case 'score':
      return (
        <span className="lf-score">
          <span className="lf-score__bar">
            <span className="lf-score__fill" style={{ width: `${row.score}%` }} />
          </span>
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
      return <FollowUpCell value={row.nextFollowUpAt} emptyLabel={emptyLabel} />;
    case 'email':
      return <span style={{ color: 'var(--lf-ink-2)' }}>{row.email ?? '—'}</span>;
    case 'phone':
      return <span style={{ color: 'var(--lf-ink-2)', fontFamily: 'var(--lf-font-mono)' }}>{row.phone ?? '—'}</span>;
    case 'grade':
      return row.grade ? <Badge value={row.grade} /> : '—';
    case 'tags':
      return row.tags?.length ? (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.tags.map((tag) => (
            <Badge key={tag} tone="slate">
              {tag}
            </Badge>
          ))}
        </span>
      ) : (
        '—'
      );
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

/**
 * Three states, two of them not a date.
 *
 * An em dash for "nothing owed" reads as missing data, and the same grey as
 * every other empty cell hides the one case the chasing queue exists to catch.
 * "Overdue" gets the only colour, because it is the only one that is a problem;
 * the rest are ordinary facts and are written out in words rather than punctuation.
 *
 * `emptyLabel` is a statement about the viewer, not about the lead — see
 * `emptyFollowUpLabel`. It deliberately does not reveal whether somebody else
 * has work here.
 *
 * The label is also the accessible name — no title-attribute-only meaning, which
 * a screen reader announces inconsistently and a touch device never shows at all.
 */
function FollowUpCell({ value, emptyLabel }: { value?: string | Date | null; emptyLabel: string }) {
  if (!value) return <span style={{ color: 'var(--lf-ink-3)' }}>{emptyLabel}</span>;
  const overdue = new Date(value) < new Date();
  return (
    <span style={{ color: overdue ? 'var(--lf-vermillion)' : 'var(--lf-ink-2)' }}>
      {formatDate(value)}
      {overdue && <span className="lf-visually-hidden"> (overdue)</span>}
    </span>
  );
}
