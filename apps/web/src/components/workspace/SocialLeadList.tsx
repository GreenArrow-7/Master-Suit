'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The Social Leads queue, and the detail drawer behind it.
 *
 * A salesperson scanning this needs four things per row: who, what they asked,
 * what they asked it *about*, and how urgent. Provider ids and webhook
 * internals are not on the row — "Price?" is unactionable without the post it
 * was left on, and a `providerCommentId` never helped anyone sell anything.
 */

interface Lead {
  id: string;
  provider: string;
  authorName: string | null;
  commentText: string;
  commentCreatedAt: string;
  mediaType: string | null;
  providerAdTitle: string | null;
  intent: string;
  intentScore: number | null;
  intentReasons: string[];
  status: string;
  assignmentNote: string | null;
  slaDueAt: string | null;
  repliedAt: string | null;
  convertedAt: string | null;
  /** Derived on the server so the badge, the Overdue tab and the count agree. */
  sla: string;
  /** What Meta will actually accept for this comment — see replyCapability.ts. */
  reply: {
    canPublicReply: boolean;
    canPrivateReply: boolean;
    replyExpiresAt: string | null;
    reasonUnavailable: { public?: string; private?: string };
  };
  linkedLeadId: string | null;
  replies: {
    id: string;
    kind: string;
    channel: string | null;
    body: string;
    delivered: boolean;
    aiAssisted: boolean;
    sentById: string | null;
    createdAt: string;
  }[];
  owner: { fullName: string | null } | null;
  team: { name: string } | null;
  assignments: {
    id: string;
    createdAt: string;
    source: string;
    reason: string | null;
    toOwnerId: string | null;
    fromOwnerId: string | null;
    assignedById: string | null;
  }[];
}

/** Enum names are for the database; a person reads the sentence. */
const SOURCE_LABEL: Record<string, string> = {
  INHERITED_CUSTOMER_OWNER: 'kept with the existing customer owner',
  EXPLICIT_USER: 'routed to a named person',
  TEAM_DISTRIBUTION: 'distributed within the team',
  GLOBAL_DISTRIBUTION: 'assigned by distribution rules',
  MANUAL: 'assigned by hand',
  SYSTEM: 'recorded by the system',
};

const CHANNEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' };

const REPLY_LABEL: Record<string, string> = {
  PUBLIC: 'Public reply',
  PRIVATE: 'Private reply',
  EXTERNAL: 'Contacted outside Meta',
};

/** Meta's own list, no free text — a channel nobody can group by is not data. */
const EXTERNAL_CHANNELS = ['Phone', 'WhatsApp', 'Email', 'In person', 'Other'];

/** Intent carries a word as well as a colour — §73 applies here too. */
const INTENT_LABEL: Record<string, string> = {
  HIGH: 'High intent',
  MEDIUM: 'Medium intent',
  LOW: 'Low intent',
  IRRELEVANT: 'Not an enquiry',
  SPAM: 'Spam',
  UNSCORED: 'Not scored',
};

/**
 * The deadline as a salesperson reads it. "8 min late" is actionable; a
 * timestamp they have to subtract from the current time is not.
 */
const SLA_LABEL: Record<string, string> = {
  BREACHED: 'Overdue',
  AT_RISK: 'Due soon',
  MET: 'Answered',
  PAUSED: 'No target',
  ON_TRACK: 'On track',
};

/** Minutes while that reads as urgency; hours and days once it stops. */
const spell = (mins: number) => {
  if (mins < 90) return `${mins} min`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} hr`;
  return `${Math.round(mins / (60 * 24))} days`;
};

const slaDetail = (lead: Lead) => {
  if (!lead.slaDueAt || lead.sla === 'MET' || lead.sla === 'PAUSED') return null;
  const mins = Math.round((new Date(lead.slaDueAt).getTime() - Date.now()) / 60_000);
  return mins < 0 ? `${spell(Math.abs(mins))} late` : `${spell(mins)} left`;
};

/** How long the private-reply window has left, in a sentence. */
const privateWindow = (expiresAt: string | null) => {
  if (!expiresAt) return 'Allowed, and only once.';
  const hours = Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
  if (hours < 24)
    return `Allowed for about ${Math.max(hours, 1)} more hours — Meta closes it 7 days after the comment.`;
  return `Allowed for ${Math.round(hours / 24)} more days, and only once.`;
};

const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });
};

export default function SocialLeadList({
  leads,
  tabs,
  activeTab,
  activeChannel,
  workspaceSlug,
  canAssign,
  me,
  options,
  summary,
}: {
  leads: Lead[];
  tabs: { key: string; label: string }[];
  activeTab: string;
  activeChannel: string;
  workspaceSlug: string;
  canAssign: boolean;
  me: string;
  options: { users: { id: string; fullName: string | null }[]; teams: { id: string; name: string }[] };
  summary: { new: number; high: number; unassigned: number; overdue: number; converted: number };
}) {
  /**
   * The id, not the row. Holding the object froze the drawer at whatever the
   * enquiry looked like when it was opened, so a reassignment refreshed the
   * queue behind an open drawer that still showed the old owner.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = leads.find((lead) => lead.id === openId) ?? null;
  const base = `/${workspaceSlug}/sales/social-leads`;
  const href = (next: Record<string, string>) => {
    const q = new URLSearchParams({ tab: activeTab, ...(activeChannel ? { channel: activeChannel } : {}), ...next });
    return `${base}?${q}`;
  };

  return (
    <>
      <div className="lf-social__summary">
        {[
          ['New', summary.new],
          ['High intent', summary.high],
          ['Unassigned', summary.unassigned],
          ['Overdue', summary.overdue],
          ['Converted', summary.converted],
        ].map(([label, value]) => (
          <div className="lf-social__stat" key={label as string}>
            <span className="lf-eyebrow">{label}</span>
            <span className="lf-social__statvalue">{value}</span>
          </div>
        ))}
      </div>

      <div className="lf-social__controls">
        <nav className="lf-inbox__filters" aria-label="Filter enquiries">
          {tabs.map((tab) => (
            <Link
              className="lf-inbox__filter"
              key={tab.key}
              href={href({ tab: tab.key })}
              aria-current={tab.key === activeTab ? 'page' : undefined}
              aria-selected={tab.key === activeTab}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <nav className="lf-inbox__filters" aria-label="Filter by channel">
          {[
            ['', 'All channels'],
            ['instagram', 'Instagram'],
            ['facebook', 'Facebook'],
          ].map(([key, label]) => (
            <Link
              className="lf-inbox__filter"
              key={key || 'all'}
              href={href({ channel: key })}
              aria-selected={key === activeChannel}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {leads.length === 0 ? (
        <div className="lf-empty">
          <p>No social enquiries here yet.</p>
          <p className="lf-inbox__muted">
            Comments on your connected Facebook and Instagram content appear here as soon as they arrive.
          </p>
        </div>
      ) : (
        <div className="lf-social__list">
          {leads.map((lead) => (
            <article className="lf-social__row" key={lead.id} data-intent={lead.intent}>
              <div className="lf-social__who">
                <span className="lf-social__name">{lead.authorName ?? 'Unknown commenter'}</span>
                <span className="lf-inbox__muted">{CHANNEL[lead.provider] ?? lead.provider}</span>
              </div>

              <p className="lf-social__comment">{lead.commentText}</p>

              <div className="lf-social__meta">
                <span className="lf-social__intent" data-intent={lead.intent}>
                  {INTENT_LABEL[lead.intent] ?? lead.intent}
                  {lead.intentScore != null && lead.intentScore > 0 && ` · ${lead.intentScore}`}
                </span>
                {/* The clock, only when one is running. A chip on every row
                    would make the queue look uniformly urgent. */}
                {lead.slaDueAt && lead.sla !== 'MET' && lead.sla !== 'PAUSED' && (
                  <span className="lf-social__sla" data-sla={lead.sla.toLowerCase()}>
                    {SLA_LABEL[lead.sla] ?? lead.sla}
                    {slaDetail(lead) && ` · ${slaDetail(lead)}`}
                  </span>
                )}
                {/* What they commented on. Without it "Price?" means nothing. */}
                {lead.providerAdTitle && <span className="lf-inbox__muted">On: {lead.providerAdTitle}</span>}
                {!lead.providerAdTitle && lead.mediaType && (
                  <span className="lf-inbox__muted">On: {lead.mediaType.toLowerCase()}</span>
                )}
                <span className="lf-inbox__muted">{when(lead.commentCreatedAt)}</span>
                <span className="lf-inbox__muted">{lead.owner?.fullName ?? 'Unassigned'}</span>
                {lead.linkedLeadId && <span className="lf-badge">Known customer</span>}
                {/* Why nobody owns it — the difference between a queue a manager
                    can act on and a list of nulls. */}
                {!lead.owner && lead.assignmentNote && <span className="lf-social__note">{lead.assignmentNote}</span>}
              </div>

              <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => setOpenId(lead.id)}>
                Open
              </button>
            </article>
          ))}
        </div>
      )}

      {open && (
        <SocialLeadDrawer
          lead={open}
          onClose={() => setOpenId(null)}
          workspaceSlug={workspaceSlug}
          canAssign={canAssign}
          me={me}
          options={options}
        />
      )}
    </>
  );
}

function SocialLeadDrawer({
  lead,
  onClose,
  workspaceSlug,
  canAssign,
  me,
  options,
}: {
  lead: Lead;
  onClose: () => void;
  workspaceSlug: string;
  canAssign: boolean;
  me: string;
  options: { users: { id: string; fullName: string | null }[]; teams: { id: string; name: string }[] };
}) {
  return (
    <div className="lf-drawer" role="dialog" aria-modal="true" aria-label="Social enquiry">
      <div className="lf-drawer__scrim" onClick={onClose} />
      <div className="lf-drawer__panel">
        <header className="lf-drawer__head">
          <div>
            <h2 className="lf-channels__title">{lead.authorName ?? 'Unknown commenter'}</h2>
            <p className="lf-inbox__muted">
              {CHANNEL[lead.provider] ?? lead.provider} · {when(lead.commentCreatedAt)}
            </p>
          </div>
          <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="lf-drawer__body">
          <blockquote className="lf-social__quote">{lead.commentText}</blockquote>

          {/* §36: the score never appears without its reasons. */}
          <div className="lf-meta__summary">
            <strong>
              {INTENT_LABEL[lead.intent] ?? lead.intent}
              {lead.intentScore != null && lead.intentScore > 0 && ` · ${lead.intentScore}`}
            </strong>
            {lead.intentReasons.length > 0 ? (
              <ul>
                {lead.intentReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="lf-inbox__muted">No qualification reasons recorded.</p>
            )}
          </div>

          {lead.slaDueAt && (
            <p className="lf-social__slaline" data-sla={lead.sla.toLowerCase()}>
              <span>
                <strong>{SLA_LABEL[lead.sla] ?? lead.sla}</strong>
                {slaDetail(lead) && ` · ${slaDetail(lead)}`}
              </span>
              {/* Says out loud which clock this is, because the obvious guess is wrong. */}
              <span className="lf-inbox__muted">Measured from the customer&apos;s comment, not from assignment.</span>
            </p>
          )}

          <ReplyPanel lead={lead} options={options} />

          <AssignmentPanel lead={lead} canAssign={canAssign} me={me} options={options} />

          <dl className="lf-meta__facts">
            <div>
              <dt>Status</dt>
              <dd>{lead.status.toLowerCase()}</dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd>{lead.providerAdTitle ?? lead.mediaType?.toLowerCase() ?? '—'}</dd>
            </div>
          </dl>

          {lead.linkedLeadId ? (
            <Link
              className="lf-btn lf-btn--secondary lf-btn--sm"
              href={`/${workspaceSlug}/sales/leads/${lead.linkedLeadId}`}
            >
              Open linked customer
            </Link>
          ) : (
            <p className="lf-inbox__muted">
              This commenter is not linked to a CRM customer. Meta supplies a handle and a comment — no email or phone —
              so converting collects the rest.
            </p>
          )}
        </div>

        {!lead.linkedLeadId && <ConvertPanel lead={lead} onDone={onClose} />}

        {lead.linkedLeadId && (
          <footer className="lf-drawer__foot">
            <span className="lf-inbox__muted">Already linked to a customer.</span>
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * The Layer 1 → Layer 2 bridge, in the drawer where the salesperson already is.
 *
 * Only the name is required, because it is the only thing Meta reliably gives —
 * a handle. Phone and email are blank until the customer actually provides
 * them, and nothing here pre-fills a guess.
 */
function ConvertPanel({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(lead.authorName ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/social-leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          priority: lead.intent === 'HIGH' ? 'HIGH' : 'MEDIUM',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? data?.detail ?? 'Could not convert this enquiry.');
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <footer className="lf-drawer__foot">
        <button className="lf-btn lf-btn--sm" type="button" onClick={() => setOpen(true)}>
          Convert to Lead
        </button>
      </footer>
    );
  }

  return (
    <div className="lf-drawer__foot lf-social__convert">
      <label className="lf-meta__field">
        <span>Full name</span>
        <input className="lf-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="lf-meta__field">
        <span>Phone (if they have given one)</span>
        <input
          className="lf-input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Not provided"
        />
      </label>
      <label className="lf-meta__field">
        <span>Email (if they have given one)</span>
        <input
          className="lf-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Not provided"
        />
      </label>
      <p className="lf-inbox__muted">
        The comment, the post and the channel are kept on the customer record so you can see where they came from.
      </p>
      {error && (
        <p className="lf-inbox__error" role="alert">
          {error}
        </p>
      )}
      <div className="lf-meta__actions">
        <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="lf-btn lf-btn--sm" type="button" disabled={busy || !fullName.trim()} onClick={convert}>
          {busy ? 'Converting…' : 'Create customer'}
        </button>
      </div>
    </div>
  );
}

/**
 * Who owns this, and how to change it.
 *
 * "Assign to me" is separated from the rest because it is the common move from
 * the unassigned queue and should be one click, not a form.
 */
function AssignmentPanel({
  lead,
  canAssign,
  me,
  options,
}: {
  lead: Lead;
  canAssign: boolean;
  me: string;
  options: { users: { id: string; fullName: string | null }[]; teams: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'user' | 'team'>('user');
  const [userId, setUserId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Names come from the eligible-user list the page already loaded, rather than
  // three more relations on the history table for a label.
  const nameOf = (id: string | null) => (id ? (options.users.find((u) => u.id === id)?.fullName ?? 'Someone') : null);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/social-leads/${lead.id}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? data?.detail ?? 'Could not change the owner.');
      setOpen(false);
      // The list, the drawer and the unassigned count all read from the server.
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lf-social__assign">
      <div className="lf-meta__panelhead">
        <div>
          <span className="lf-eyebrow">Assigned to</span>
          <p className="lf-social__owner">{lead.owner?.fullName ?? 'Unassigned'}</p>
          {lead.team?.name && <p className="lf-inbox__muted">{lead.team.name}</p>}
          {!lead.owner && lead.assignmentNote && <p className="lf-social__note">{lead.assignmentNote}</p>}
        </div>
        <div className="lf-meta__actions">
          {!lead.owner && (
            <button className="lf-btn lf-btn--sm" type="button" disabled={busy} onClick={() => send({ toUserId: me })}>
              Assign to me
            </button>
          )}
          {canAssign && (
            <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => setOpen((v) => !v)}>
              {lead.owner ? 'Reassign' : 'Assign'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="lf-social__assignform">
          <fieldset className="lf-meta__field">
            <legend>Send it to</legend>
            <label className="lf-meta__radio">
              <input type="radio" checked={mode === 'user'} onChange={() => setMode('user')} />
              <span>A person</span>
            </label>
            <label className="lf-meta__radio">
              <input type="radio" checked={mode === 'team'} onChange={() => setMode('team')} />
              <span>
                A team
                <span className="lf-inbox__muted">Distribution rules pick who inside it takes it.</span>
              </span>
            </label>
          </fieldset>

          {mode === 'user' ? (
            <label className="lf-meta__field">
              <span>Person</span>
              <select className="lf-input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose…</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName ?? u.id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="lf-meta__field">
              <span>Team</span>
              <select className="lf-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Choose…</option>
                {options.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="lf-meta__field">
            <span>Why (optional)</span>
            <input
              className="lf-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Arabic-speaking buyer"
            />
          </label>

          {error && (
            <p className="lf-inbox__error" role="alert">
              {error}
            </p>
          )}

          <div className="lf-meta__actions">
            <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="lf-btn lf-btn--sm"
              type="button"
              disabled={busy || (mode === 'user' ? !userId : !teamId)}
              onClick={() =>
                send({
                  ...(mode === 'user' ? { toUserId: userId } : { toTeamId: teamId }),
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                })
              }
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {lead.assignments.length > 0 && (
        <div className="lf-social__history">
          <span className="lf-eyebrow">Assignment history</span>
          <ul>
            {lead.assignments.map((entry) => (
              <li key={entry.id}>
                <span>
                  {nameOf(entry.fromOwnerId) ? `${nameOf(entry.fromOwnerId)} → ` : ''}
                  {nameOf(entry.toOwnerId) ?? 'Unassigned'}
                </span>
                <span className="lf-inbox__muted">
                  {SOURCE_LABEL[entry.source] ?? entry.source.toLowerCase()}
                  {nameOf(entry.assignedById) && ` by ${nameOf(entry.assignedById)}`}
                  {' · '}
                  {when(entry.createdAt)}
                </span>
                {entry.reason && <span className="lf-inbox__muted">{entry.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Answering the customer.
 *
 * The capability layer decides which kinds are offered — a button Meta will
 * refuse is worse than no button, because a salesperson writes a considered
 * answer before finding out. Where nothing can be sent through Meta any more,
 * recording that they phoned instead is still worth having: the customer was
 * answered, and the response clock should say so.
 *
 * Nothing here sends without a person. `Draft with AI` fills the box and stops;
 * reaching the customer always takes a second, deliberate press of Send.
 */
function ReplyPanel({
  lead,
  options,
}: {
  lead: Lead;
  options: { users: { id: string; fullName: string | null }[]; teams: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const { canPublicReply, canPrivateReply, reasonUnavailable } = lead.reply;
  const channel = CHANNEL[lead.provider] ?? lead.provider;

  const kinds = [
    { key: 'PUBLIC' as const, label: 'Reply publicly', allowed: canPublicReply, why: reasonUnavailable.public },
    { key: 'PRIVATE' as const, label: 'Private message', allowed: canPrivateReply, why: reasonUnavailable.private },
    { key: 'EXTERNAL' as const, label: 'I contacted them another way', allowed: true, why: undefined },
  ];

  const [chosen, setKind] = useState<'PUBLIC' | 'PRIVATE' | 'EXTERNAL'>(
    canPublicReply ? 'PUBLIC' : canPrivateReply ? 'PRIVATE' : 'EXTERNAL',
  );
  /**
   * Sending can close the option that was selected — a private reply spends the
   * only one Meta allows — so the choice falls back rather than leaving the form
   * pointing at a disabled control with nothing checked.
   */
  const kind = kinds.find((k) => k.key === chosen)?.allowed
    ? chosen
    : (kinds.find((k) => k.allowed)?.key ?? 'EXTERNAL');
  const [body, setBody] = useState('');
  const [externalChannel, setExternalChannel] = useState('Phone');
  const [aiAssisted, setAiAssisted] = useState(false);
  const [state, setState] = useState<'idle' | 'drafting' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string | null) =>
    id ? (options.users.find((u) => u.id === id)?.fullName ?? 'Someone') : 'Someone';

  async function draft() {
    setState('drafting');
    setError(null);
    try {
      const res = await fetch(`/api/v1/social-leads/${lead.id}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: kind === 'EXTERNAL' ? 'PRIVATE' : kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? 'Could not draft a reply.');
      setBody(data.body ?? '');
      // Recorded honestly: a suggestion the salesperson then edits is still
      // AI-assisted, and reporting should be able to tell.
      setAiAssisted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setState('idle');
    }
  }

  async function send() {
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`/api/v1/social-leads/${lead.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          body: body.trim(),
          ...(kind === 'EXTERNAL' ? { channel: externalChannel } : {}),
          aiAssisted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? data?.error?.message ?? 'Could not send that.');
      setState('sent');
      setBody('');
      setAiAssisted(false);
      router.refresh();
    } catch (err) {
      // The enquiry is untouched when this fails — the service writes nothing
      // unless Meta accepted the message.
      setError((err as Error).message);
      setState('idle');
    }
  }

  const busy = state === 'sending' || state === 'drafting';

  return (
    <section className="lf-social__reply">
      <span className="lf-eyebrow">Respond on {channel}</span>

      {lead.replies.length > 0 && (
        <ul className="lf-social__thread">
          {lead.replies.map((reply) => (
            <li key={reply.id}>
              <span className="lf-social__replyhead">
                {REPLY_LABEL[reply.kind] ?? reply.kind}
                {reply.channel && ` · ${reply.channel}`}
                {' · '}
                {nameOf(reply.sentById)}
                {' · '}
                {when(reply.createdAt)}
                {reply.aiAssisted && ' · AI-assisted'}
                {!reply.delivered && reply.kind !== 'EXTERNAL' && ' · not delivered (demo)'}
              </span>
              <span>{reply.body}</span>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="lf-meta__field">
        <legend>How</legend>
        {kinds.map((option) => (
          <label className="lf-meta__radio" key={option.key}>
            <input
              type="radio"
              name={`reply-kind-${lead.id}`}
              checked={kind === option.key}
              disabled={!option.allowed || busy}
              onChange={() => setKind(option.key)}
            />
            <span>
              {option.label}
              {/* Why, not just a dead control: "Meta closed the window" is
                  something a salesperson can act on. */}
              {!option.allowed && option.why && <span className="lf-inbox__muted">{option.why}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {kind === 'EXTERNAL' && (
        <label className="lf-meta__field">
          <span>How did you reach them?</span>
          <select
            className="lf-input"
            value={externalChannel}
            disabled={busy}
            onChange={(e) => setExternalChannel(e.target.value)}
          >
            {EXTERNAL_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="lf-meta__field">
        <span>{kind === 'EXTERNAL' ? 'What was said' : 'Message'}</span>
        <textarea
          className="lf-input lf-social__composer"
          rows={4}
          value={body}
          disabled={busy}
          placeholder={
            kind === 'PUBLIC'
              ? 'Everyone who sees the post will read this.'
              : kind === 'PRIVATE'
                ? 'Only they will see this.'
                : 'A short note about the conversation you had.'
          }
          onChange={(e) => {
            setBody(e.target.value);
            if (state === 'sent') setState('idle');
          }}
        />
      </label>

      {error && (
        <p className="lf-inbox__error" role="alert">
          {error}
        </p>
      )}
      {state === 'sent' && (
        <p className="lf-social__sent" role="status">
          Sent.
        </p>
      )}

      <div className="lf-meta__actions">
        {kind !== 'EXTERNAL' && (
          <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" disabled={busy} onClick={draft}>
            {state === 'drafting' ? 'Drafting…' : 'Draft with AI'}
          </button>
        )}
        <button className="lf-btn lf-btn--sm" type="button" disabled={busy || !body.trim()} onClick={send}>
          {state === 'sending' ? 'Sending…' : kind === 'EXTERNAL' ? 'Record it' : 'Send'}
        </button>
      </div>

      {kind !== 'EXTERNAL' && (
        <p className="lf-inbox__muted">
          {kind === 'PRIVATE' ? privateWindow(lead.reply.replyExpiresAt) : 'Public replies have no time limit.'}
          {' Nothing is sent until you press Send.'}
        </p>
      )}
    </section>
  );
}
