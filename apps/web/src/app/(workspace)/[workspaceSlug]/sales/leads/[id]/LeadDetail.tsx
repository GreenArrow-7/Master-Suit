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

  return (
    <>
      {error && (
        <div className="lf-alert" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {error}
        </div>
      )}

      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--lf-space-4)',
          margin: 'var(--lf-space-3) 0 var(--lf-space-4)',
        }}
      >
        <span className="lf-avatar" style={{ width: 44, height: 44, fontSize: 'var(--lf-text-base)' }}>
          {lead.fullName
            .split(' ')
            .slice(0, 2)
            .map((p) => p[0])
            .join('')}
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            {lead.fullName}
          </h1>
          {(lead.company || lead.jobTitle) && (
            <div style={{ marginTop: 2, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              {[lead.jobTitle, lead.company].filter(Boolean).join(' · ')}
            </div>
          )}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginTop: 6, flexWrap: 'wrap' }}
          >
            <span className="lf-num" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              {lead.reference}
            </span>
            <Badge value={lead.priority} />
            <Badge value={lead.slaState} />
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
              Owner:{' '}
              {lead.owner?.fullName ?? <em style={{ color: 'var(--lf-wine-700)', fontStyle: 'normal' }}>Unassigned</em>}
            </span>
            <span className="lf-score" title={`Lead score ${lead.score} of 100`}>
              <span className="lf-score__bar">
                <span className="lf-score__fill" style={{ width: `${lead.score}%` }} />
              </span>
              Score {lead.score}
              {lead.grade ? ` · ${lead.grade}` : ''}
            </span>
          </div>
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 'var(--lf-space-2)',
            flexWrap: 'wrap',
            position: 'relative',
          }}
        >
          {/* Call — the one primary action on a lead. */}
          <button
            className="lf-btn lf-btn--sm"
            disabled={!lead.phone}
            title={lead.phone ? `Call ${lead.phone}` : 'No phone number'}
            onClick={() => lead.phone && window.open(`tel:${lead.phone}`)}
          >
            Call
          </button>

          {/* Email */}
          <button
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={!lead.email}
            title={lead.email ? `Email ${lead.email}` : 'No email address'}
            onClick={() => lead.email && window.open(`mailto:${lead.email}`)}
          >
            Email
          </button>

          {/* WhatsApp */}
          {lead.phone && (
            <button
              className="lf-btn lf-btn--secondary lf-btn--sm"
              onClick={() => window.open(`https://wa.me/${lead.phone!.replace(/[^0-9]/g, '')}`)}
            >
              WhatsApp
            </button>
          )}

          {/* Stage change */}
          <div style={{ position: 'relative' }}>
            <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setShowStageMenu((v) => !v)}>
              Stage &#9662;
            </button>
            {showStageMenu && (
              <Dropdown onClose={() => setShowStageMenu(false)}>
                {stages.map((s) => (
                  <button
                    key={s.key}
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    style={{ width: '100%', textAlign: 'left', fontWeight: s.key === lead.stage.key ? 600 : 400 }}
                    onClick={() => handleStageChange(s.key)}
                  >
                    {s.name}
                  </button>
                ))}
              </Dropdown>
            )}
          </div>

          {/* Assign */}
          {canAssign && (
            <div style={{ position: 'relative' }}>
              <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setShowAssign((v) => !v)}>
                Assign &#9662;
              </button>
              {showAssign && (
                <Dropdown onClose={() => setShowAssign(false)}>
                  <button
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    style={{ width: '100%', textAlign: 'left', color: 'var(--lf-vermillion)' }}
                    onClick={() => handleAssign(null)}
                  >
                    Unassign
                  </button>
                  {users.map((u) => (
                    <button
                      key={u.id}
                      className="lf-btn lf-btn--ghost lf-btn--sm"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => handleAssign(u.id)}
                    >
                      {u.fullName}
                    </button>
                  ))}
                </Dropdown>
              )}
            </div>
          )}

          {/* Edit and Delete live behind More: neither is a moment-to-moment
              action, and a permanently red Delete outshouted every real one. */}
          {(canEdit || canDelete) && (
            <div style={{ position: 'relative' }}>
              <button
                className="lf-btn lf-btn--secondary lf-btn--sm"
                aria-haspopup="menu"
                onClick={() => setShowMore((v) => !v)}
              >
                More &#9662;
              </button>
              {showMore && (
                <Dropdown onClose={() => setShowMore(false)}>
                  {canEdit && (
                    <button
                      className="lf-btn lf-btn--ghost lf-btn--sm"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => {
                        setShowMore(false);
                        setEditing(!editing);
                      }}
                    >
                      {editing ? 'Cancel edit' : 'Edit details'}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      className="lf-btn lf-btn--ghost lf-btn--sm"
                      style={{ width: '100%', textAlign: 'left', color: 'var(--lf-vermillion)' }}
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
      </header>

      {/* Tabs */}
      <nav className="lf-tabs" style={{ margin: 'var(--lf-space-5) 0 var(--lf-space-4)' }} role="tablist">
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

      {/* Tab content */}
      {tab === 'Overview' && (
        <OverviewTab lead={lead} editing={editing} setEditing={setEditing} patchLead={patchLead} />
      )}
      {tab === 'Timeline' && <TimelineTab lead={lead} activityTypes={activityTypes} router={router} />}
      {tab === 'Tasks' && <TasksTab lead={lead} taskTypes={taskTypes} router={router} />}
      {tab === 'Notes' && <NotesTab lead={lead} patchLead={patchLead} canEdit={canEdit} />}
      {tab === 'Documents' && <DocumentsTab documents={lead.documents} leadId={lead.id} canEdit={canEdit} />}
    </>
  );
}

// ── Dropdown ────────────────────────────────────────────────────────────────

function Dropdown({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={onClose} />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          marginTop: 4,
          zIndex: 10,
          background: 'var(--lf-surface)',
          border: '1px solid var(--lf-line)',
          borderRadius: 6,
          padding: 'var(--lf-space-1)',
          minWidth: 180,
          boxShadow: '0 4px 12px rgba(0,0,0,.12)',
          maxHeight: 280,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
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

  const openTasks = lead.tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;
  const lastActivity = lead.lastActivityAt ? fmtDate(lead.lastActivityAt) : '—';
  const nextFollowUp = lead.nextFollowUpAt;
  const isOverdue = nextFollowUp ? new Date(nextFollowUp) < new Date() : false;

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

  const pulse: { label: string; value: string; color?: string }[] = [
    { label: 'Open tasks', value: String(openTasks) },
    { label: 'Activities', value: String(lead.activities.length) },
    { label: 'Last activity', value: lastActivity },
    {
      label: isOverdue ? 'Follow-up overdue' : 'Next follow-up',
      value: nextFollowUp ? fmtDate(nextFollowUp) : '—',
      color: isOverdue ? 'var(--lf-vermillion)' : undefined,
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      {/* One sentence about the lead, not four boxes: hairline-separated
          figures, the same fact-family the dashboards speak. */}
      <section className="lf-card" style={{ padding: 'var(--lf-space-4) var(--lf-space-5)' }}>
        <div className="lf-stat-strip lf-stat-strip--light">
          {pulse.map((item) => (
            <div key={item.label}>
              <span className="lf-figure" style={{ fontSize: '1.4rem', color: item.color }}>
                {item.value}
              </span>
              <span className="lf-eyebrow">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

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
            <label className="lf-label">Type</label>
            <select
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
            <label className="lf-label">Outcome</label>
            <input
              className="lf-input"
              value={form.outcome}
              onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Interested, No answer..."
            />
          </div>
          <div className="lf-field">
            <label className="lf-label">Notes</label>
            <textarea
              className="lf-input"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="lf-field">
            <label className="lf-label">Duration (minutes)</label>
            <input
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
            <label className="lf-label">Title</label>
            <input
              className="lf-input"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-3)' }}>
            <div className="lf-field">
              <label className="lf-label">Type</label>
              <select
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
              <label className="lf-label">Priority</label>
              <select
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
            <label className="lf-label">Due date</label>
            <input
              className="lf-input"
              type="date"
              required
              value={form.dueAt}
              onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
            />
          </div>
          <div className="lf-field">
            <label className="lf-label">Description</label>
            <textarea
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

function DocumentsTab({ documents, leadId, canEdit }: { documents: Doc[]; leadId: string; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
