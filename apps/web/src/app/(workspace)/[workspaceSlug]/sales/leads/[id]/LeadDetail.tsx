'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import { useModuleBase } from '@/components/workspace/SalesLink';
import Field from '@/components/forms/Field';
import TaskComposer from '../../tasks/TaskComposer';
import StageReason, { asksForReason } from '@/components/workspace/StageReason';

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
  requiresReason: boolean;
  reasons: string[];
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
  /** null while open; INVALID, DUPLICATE or ARCHIVED once closed out. */
  status?: string | null;
  email: string | null;
  phone: string | null;
  /** E.164, for wa.me — which refuses a number typed in local form. */
  phoneNormalized: string | null;
  /** Null when the viewer's role may not see the main number either. */
  phones: { id: string; raw: string; normalized: string; label: string | null; isWhatsapp: boolean }[] | null;
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
  /** The viewer's own next obligation on this lead. */
  nextFollowUpAt: string | null;
  /** What to say when they have none — a statement about them, not the lead. */
  followUpEmptyLabel: string;
  lastActivityAt: string | null;
  createdAt: string;
  stage: { key: string; name: string };
  /** The reason or sub-status it entered its stage with. */
  stageReason: string | null;
  /** Why distribution chose the owner, when it did. */
  assignedWhy: string | null;
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
  // A dropped connection rejects with a bare TypeError ("Failed to fetch"). Say what
  // it means for the person holding the phone: nothing was saved, and trying again
  // is safe — every write here sets a value rather than adding one.
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } }).catch(
    () => {
      throw new Error('Could not reach the server. Nothing was saved — check the connection and try again.');
    },
  );
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
  /** A stage that asks for a reason waits here until one is given. */
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);

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

  /** Close-out is the non-administrator's alternative to delete: the lead leaves working lists, history kept. */
  const handleCloseOut = (status: 'INVALID' | 'DUPLICATE' | 'ARCHIVED' | 'OPEN') => {
    setShowMore(false);
    void withBusy(async () => {
      let duplicateOfId: string | null = null;
      if (status === 'DUPLICATE') {
        const ref = window.prompt('Reference or id of the lead this one duplicates (optional):', '');
        if (ref === null) return;
        duplicateOfId = /^c[a-z0-9]{20,}$/.test(ref.trim()) ? ref.trim() : null;
      }
      await api(`/api/v1/leads/${lead.id}/close-out`, {
        method: 'POST',
        body: JSON.stringify({ status, duplicateOfId }),
      });
      router.refresh();
    })();
  };

  const handleAssign = (userId: string | null) => {
    setShowAssign(false);
    void withBusy(async () => {
      await patchLead({ ownerId: userId });
    })();
  };

  const moveTo = (target: Stage, reason: string) =>
    void withBusy(async () => {
      await patchLead({ stageId: target.id, ...(reason && { stageReason: reason }) });
      setPendingStage(null);
    })();

  const handleStageChange = (stageKey: string) => {
    setShowStageMenu(false);
    const target = stages.find((s) => s.key === stageKey);
    if (!target) return;
    if (asksForReason(target)) setPendingStage(target);
    else moveTo(target, '');
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
            <OverviewTab
              lead={lead}
              editing={editing}
              setEditing={setEditing}
              patchLead={patchLead}
              canEdit={canEdit}
            />
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
            {/* The assisted call is the one primary action on a lead: placed through
                the workspace's provider with guidance on screen. A plain handset
                dial stays beside it, and says it carries no assistance. */}
            <div className="lf-actionrow">
              <button
                className="lf-btn lf-btn--sm"
                disabled={!lead.phone}
                title={
                  lead.phone ? 'Place the call through the workspace provider with live guidance' : 'No phone number'
                }
                onClick={() => lead.phone && router.push(`${base}/calls/new?leadId=${lead.id}`)}
              >
                Call with AI assistance
              </button>
              <button
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={!lead.phone}
                title={lead.phone ? `Phone ${lead.phone} from this device — no AI assistance` : 'No phone number'}
                onClick={() => lead.phone && window.open(`tel:${lead.phone}`)}
              >
                Phone
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
                  onClick={() => window.open(waLink(lead.phoneNormalized ?? lead.phone!))}
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
                      {canEdit && !lead.status && (
                        <>
                          <button className="lf-menu__item" disabled={busy} onClick={() => handleCloseOut('INVALID')}>
                            Mark invalid
                          </button>
                          <button className="lf-menu__item" disabled={busy} onClick={() => handleCloseOut('DUPLICATE')}>
                            Mark duplicate…
                          </button>
                          <button className="lf-menu__item" disabled={busy} onClick={() => handleCloseOut('ARCHIVED')}>
                            Archive
                          </button>
                        </>
                      )}
                      {canEdit && lead.status && (
                        <button className="lf-menu__item" disabled={busy} onClick={() => handleCloseOut('OPEN')}>
                          Reopen lead
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

            {pendingStage && (
              <div style={{ margin: 'var(--lf-space-3) 0' }}>
                <div className="lf-label" style={{ marginBottom: 6 }}>
                  {pendingStage.requiresReason ? 'Why is it moving?' : 'Reason (optional)'}
                </div>
                <StageReason
                  stage={pendingStage}
                  busy={busy}
                  onMove={(reason) => moveTo(pendingStage, reason)}
                  onCancel={() => setPendingStage(null)}
                />
              </div>
            )}

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
                  {lead.stageReason && (
                    <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{lead.stageReason}</div>
                  )}
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
                  {lead.assignedWhy && lead.owner && (
                    <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', textAlign: 'right' }}>
                      {lead.assignedWhy}
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>
                  <Badge value={lead.priority} />
                  {lead.status && <Badge value={lead.status} tone="slate" />}
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
                <dt>{followUpOverdue ? 'Your follow-up is overdue' : 'Your next follow-up'}</dt>
                <dd style={followUpOverdue ? { color: 'var(--lf-vermillion)' } : undefined}>
                  {lead.nextFollowUpAt ? fmtDate(lead.nextFollowUpAt) : lead.followUpEmptyLabel}
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
  canEdit,
}: {
  lead: Props['lead'];
  editing: boolean;
  setEditing: (v: boolean) => void;
  patchLead: (d: Record<string, unknown>) => Promise<void>;
  canEdit: boolean;
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
        {lead.phones && (lead.phones.length > 0 || canEdit) && (
          <OtherNumbers phones={lead.phones} leadId={lead.id} canEdit={canEdit} />
        )}
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

const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;

/** A lead's numbers beyond the main one (LeadPhone), each with its WhatsApp flag. */
function OtherNumbers({
  phones,
  leadId,
  canEdit,
}: {
  phones: NonNullable<LeadData['phones']>;
  leadId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const blank = { phone: '', label: '', isWhatsapp: true };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (write: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await write();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 'var(--lf-space-4)' }}>
      <div className="lf-label">Other numbers</div>
      {err && (
        <div className="lf-alert" role="alert" style={{ margin: '6px 0', fontSize: 'var(--lf-text-sm)' }}>
          {err}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6 }}>
        {phones.map((p) => (
          <li
            key={p.id}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--lf-text-sm)' }}
          >
            <a href={`tel:${p.raw}`}>{p.raw}</a>
            {p.label && <span style={{ color: 'var(--lf-ink-3)' }}>{p.label}</span>}
            {p.isWhatsapp && (
              <a href={waLink(p.normalized)} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            )}
            {canEdit && (
              <button
                className="lf-btn lf-btn--ghost lf-btn--sm"
                disabled={busy}
                aria-label={`Remove ${p.raw}`}
                onClick={() => run(() => api(`/api/v1/leads/${leadId}/phones?phoneId=${p.id}`, { method: 'DELETE' }))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {phones.length === 0 && <li style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>None yet.</li>}
      </ul>
      {canEdit && (
        <form
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/api/v1/leads/${leadId}/phones`, { method: 'POST', body: JSON.stringify(form) });
              setForm(blank);
            });
          }}
        >
          <input
            className="lf-input"
            type="tel"
            required
            placeholder="Number"
            aria-label="Another number"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--lf-text-sm)' }}
          />
          <input
            className="lf-input"
            placeholder="Label, e.g. Office"
            aria-label="Label"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            style={{ flex: '1 1 120px', minWidth: 0, fontSize: 'var(--lf-text-sm)' }}
          />
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
            <input
              type="checkbox"
              checked={form.isWhatsapp}
              onChange={(e) => setForm((f) => ({ ...f, isWhatsapp: e.target.checked }))}
            />
            On WhatsApp
          </label>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !form.phone.trim()}>
            Add number
          </button>
        </form>
      )}
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
          <Field label="Type" htmlFor="activity-type">
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
          </Field>
          <Field label="Outcome" htmlFor="activity-outcome">
            <input
              id="activity-outcome"
              className="lf-input"
              value={form.outcome}
              onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Interested, No answer..."
            />
          </Field>
          <Field label="Notes" htmlFor="activity-notes">
            <textarea
              id="activity-notes"
              className="lf-input"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor="activity-duration">
            <input
              id="activity-duration"
              className="lf-input"
              type="number"
              min="0"
              value={form.durationMins}
              onChange={(e) => setForm((f) => ({ ...f, durationMins: e.target.value }))}
            />
          </Field>
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
  const [err, setErr] = useState<string | null>(null);

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
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
        Tasks
      </div>
      <div style={{ marginBottom: 'var(--lf-space-4)' }}>
        <TaskComposer taskTypes={taskTypes} assignees={[]} canAssignOthers={false} leadId={lead.id} />
      </div>
      {err && (
        <div className="lf-alert" role="alert" style={{ marginBottom: 'var(--lf-space-4)' }}>
          {err}
        </div>
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
  const [hint, setHint] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  /**
   * "Take photo" opens the camera where the device has one (a phone, or the app's
   * WebView) and a picker elsewhere. When the camera permission is refused, or the
   * person backs out, no file arrives and no change event fires — only `cancel` —
   * so that is where the way forward is explained instead of doing nothing.
   */
  useEffect(() => {
    const input = camera.current;
    if (!input) return;
    const cancelled = () =>
      setHint(
        'No photo was added. If the camera is blocked, allow it for this app in the phone’s Settings, or use Upload document to choose a file.',
      );
    input.addEventListener('cancel', cancelled);
    return () => input.removeEventListener('cancel', cancelled);
  }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setHint(null);
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
      setError('Could not reach the server. The file was not uploaded — check the connection and try again.');
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
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            <label className="lf-btn lf-btn--secondary lf-btn--sm" style={{ cursor: busy ? 'progress' : 'pointer' }}>
              Take photo
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={upload}
                disabled={busy}
                style={{ display: 'none' }}
              />
            </label>
            <label className="lf-btn lf-btn--sm" style={{ cursor: busy ? 'progress' : 'pointer' }}>
              {busy ? 'Uploading…' : 'Upload document'}
              <input type="file" onChange={upload} disabled={busy} style={{ display: 'none' }} />
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="lf-alert" role="alert" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {error}
        </div>
      )}
      {hint && !error && (
        <p
          role="status"
          style={{ margin: '0 0 var(--lf-space-3)', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}
        >
          {hint}
        </p>
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
