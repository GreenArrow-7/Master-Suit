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
  linkedLeadId: string | null;
  owner: { fullName: string | null } | null;
}

const CHANNEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' };

/** Intent carries a word as well as a colour — §73 applies here too. */
const INTENT_LABEL: Record<string, string> = {
  HIGH: 'High intent',
  MEDIUM: 'Medium intent',
  LOW: 'Low intent',
  IRRELEVANT: 'Not an enquiry',
  SPAM: 'Spam',
  UNSCORED: 'Not scored',
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
  summary,
}: {
  leads: Lead[];
  tabs: { key: string; label: string }[];
  activeTab: string;
  activeChannel: string;
  workspaceSlug: string;
  summary: { new: number; high: number; assigned: number; converted: number };
}) {
  const [open, setOpen] = useState<Lead | null>(null);
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
          ['Assigned', summary.assigned],
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
                {/* What they commented on. Without it "Price?" means nothing. */}
                {lead.providerAdTitle && <span className="lf-inbox__muted">On: {lead.providerAdTitle}</span>}
                {!lead.providerAdTitle && lead.mediaType && (
                  <span className="lf-inbox__muted">On: {lead.mediaType.toLowerCase()}</span>
                )}
                <span className="lf-inbox__muted">{when(lead.commentCreatedAt)}</span>
                <span className="lf-inbox__muted">{lead.owner?.fullName ?? 'Unassigned'}</span>
                {lead.linkedLeadId && <span className="lf-badge">Known customer</span>}
              </div>

              <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => setOpen(lead)}>
                Open
              </button>
            </article>
          ))}
        </div>
      )}

      {open && <SocialLeadDrawer lead={open} onClose={() => setOpen(null)} workspaceSlug={workspaceSlug} />}
    </>
  );
}

function SocialLeadDrawer({
  lead,
  onClose,
  workspaceSlug,
}: {
  lead: Lead;
  onClose: () => void;
  workspaceSlug: string;
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

          <dl className="lf-meta__facts">
            <div>
              <dt>Owner</dt>
              <dd>{lead.owner?.fullName ?? 'Unassigned'}</dd>
            </div>
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
