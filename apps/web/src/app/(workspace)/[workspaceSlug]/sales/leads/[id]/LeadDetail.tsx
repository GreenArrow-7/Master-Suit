'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge, { toneFor } from '@/components/ui/Badge';
import { useModuleBase } from '@/components/workspace/SalesLink';

type Tab = 'Overview' | 'Timeline' | 'Tasks' | 'Notes' | 'Documents';
const TABS: Tab[] = ['Overview', 'Timeline', 'Tasks', 'Notes', 'Documents'];

interface ActivityType {
  id: string;
  name: string;
  key: string;
}
interface TaskType {
  id: string;
  name: string;
  key: string;
}
interface User {
  id: string;
  fullName: string;
}
interface Stage {
  id: string;
  key: string;
  name: string;
}

interface Activity {
  id: string;
  outcome: string | null;
  notes: string | null;
  occurredAt: string;
  durationSecs: number | null;
  type: { name: string; key: string };
}

/** One stage transition, names already resolved by the page. */
interface StageChange {
  id: string;
  from: string | null;
  to: string;
  changedBy: string | null;
  changedBySystem: string | null;
  reason: string | null;
  createdAt: string;
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: string;
  status: string;
  type: { name: string; key: string };
}

interface Doc {
  id: string;
  name: string;
  category: string | null;
  mimeType: string;
  sizeBytes: number;
  scanState: string;
  createdAt: string;
}

interface LeadData {
  id: string;
  reference: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  source: string;
  consentStatus: string;
  priority: string;
  slaState: string;
  score: number;
  grade: string | null;
  notes: string | null;
  tags: string[];
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  stage: { key: string; name: string };
  owner: { fullName: string; email: string } | null;
  activities: Activity[];
  stageHistory: StageChange[];
  tasks: TaskItem[];
  documents: Doc[];
}

interface Props {
  lead: LeadData;
  stages: Stage[];
  activityTypes: ActivityType[];
  taskTypes: TaskType[];
  users: User[];
  canEdit: boolean;
  canDeleteDocuments: boolean;
  canAssign: boolean;
  canDelete: boolean;
}

/** Every tab reports into the one alert slot at the top of the tab body. */
type Report = (message: string | null) => void;

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function LeadDetail({
  lead,
  stages,
  activityTypes,
  taskTypes,
  users,
  canEdit,
  canDeleteDocuments,
  canAssign,
  canDelete,
}: Props) {
  const router = useRouter();
  const base = useModuleBase();
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which side-panel popover is open: the owner picker, or the More menu and
  // its "Change stage" second page. One value, so two can never be open at once.
  const [menu, setMenu] = useState<'assign' | 'more' | 'stage' | null>(null);

  // Delete arms before it fires — the same two-step the document rows use.
  const [armed, setArmed] = useState(false);

  function withBusy(fn: () => Promise<void>) {
    return async () => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(messageOf(e));
      }
      setBusy(false);
    };
  }

  async function patchLead(data: Record<string, unknown>) {
    await api(`/api/v1/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(data) });
    router.refresh();
  }

  const handleDelete = withBusy(async () => {
    await api(`/api/v1/leads/${lead.id}`, { method: 'DELETE' });
    router.push(base + '/leads');
  });

  const handleAssign = (userId: string | null) => {
    setMenu(null);
    void withBusy(async () => {
      await patchLead({ ownerId: userId });
    })();
  };

  const handleStageChange = (stageKey: string) => {
    setMenu(null);
    const target = stages.find((s) => s.key === stageKey);
    if (!target) return;
    void withBusy(async () => {
      await patchLead({ stageId: target.id });
    })();
  };

  function selectTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  // Roving tabindex: arrows move focus and selection together, Home/End jump.
  // The tablist's children are exactly the tab buttons, in TABS order.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(TABS[next]!);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  }

  const followUpOverdue = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) < new Date() : false;
  // The query already restricts tasks to OPEN | IN_PROGRESS.
  const openTaskCount = lead.tasks.length;
  const timelineCount = lead.activities.length + lead.stageHistory.length;
  const tabId = (t: Tab) => `lead-tab-${t.toLowerCase()}`;
  const panelId = `lead-panel-${tab.toLowerCase()}`;
  const moreOpen = menu === 'more' || menu === 'stage';

  return (
    <div className="lf-detail">
      <div className="lf-detail__main">
        <div className="lf-tabs" role="tablist" aria-label="Lead record" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => (
            <button
              key={t}
              id={tabId(t)}
              type="button"
              className="lf-tab"
              role="tab"
              aria-selected={tab === t}
              aria-controls={tab === t ? panelId : undefined}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => selectTab(t)}
            >
              {t}
              {t === 'Timeline' && timelineCount > 0 && <span className="lf-tab__count">{timelineCount}</span>}
            </button>
          ))}
        </div>

        <div className="lf-tabpanel" role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} tabIndex={0}>
          {error && (
            <div className="lf-alert" data-tone="vermillion" role="alert">
              {error}
            </div>
          )}
          {tab === 'Overview' && (
            <OverviewTab
              lead={lead}
              editing={editing}
              setEditing={setEditing}
              patchLead={patchLead}
              report={setError}
            />
          )}
          {tab === 'Timeline' && (
            <TimelineTab lead={lead} activityTypes={activityTypes} router={router} report={setError} />
          )}
          {tab === 'Tasks' && <TasksTab lead={lead} taskTypes={taskTypes} router={router} report={setError} />}
          {tab === 'Notes' && <NotesTab lead={lead} patchLead={patchLead} canEdit={canEdit} />}
          {tab === 'Documents' && (
            <DocumentsTab
              documents={lead.documents}
              leadId={lead.id}
              canEdit={canEdit}
              canDelete={canDeleteDocuments}
              report={setError}
            />
          )}
        </div>
      </div>

      {/* State and actions, visible whichever tab is open and sticky while the
          timeline scrolls. Stage and SLA are not repeated here: the rail above
          already shows both. */}
      <aside className="lf-detail__side">
        <div className="lf-actionrow">
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={!lead.phone}
            title={lead.phone ? `Call ${lead.phone}` : 'No phone number'}
            onClick={() => lead.phone && window.open(`tel:${lead.phone}`)}
          >
            <Icon name="phone" />
            Call
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={!lead.email}
            title={lead.email ? `Email ${lead.email}` : 'No email address'}
            onClick={() => lead.email && window.open(`mailto:${lead.email}`)}
          >
            <Icon name="mail" />
            Email
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={!lead.phone}
            title={lead.phone ? 'Open a WhatsApp chat' : 'No phone number'}
            onClick={() => lead.phone && window.open(`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`)}
          >
            <Icon name="chat" />
            WhatsApp
          </button>
          {(canEdit || canDelete) && (
            <div className="lf-menu-anchor">
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMenu(moreOpen ? null : 'more')}
              >
                More
                <Icon name="chevron" />
              </button>
              {menu === 'more' && (
                <Dropdown onClose={() => setMenu(null)}>
                  {canEdit && (
                    <button type="button" className="lf-menu__item" role="menuitem" onClick={() => setMenu('stage')}>
                      Change stage…
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="lf-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setEditing(!editing);
                        selectTab('Overview');
                      }}
                    >
                      {editing ? 'Cancel edit' : 'Edit details'}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      className="lf-menu__item"
                      role="menuitem"
                      data-destructive=""
                      disabled={busy}
                      onClick={() => {
                        setMenu(null);
                        setArmed(true);
                      }}
                    >
                      Delete lead…
                    </button>
                  )}
                </Dropdown>
              )}
              {menu === 'stage' && (
                <Dropdown onClose={() => setMenu(null)} label="Change stage">
                  {stages.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="lf-menu__item"
                      role="menuitem"
                      aria-current={s.key === lead.stage.key ? 'true' : undefined}
                      onClick={() => handleStageChange(s.key)}
                    >
                      {s.name}
                    </button>
                  ))}
                </Dropdown>
              )}
            </div>
          )}
        </div>

        {armed && (
          <div className="lf-confirm" role="alertdialog" aria-labelledby="lead-delete-question">
            <span id="lead-delete-question">Delete {lead.fullName}? This cannot be undone.</span>
            <span className="lf-confirm__actions">
              <button
                type="button"
                className="lf-btn lf-btn--danger lf-btn--sm"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={busy}
                onClick={() => setArmed(false)}
              >
                Keep
              </button>
            </span>
          </div>
        )}

        <dl className="lf-kv">
          <div>
            <dt>Owner</dt>
            <dd className={canAssign ? 'lf-menu-anchor' : undefined}>
              {canAssign ? (
                <>
                  <button
                    type="button"
                    className="lf-kv__btn"
                    aria-haspopup="menu"
                    aria-expanded={menu === 'assign'}
                    onClick={() => setMenu(menu === 'assign' ? null : 'assign')}
                  >
                    {lead.owner?.fullName ?? 'Unassigned'}
                    <Icon name="chevron" />
                  </button>
                  {menu === 'assign' && (
                    <Dropdown onClose={() => setMenu(null)} label="Assign owner">
                      <button
                        type="button"
                        className="lf-menu__item"
                        role="menuitem"
                        data-destructive=""
                        onClick={() => handleAssign(null)}
                      >
                        Unassign
                      </button>
                      {users.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="lf-menu__item"
                          role="menuitem"
                          aria-current={u.fullName === lead.owner?.fullName ? 'true' : undefined}
                          onClick={() => handleAssign(u.id)}
                        >
                          {u.fullName}
                        </button>
                      ))}
                    </Dropdown>
                  )}
                </>
              ) : (
                (lead.owner?.fullName ?? 'Unassigned')
              )}
            </dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>
              <Badge tone={toneFor(lead.priority)}>{sentence(lead.priority)}</Badge>
            </dd>
          </div>
          <div>
            <dt>Score</dt>
            <dd>
              <span title={`Lead score ${lead.score} of 100`}>
                {lead.score}
                {lead.grade ? ` · ${lead.grade}` : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt>{followUpOverdue ? 'Follow-up overdue' : 'Next follow-up'}</dt>
            <dd data-overdue={followUpOverdue || undefined}>
              {lead.nextFollowUpAt ? fmtDate(lead.nextFollowUpAt) : '—'}
            </dd>
          </div>
          <div>
            <dt>Last activity</dt>
            <dd>{lead.lastActivityAt ? fmtDate(lead.lastActivityAt) : '—'}</dd>
          </div>
          <div>
            <dt>Open tasks</dt>
            <dd>{openTaskCount}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

// ── Dropdown ────────────────────────────────────────────────────────────────

function Dropdown({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label?: string }) {
  return (
    <>
      <div className="lf-menu__scrim" onClick={onClose} />
      <div className="lf-menu" role="menu" aria-label={label}>
        {children}
      </div>
    </>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────

type IconName = 'phone' | 'mail' | 'chat' | 'chevron' | 'download' | 'trash' | 'upload';

/** The same 16px stroked set the sidebar draws; the words beside them carry the meaning. */
const ICON_PATHS: Record<IconName, string> = {
  phone: 'M5 4h4l2 5-3 2a16 16 0 0 0 5 5l2-3 5 2v4c0 1-1 2-2 2A17 17 0 0 1 3 6c0-1 1-2 2-2',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z',
  chevron: 'M6 9l6 6 6-6',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="lf-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  lead,
  editing,
  setEditing,
  patchLead,
  report,
}: {
  lead: Props['lead'];
  editing: boolean;
  setEditing: (v: boolean) => void;
  patchLead: (d: Record<string, unknown>) => Promise<void>;
  report: Report;
}) {
  const [form, setForm] = useState({
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    company: lead.company ?? '',
    jobTitle: lead.jobTitle ?? '',
    city: lead.city ?? '',
    country: lead.country ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    report(null);
    try {
      const patch: Record<string, string | undefined> = {};
      if (form.email !== (lead.email ?? '')) patch.email = form.email || undefined;
      if (form.phone !== (lead.phone ?? '')) patch.phone = form.phone || undefined;
      if (form.company !== (lead.company ?? '')) patch.company = form.company || undefined;
      if (form.jobTitle !== (lead.jobTitle ?? '')) patch.jobTitle = form.jobTitle || undefined;
      if (form.city !== (lead.city ?? '')) patch.city = form.city || undefined;
      if (form.country !== (lead.country ?? '')) patch.country = form.country || undefined;
      if (Object.keys(patch).length > 0) await patchLead(patch);
      setEditing(false);
    } catch (e) {
      report(messageOf(e));
    }
    setSaving(false);
  };

  type FieldKey = keyof typeof form;
  // Company and job title already sit in the record head, so they only appear
  // here while they are being edited.
  const fields: [string, string, FieldKey | null][] = [
    ['Email', lead.email ?? '—', 'email'],
    ['Phone', lead.phone ?? '—', 'phone'],
    ...(editing
      ? ([
          ['Company', lead.company ?? '—', 'company'],
          ['Job title', lead.jobTitle ?? '—', 'jobTitle'],
        ] as [string, string, FieldKey][])
      : []),
    ['City', lead.city ?? '—', 'city'],
    ['Country', lead.country ?? '—', 'country'],
    ['Industry', lead.industry ?? '—', null],
    ['Source', sentence(lead.source), null],
    ['Consent', sentence(lead.consentStatus), null],
    ['Created', fmtDate(lead.createdAt), null],
  ];

  return (
    <>
      <dl className="lf-kv">
        {fields.map(([label, value, key]) => {
          const edit = editing && key !== null;
          return (
            <div key={label} data-editing={edit || undefined}>
              <dt>{edit ? <label htmlFor={`lead-${key}`}>{label}</label> : label}</dt>
              <dd className={edit ? 'lf-kv__edit' : undefined}>
                {editing && key ? (
                  <input
                    id={`lead-${key}`}
                    className="lf-input"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                ) : (
                  value
                )}
              </dd>
            </div>
          );
        })}
        {lead.tags.length > 0 && (
          <div>
            <dt>Tags</dt>
            <dd className="lf-chips">
              {lead.tags.map((t) => (
                <Badge key={t} tone="slate">
                  {t}
                </Badge>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {editing && (
        <div className="lf-well__foot">
          <button type="button" className="lf-btn" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

// ── Timeline Tab ────────────────────────────────────────────────────────────

type Entry = { id: string; at: string } & (
  { kind: 'activity'; activity: Activity } | { kind: 'stage'; change: StageChange }
);

function TimelineTab({
  lead,
  activityTypes,
  router,
  report,
}: {
  lead: Props['lead'];
  activityTypes: ActivityType[];
  router: ReturnType<typeof useRouter>;
  report: Report;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ typeId: activityTypes[0]?.id ?? '', outcome: '', notes: '', durationMins: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.typeId) return;
    setSaving(true);
    report(null);
    try {
      await api('/api/v1/activities', {
        method: 'POST',
        body: JSON.stringify({
          typeId: form.typeId,
          leadId: lead.id,
          outcome: form.outcome || undefined,
          notes: form.notes || undefined,
          durationSecs: form.durationMins ? Number(form.durationMins) * 60 : undefined,
        }),
      });
      setForm({ typeId: activityTypes[0]?.id ?? '', outcome: '', notes: '', durationMins: '' });
      setShowForm(false);
      router.refresh();
    } catch (e) {
      report(messageOf(e));
    }
    setSaving(false);
  };

  // Activities and stage changes interleave into one trail. ISO strings sort
  // lexically, so no Date parsing is needed to order them.
  const entries: Entry[] = [
    ...lead.activities.map((activity): Entry => ({
      id: activity.id,
      at: activity.occurredAt,
      kind: 'activity',
      activity,
    })),
    ...lead.stageHistory.map((change): Entry => ({ id: change.id, at: change.createdAt, kind: 'stage', change })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <>
      {!showForm && (
        <div className="lf-tabpanel__bar">
          <button type="button" className="lf-btn" onClick={() => setShowForm(true)}>
            Log activity
          </button>
        </div>
      )}

      {showForm && (
        <form className="lf-well" onSubmit={handleSubmit}>
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-type">
              Type
            </label>
            <select
              id="activity-type"
              className="lf-select"
              value={form.typeId}
              onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
            >
              {activityTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-outcome">
              Outcome
            </label>
            <input
              id="activity-outcome"
              className="lf-input"
              value={form.outcome}
              onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Interested, No answer"
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-notes">
              Notes
            </label>
            <textarea
              id="activity-notes"
              className="lf-textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-duration">
              Duration (minutes)
            </label>
            <input
              id="activity-duration"
              className="lf-input"
              type="number"
              min="0"
              value={form.durationMins}
              onChange={(e) => setForm((f) => ({ ...f, durationMins: e.target.value }))}
            />
          </div>
          <div className="lf-well__foot">
            <button className="lf-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Log'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              disabled={saving}
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <p className="lf-hint">Nothing recorded yet. Log a call or send an email to start the timeline.</p>
      ) : (
        <div className="lf-rowlist lf-rowlist--log">
          {entries.map((entry) => (
            <div key={entry.id} className="lf-rowlist__row" data-kind={entry.kind}>
              <div className="lf-rowlist__main">
                {entry.kind === 'activity' ? (
                  <>
                    <div className="lf-rowlist__title">
                      {entry.activity.type.name}
                      {entry.activity.durationSecs != null && ` · ${Math.round(entry.activity.durationSecs / 60)} min`}
                    </div>
                    {entry.activity.outcome && <div className="lf-rowlist__body">{entry.activity.outcome}</div>}
                    {entry.activity.notes && <div className="lf-rowlist__meta">{entry.activity.notes}</div>}
                  </>
                ) : (
                  <>
                    <div className="lf-rowlist__title">
                      {entry.change.from
                        ? `Moved from ${entry.change.from} to ${entry.change.to}`
                        : `Entered ${entry.change.to}`}
                    </div>
                    {entry.change.reason && <div className="lf-rowlist__body">{entry.change.reason}</div>}
                    {(entry.change.changedBy || entry.change.changedBySystem) && (
                      <div className="lf-rowlist__meta">
                        {entry.change.changedBy ? `by ${entry.change.changedBy}` : 'by system'}
                      </div>
                    )}
                  </>
                )}
              </div>
              <time className="lf-rowlist__time" dateTime={entry.at}>
                {fmtDateTime(entry.at)}
              </time>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Tasks Tab ───────────────────────────────────────────────────────────────

function TasksTab({
  lead,
  taskTypes,
  router,
  report,
}: {
  lead: Props['lead'];
  taskTypes: TaskType[];
  router: ReturnType<typeof useRouter>;
  report: Report;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    typeId: taskTypes[0]?.id ?? '',
    title: '',
    dueAt: '',
    priority: 'MEDIUM',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.typeId || !form.dueAt) return;
    setSaving(true);
    report(null);
    try {
      await api('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          typeId: form.typeId,
          title: form.title,
          leadId: lead.id,
          dueAt: new Date(form.dueAt).toISOString(),
          priority: form.priority,
          description: form.description || undefined,
        }),
      });
      setForm({ typeId: taskTypes[0]?.id ?? '', title: '', dueAt: '', priority: 'MEDIUM', description: '' });
      setShowForm(false);
      router.refresh();
    } catch (e) {
      report(messageOf(e));
    }
    setSaving(false);
  };

  const completeTask = async (taskId: string) => {
    report(null);
    try {
      await api(`/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED', completedAt: new Date().toISOString() }),
      });
      router.refresh();
    } catch (e) {
      report(messageOf(e));
    }
  };

  return (
    <>
      {!showForm && (
        <div className="lf-tabpanel__bar">
          <button type="button" className="lf-btn" onClick={() => setShowForm(true)}>
            Add task
          </button>
        </div>
      )}

      {showForm && (
        <form className="lf-well" onSubmit={handleSubmit}>
          <div className="lf-field">
            <label className="lf-label" htmlFor="task-title">
              Title
            </label>
            <input
              id="task-title"
              className="lf-input"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="lf-well__cols">
            <div className="lf-field">
              <label className="lf-label" htmlFor="task-type">
                Type
              </label>
              <select
                id="task-type"
                className="lf-select"
                value={form.typeId}
                onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
              >
                {taskTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="task-priority">
                Priority
              </label>
              <select
                id="task-priority"
                className="lf-select"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                  <option key={p} value={p}>
                    {sentence(p)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="task-due">
              Due date
            </label>
            <input
              id="task-due"
              className="lf-input"
              type="date"
              required
              value={form.dueAt}
              onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="task-description">
              Description
            </label>
            <textarea
              id="task-description"
              className="lf-textarea"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="lf-well__foot">
            <button className="lf-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              disabled={saving}
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {lead.tasks.length === 0 ? (
        <p className="lf-hint">No open tasks.</p>
      ) : (
        <div className="lf-rowlist">
          {lead.tasks.map((t) => {
            const overdue = new Date(t.dueAt) < new Date();
            return (
              <div key={t.id} className="lf-rowlist__row">
                <div className="lf-rowlist__main">
                  <div className="lf-rowlist__title">{t.title}</div>
                  <div className="lf-rowlist__meta">
                    <span>{t.type.name}</span>
                    <Badge tone={toneFor(t.priority)}>{sentence(t.priority)}</Badge>
                    <span data-overdue={overdue || undefined}>
                      {overdue ? 'Overdue · due ' : 'Due '}
                      {fmtDate(t.dueAt)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  onClick={() => void completeTask(t.id)}
                >
                  Complete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Notes Tab ───────────────────────────────────────────────────────────────

function NotesTab({
  lead,
  patchLead,
  canEdit,
}: {
  lead: Props['lead'];
  patchLead: (d: Record<string, unknown>) => Promise<void>;
  canEdit: boolean;
}) {
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchLead({ notes });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* error shown by parent */
    }
    setSaving(false);
  };

  return (
    <>
      <textarea
        className="lf-textarea"
        rows={10}
        aria-label="Notes"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        readOnly={!canEdit}
        placeholder={canEdit ? 'Add notes about this lead…' : 'No notes yet.'}
      />
      {canEdit && (
        <div className="lf-well__foot">
          <button type="button" className="lf-btn" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
          {saved && (
            <span className="lf-hint" role="status">
              Saved
            </span>
          )}
        </div>
      )}
    </>
  );
}

// ── Documents Tab ───────────────────────────────────────────────────────────

function DocumentsTab({
  documents,
  leadId,
  canEdit,
  canDelete,
  report,
}: {
  documents: Doc[];
  leadId: string;
  canEdit: boolean;
  canDelete: boolean;
  report: Report;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    report(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('leadId', leadId);
      const res = await fetch('/api/v1/documents', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        report(data.detail ?? 'The upload failed.');
        return;
      }
      router.refresh();
    } catch {
      report('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  /**
   * Removes the file as well as the row, so it arms before it fires rather than
   * deleting on a single click. Only rendered for a viewer holding
   * `documents:DELETE`; the endpoint refuses everyone else regardless, so the
   * hidden button is a courtesy and not the control.
   */
  async function remove(id: string) {
    setBusy(true);
    report(null);
    try {
      const res = await fetch(`/api/v1/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        report(data.detail ?? 'The document could not be deleted.');
        return;
      }
      setArmed(null);
      router.refresh();
    } catch {
      report('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canEdit && (
        <div className="lf-tabpanel__bar">
          <label className="lf-btn" aria-disabled={busy}>
            <Icon name="upload" />
            {busy ? 'Uploading…' : 'Upload document'}
            <input type="file" onChange={upload} disabled={busy} hidden />
          </label>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="lf-hint">No documents attached to this lead.</p>
      ) : (
        <div className="lf-rowlist">
          {documents.map((d) => (
            <div key={d.id} className="lf-rowlist__row">
              <div className="lf-rowlist__main">
                <div className="lf-rowlist__title">{d.name}</div>
                <div className="lf-rowlist__meta">
                  {d.category && <Badge tone="slate">{d.category}</Badge>}
                  <span>{d.mimeType}</span>
                  <span>{fmtBytes(d.sizeBytes)}</span>
                  <span>{fmtDate(d.createdAt)}</span>
                </div>
              </div>
              {d.scanState === 'CLEAN' && (
                <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`/api/v1/documents/${d.id}/download`}>
                  <Icon name="download" />
                  Download
                </a>
              )}
              {canDelete &&
                (armed === d.id ? (
                  <span className="lf-rowlist__actions">
                    <span className="lf-hint">Delete the file?</span>
                    <button
                      type="button"
                      className="lf-btn lf-btn--danger lf-btn--sm"
                      disabled={busy}
                      onClick={() => void remove(d.id)}
                    >
                      {busy ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      type="button"
                      className="lf-btn lf-btn--secondary lf-btn--sm"
                      disabled={busy}
                      onClick={() => setArmed(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="lf-btn lf-btn--danger lf-btn--sm"
                    onClick={() => setArmed(d.id)}
                    aria-label={`Delete ${d.name}`}
                  >
                    <Icon name="trash" />
                    Delete
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** SCREAMING_CASE enum → "Sentence case". */
function sentence(v: string) {
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(v: string) {
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(v: string) {
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
