'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
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

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: string;
  status: string;
  completedAt: string | null;
  type: { name: string; key: string; color: string };
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

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
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

  // -- Assign dropdown --
  const [showAssign, setShowAssign] = useState(false);

  // -- Stage dropdown --
  const [showStageMenu, setShowStageMenu] = useState(false);

  // -- More menu (edit / delete) --
  const [showMore, setShowMore] = useState(false);

  function withBusy(fn: () => Promise<void>) {
    return async () => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e: any) {
        setError(e.message);
      }
      setBusy(false);
    };
  }

  async function patchLead(data: Record<string, unknown>) {
    await api(`/api/v1/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(data) });
    router.refresh();
  }

  const handleDelete = withBusy(async () => {
    if (!window.confirm(`Delete lead "${lead.fullName}"? This cannot be undone.`)) return;
    await api(`/api/v1/leads/${lead.id}`, { method: 'DELETE' });
    router.push(base + '/leads');
  });

  const handleAssign = (userId: string | null) => {
    setShowAssign(false);
    void withBusy(async () => {
      await patchLead({ ownerId: userId });
    })();
  };

  const handleStageChange = (stageKey: string) => {
    setShowStageMenu(false);
    const target = stages.find((s) => s.key === stageKey);
    if (!target) return;
    void withBusy(async () => {
      await patchLead({ stageId: target.id });
    })();
  };

  const followUpOverdue = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) < new Date() : false;
  const openTaskCount = lead.tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;

  return (
    <>
      {error && (
        <div className="lf-alert" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {error}
        </div>
      )}

      {/* Record on the left; state and actions on the right.
          The header used to carry eight controls and six facts in one wrapping
          flex row, and every fact worth knowing about the lead sat behind the
          Overview tab. The side panel is where "what state is this in, what can
          I do about it" lives on every record screen now — visible whichever
          tab is open, sticky while the timeline scrolls. */}
      <header className="lf-record-head" style={{ marginBottom: 'var(--lf-space-4)' }}>
        <span className="lf-avatar lf-avatar--lg">
          {lead.fullName
            .split(' ')
            .slice(0, 2)
            .map((p) => p[0])
            .join('')}
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-record-head__title">{lead.fullName}</h1>
          <div className="lf-record-head__meta">
            {[lead.jobTitle, lead.company].filter(Boolean).join(' · ')}
            {(lead.jobTitle || lead.company) && ' · '}
            <span className="lf-num">{lead.reference}</span>
          </div>
        </div>
      </header>

      <div className="lf-detail">
        <div className="lf-detail__main">
          <nav className="lf-tabs" style={{ margin: '0 0 var(--lf-space-4)' }} role="tablist">
            {TABS.map((t) => (
              <button key={t} className="lf-tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t}
                {t === 'Tasks' && lead.tasks.length > 0 && <span className="lf-tab__count">{lead.tasks.length}</span>}
                {t === 'Timeline' && lead.activities.length > 0 && (
                  <span className="lf-tab__count">{lead.activities.length}</span>
                )}
              </button>
            ))}
          </nav>

          {tab === 'Overview' && (
            <OverviewTab lead={lead} editing={editing} setEditing={setEditing} patchLead={patchLead} />
          )}
          {tab === 'Timeline' && <TimelineTab lead={lead} activityTypes={activityTypes} router={router} />}
          {tab === 'Tasks' && <TasksTab lead={lead} taskTypes={taskTypes} router={router} />}
          {tab === 'Notes' && <NotesTab lead={lead} patchLead={patchLead} canEdit={canEdit} />}
          {tab === 'Documents' && (
            <DocumentsTab
              documents={lead.documents}
              leadId={lead.id}
              canEdit={canEdit}
              canDelete={canDeleteDocuments}
            />
          )}
        </div>

        <aside className="lf-detail__side">
          <section className="lf-panel lf-panel--tight">
            {/* Call is the one primary action on a lead; everything else is
                secondary, and Edit / Delete stay behind More. */}
            <div className="lf-actionrow">
              <button
                className="lf-btn lf-btn--sm"
                disabled={!lead.phone}
                title={lead.phone ? `Call ${lead.phone}` : 'No phone number'}
                onClick={() => lead.phone && window.open(`tel:${lead.phone}`)}
              >
                Call
              </button>
              <button
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={!lead.email}
                title={lead.email ? `Email ${lead.email}` : 'No email address'}
                onClick={() => lead.email && window.open(`mailto:${lead.email}`)}
              >
                Email
              </button>
              {lead.phone && (
                <button
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  onClick={() => window.open(`https://wa.me/${lead.phone!.replace(/[^0-9]/g, '')}`)}
                >
                  WhatsApp
                </button>
              )}
              {(canEdit || canDelete) && (
                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                  <button
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    aria-haspopup="menu"
                    aria-expanded={showMore}
                    onClick={() => setShowMore((v) => !v)}
                  >
                    More &#9662;
                  </button>
                  {showMore && (
                    <Dropdown onClose={() => setShowMore(false)}>
                      {canEdit && (
                        <button
                          className="lf-menu__item"
                          onClick={() => {
                            setShowMore(false);
                            setEditing(!editing);
                            setTab('Overview');
                          }}
                        >
                          {editing ? 'Cancel edit' : 'Edit details'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="lf-menu__item"
                          style={{ color: 'var(--lf-vermillion)' }}
                          disabled={busy}
                          onClick={() => {
                            setShowMore(false);
                            void handleDelete();
                          }}
                        >
                          Delete lead…
                        </button>
                      )}
                    </Dropdown>
                  )}
                </div>
              )}
            </div>

            <dl className="lf-kv">
              <div>
                <dt>Stage</dt>
                <dd style={{ position: 'relative' }}>
                  <button
                    className="lf-kv__btn"
                    aria-haspopup="menu"
                    aria-expanded={showStageMenu}
                    onClick={() => setShowStageMenu((v) => !v)}
                  >
                    {lead.stage.name} &#9662;
                  </button>
                  {showStageMenu && (
                    <Dropdown onClose={() => setShowStageMenu(false)}>
                      {stages.map((s) => (
                        <button
                          key={s.key}
                          className="lf-menu__item"
                          aria-current={s.key === lead.stage.key ? 'true' : undefined}
                          onClick={() => handleStageChange(s.key)}
                        >
                          {s.name}
                        </button>
                      ))}
                    </Dropdown>
                  )}
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd style={{ position: 'relative' }}>
                  {canAssign ? (
                    <>
                      <button
                        className="lf-kv__btn"
                        aria-haspopup="menu"
                        aria-expanded={showAssign}
                        onClick={() => setShowAssign((v) => !v)}
                      >
                        {lead.owner?.fullName ?? (
                          <em style={{ fontStyle: 'normal', color: 'var(--lf-brass)' }}>Unassigned</em>
                        )}{' '}
                        &#9662;
                      </button>
                      {showAssign && (
                        <Dropdown onClose={() => setShowAssign(false)}>
                          <button
                            className="lf-menu__item"
                            style={{ color: 'var(--lf-vermillion)' }}
                            onClick={() => handleAssign(null)}
                          >
                            Unassign
                          </button>
                          {users.map((u) => (
                            <button
                              key={u.id}
                              className="lf-menu__item"
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
                  <Badge value={lead.priority} />
                </dd>
              </div>
              <div>
                <dt>SLA</dt>
                <dd>
                  <Badge value={lead.slaState} />
                </dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>
                  <span className="lf-score" title={`Lead score ${lead.score} of 100`}>
                    <span className="lf-score__bar">
                      <span className="lf-score__fill" style={{ width: `${lead.score}%` }} />
                    </span>
                    {lead.score}
                    {lead.grade ? ` · ${lead.grade}` : ''}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{followUpOverdue ? 'Follow-up overdue' : 'Next follow-up'}</dt>
                <dd style={followUpOverdue ? { color: 'var(--lf-vermillion)' } : undefined}>
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
          </section>
        </aside>
      </div>
    </>
  );
}

// ── Dropdown ────────────────────────────────────────────────────────────────

function Dropdown({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="lf-menu__scrim" onClick={onClose} />
      <div className="lf-menu" role="menu">
        {children}
      </div>
    </>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  lead,
  editing,
  setEditing,
  patchLead,
}: {
  lead: Props['lead'];
  editing: boolean;
  setEditing: (v: boolean) => void;
  patchLead: (d: Record<string, unknown>) => Promise<void>;
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
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
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
    } catch (e: any) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const fields: [string, string, keyof typeof form | null][] = [
    ['Email', lead.email ?? '—', 'email'],
    ['Phone', lead.phone ?? '—', 'phone'],
    ['Company', lead.company ?? '—', 'company'],
    ['Job title', lead.jobTitle ?? '—', 'jobTitle'],
    ['City', lead.city ?? '—', 'city'],
    ['Country', lead.country ?? '—', 'country'],
    ['Industry', lead.industry ?? '—', null],
    ['Source', lead.source.replace(/_/g, ' ').toLowerCase(), null],
    ['Consent', lead.consentStatus.toLowerCase(), null],
    ['Created', fmtDate(lead.createdAt), null],
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
          Details
        </div>
        {err && (
          <div className="lf-alert" style={{ marginBottom: 'var(--lf-space-3)', fontSize: 'var(--lf-text-sm)' }}>
            {err}
          </div>
        )}
        <dl className="lf-facts" style={{ margin: 0 }}>
          {fields.map(([label, value, key]) => (
            <div key={label}>
              <dt className="lf-label">{label}</dt>
              <dd style={{ margin: '3px 0 0', fontSize: 'var(--lf-text-sm)', overflowWrap: 'anywhere' }}>
                {editing && key ? (
                  <input
                    className="lf-input"
                    style={{ width: '100%', fontSize: 'var(--lf-text-sm)' }}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
          {lead.tags.length > 0 && (
            <div>
              <dt className="lf-label">Tags</dt>
              <dd style={{ margin: '3px 0 0', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-4)' }}>
            <button className="lf-btn lf-btn--sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Timeline Tab ────────────────────────────────────────────────────────────

function TimelineTab({
  lead,
  activityTypes,
  router,
}: {
  lead: Props['lead'];
  activityTypes: ActivityType[];
  router: ReturnType<typeof useRouter>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ typeId: activityTypes[0]?.id ?? '', outcome: '', notes: '', durationMins: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.typeId) return;
    setSaving(true);
    setErr(null);
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
    } catch (e: any) {
      setErr(e.message);
    }
    setSaving(false);
  };

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-eyebrow">Activity timeline</div>
        <button className="lf-btn lf-btn--sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Log activity'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            marginBottom: 'var(--lf-space-4)',
            display: 'grid',
            gap: 'var(--lf-space-3)',
            padding: 'var(--lf-space-4)',
            border: '1px solid var(--lf-line)',
            borderRadius: 6,
          }}
        >
          {err && (
            <div className="lf-alert" style={{ fontSize: 'var(--lf-text-sm)' }}>
              {err}
            </div>
          )}
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-type">
              Type
            </label>
            <select
              id="activity-type"
              className="lf-input"
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
              placeholder="e.g. Interested, No answer..."
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="activity-notes">
              Notes
            </label>
            <textarea
              id="activity-notes"
              className="lf-input"
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
          <button className="lf-btn lf-btn--sm" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Log'}
          </button>
        </form>
      )}

      {lead.activities.length === 0 ? (
        <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: 0 }}>
          Nothing recorded yet. Log a call or send an email to start the timeline.
        </p>
      ) : (
        <div className="lf-timeline">
          {lead.activities.map((a) => (
            <div
              key={a.id}
              className="lf-timeline__item"
              data-kind={a.type.key.startsWith('call') ? 'call' : 'default'}
            >
              <span className="lf-timeline__dot" aria-hidden="true" />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--lf-space-3)' }}>
                <strong style={{ fontSize: 'var(--lf-text-sm)', fontFamily: 'var(--lf-font-ui)', fontWeight: 600 }}>
                  {a.type.name}
                </strong>
                <span className="lf-timeline__time">{fmtDateTime(a.occurredAt)}</span>
                {a.durationSecs != null && (
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                    {Math.round(a.durationSecs / 60)}m
                  </span>
                )}
              </div>
              {a.outcome && (
                <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', marginTop: 2 }}>{a.outcome}</div>
              )}
              {a.notes && (
                <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', marginTop: 2 }}>{a.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tasks Tab ───────────────────────────────────────────────────────────────

function TasksTab({
  lead,
  taskTypes,
  router,
}: {
  lead: Props['lead'];
  taskTypes: TaskType[];
  router: ReturnType<typeof useRouter>;
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
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.typeId || !form.dueAt) return;
    setSaving(true);
    setErr(null);
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
    } catch (e: any) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const completeTask = async (taskId: string) => {
    try {
      await api(`/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED', completedAt: new Date().toISOString() }),
      });
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-eyebrow">Tasks</div>
        <button className="lf-btn lf-btn--sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Add task'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            marginBottom: 'var(--lf-space-4)',
            display: 'grid',
            gap: 'var(--lf-space-3)',
            padding: 'var(--lf-space-4)',
            border: '1px solid var(--lf-line)',
            borderRadius: 6,
          }}
        >
          {err && (
            <div className="lf-alert" style={{ fontSize: 'var(--lf-text-sm)' }}>
              {err}
            </div>
          )}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-3)' }}>
            <div className="lf-field">
              <label className="lf-label" htmlFor="task-type">
                Type
              </label>
              <select
                id="task-type"
                className="lf-input"
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
                className="lf-input"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
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
              className="lf-input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <button className="lf-btn lf-btn--sm" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Create'}
          </button>
        </form>
      )}

      {lead.tasks.length === 0 ? (
        <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: 0 }}>No open tasks.</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
          {lead.tasks.map((t) => {
            const overdue = t.status !== 'COMPLETED' && new Date(t.dueAt) < new Date();
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--lf-space-3)',
                  padding: 'var(--lf-space-3)',
                  border: '1px solid var(--lf-line)',
                  borderRadius: 6,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 'var(--lf-text-sm)' }}>{t.title}</div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--lf-space-2)',
                      marginTop: 4,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{t.type.name}</span>
                    <Badge value={t.priority} />
                    <Badge value={t.status} />
                    <span
                      style={{
                        fontSize: 'var(--lf-text-xs)',
                        color: overdue ? 'var(--lf-vermillion)' : 'var(--lf-ink-3)',
                        fontWeight: overdue ? 600 : 400,
                      }}
                    >
                      Due {fmtDate(t.dueAt)}
                    </span>
                  </div>
                </div>
                {(t.status === 'OPEN' || t.status === 'IN_PROGRESS') && (
                  <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => completeTask(t.id)}>
                    Complete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
      await patchLead({ notes } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* error shown by parent */
    }
    setSaving(false);
  };

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
        Notes
      </div>
      <textarea
        className="lf-input"
        rows={10}
        style={{ width: '100%', resize: 'vertical' }}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        readOnly={!canEdit}
        placeholder={canEdit ? 'Add notes about this lead...' : 'No notes yet.'}
      />
      {canEdit && (
        <div
          style={{ display: 'flex', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)', alignItems: 'center' }}
        >
          <button className="lf-btn lf-btn--sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save notes'}
          </button>
          {saved && <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-viridian)' }}>Saved</span>}
        </div>
      )}
    </section>
  );
}

// ── Documents Tab ───────────────────────────────────────────────────────────

function DocumentsTab({
  documents,
  leadId,
  canEdit,
  canDelete,
}: {
  documents: Doc[];
  leadId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('leadId', leadId);
      const res = await fetch('/api/v1/documents', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'The upload failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
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
    setError(null);
    try {
      const res = await fetch(`/api/v1/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'The document could not be deleted.');
        return;
      }
      setArmed(null);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--lf-space-3)',
          marginBottom: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-eyebrow">Documents</div>
        {canEdit && (
          <label className="lf-btn lf-btn--sm" style={{ cursor: busy ? 'progress' : 'pointer' }}>
            {busy ? 'Uploading…' : 'Upload document'}
            <input type="file" onChange={upload} disabled={busy} style={{ display: 'none' }} />
          </label>
        )}
      </div>

      {error && (
        <div className="lf-alert" role="alert" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: 0 }}>
          No documents attached to this lead.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
          {documents.map((d) => (
            <div
              key={d.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--lf-space-3)',
                padding: 'var(--lf-space-3)',
                border: '1px solid var(--lf-line)',
                borderRadius: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 'var(--lf-text-sm)' }}>{d.name}</div>
                <div style={{ display: 'flex', gap: 'var(--lf-space-2)', marginTop: 4, flexWrap: 'wrap' }}>
                  {d.category && <Badge tone="slate">{d.category}</Badge>}
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{d.mimeType}</span>
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                    {fmtBytes(d.sizeBytes)}
                  </span>
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                    {fmtDate(d.createdAt)}
                  </span>
                </div>
              </div>
              {d.scanState === 'CLEAN' && (
                <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`/api/v1/documents/${d.id}/download`}>
                  Download
                </a>
              )}
              {canDelete &&
                (armed === d.id ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-2)' }}>Delete the file?</span>
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
                    Delete
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
