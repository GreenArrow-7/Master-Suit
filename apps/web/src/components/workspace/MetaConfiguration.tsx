'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The Meta configuration surface: connection, assets, capabilities, lead forms
 * and their routing, webhook health and recent events.
 *
 * State is server-rendered and refreshed with `router.refresh()` after a
 * mutation rather than mirrored in component state, so what the screen shows is
 * always what the database holds — a routing drawer that reported success while
 * the row failed to save would be worse than no drawer.
 */

interface Form {
  id: string;
  providerFormId: string;
  formName: string;
  enabled: boolean;
  source: string;
  stageId: string | null;
  priority: string;
  assignedUserId: string | null;
  assignedTeamId: string | null;
  lastLeadAt: string | null;
  lastSyncAt: string | null;
  stage: { name: string } | null;
  assignedUser: { fullName: string | null } | null;
  assignedTeam: { name: string } | null;
}

interface Config {
  mode: 'LIVE' | 'SIMULATED' | 'NOT_CONFIGURED';
  /** False when the deployment has no Meta app configured — see services/meta/oauth.ts. */
  oauthReady: boolean;
  simulated: boolean;
  connected: boolean;
  status: string;
  errorMessage: string | null;
  tokenExpired: boolean;
  lastSyncAt: string | null;
  assets: Record<string, string | null>;
  capabilities: { label: string; available: boolean; note: string }[];
  forms: Form[];
  webhook: { lastEventAt: string | null; lastProcessedAt: string | null; failed: number; health: string };
  recentEvents: {
    id: string;
    eventType: string;
    createdAt: string;
    processed: boolean;
    attempts: number;
    errorMessage: string | null;
  }[];
  options: {
    stages: { id: string; name: string }[];
    users: { id: string; fullName: string | null }[];
    teams: { id: string; name: string }[];
  };
  advanced: Record<string, string | null>;
}

const MODE_NOTE: Record<Config['mode'], string> = {
  LIVE: 'Connected to Meta.',
  SIMULATED: 'This workspace is using the demo Meta provider. No live Meta account is connected.',
  NOT_CONFIGURED: 'Not connected yet.',
};

const SOURCES = ['AD_LEAD_FORM', 'CHAT', 'MARKETPLACE', 'API', 'WEBHOOK', 'AUTOMATION'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const when = (iso: string | null) => {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });
};

const title = (value: string) => value.replace(/_/g, ' ').toLowerCase();

export default function MetaConfiguration({
  config,
  canEdit,
  workspaceSlug,
  outcome,
}: {
  config: Config;
  canEdit: boolean;
  workspaceSlug: string;
  /** What the OAuth callback came back with, resolved on the server. */
  outcome: { ok: boolean; text: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(
    outcome ? { tone: outcome.ok ? 'ok' : 'bad', text: outcome.text } : null,
  );
  const [editing, setEditing] = useState<Form | null>(null);

  async function connect() {
    setBusy('connect');
    setNotice(null);
    try {
      const res = await fetch('/api/v1/integrations/meta/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnTo: window.location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? data?.error?.message ?? 'Could not start the connection.');
      // A full navigation, not a fetch: the consent screen is Facebook's page.
      window.location.href = data.url;
    } catch (err) {
      setNotice({ tone: 'bad', text: (err as Error).message });
      setBusy(null);
    }
  }

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/integrations/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'That did not work.');
      setNotice({ tone: 'ok', text: label === 'sync' ? `Synced ${data.synced} lead forms.` : 'Saved.' });
      setEditing(null);
      router.refresh();
      return true;
    } catch (err) {
      setNotice({ tone: 'bad', text: (err as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* ── Connection ────────────────────────────────────────────────── */}
      <section className="lf-meta__panel">
        <div className="lf-meta__panelhead">
          <h2 className="lf-channels__title">Connection</h2>
          <span className="lf-channel__mode" data-mode={config.mode}>
            {config.mode === 'NOT_CONFIGURED' ? 'Not configured' : config.mode === 'LIVE' ? 'Live' : 'Simulated'}
          </span>
        </div>
        <p className="lf-channel__mode-note">{MODE_NOTE[config.mode]}</p>

        {/* §28: a connection that has stopped working says so and offers the fix. */}
        {(config.tokenExpired || config.errorMessage) && (
          <div className="lf-meta__alert" role="alert">
            <strong>Meta connection needs attention</strong>
            <p>{config.errorMessage ?? 'Reconnect Meta to continue receiving new leads.'}</p>
          </div>
        )}

        <dl className="lf-meta__facts">
          <div>
            <dt>Status</dt>
            <dd>{title(config.status)}</dd>
          </div>
          <div>
            <dt>Meta Business</dt>
            <dd>{config.assets.businessName ?? '—'}</dd>
          </div>
          <div>
            <dt>Facebook Page</dt>
            <dd>{config.assets.pageName ?? '—'}</dd>
          </div>
          <div>
            <dt>Instagram</dt>
            <dd>{config.assets.instagramHandle ?? 'Not linked'}</dd>
          </div>
          <div>
            <dt>Lead forms</dt>
            <dd>
              {config.forms.filter((f) => f.enabled).length} of {config.forms.length} active
            </dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{when(config.lastSyncAt)}</dd>
          </div>
        </dl>

        {canEdit && (
          <div className="lf-meta__actions">
            {/* The first thing on an unconnected workspace, and the fix on a
                broken one — so it leads rather than sitting behind Sync. */}
            <button
              className={config.connected ? 'lf-btn lf-btn--secondary lf-btn--sm' : 'lf-btn lf-btn--sm'}
              type="button"
              disabled={busy !== null || !config.oauthReady}
              onClick={connect}
            >
              {busy === 'connect'
                ? 'Opening Facebook…'
                : config.connected
                  ? 'Reconnect'
                  : 'Connect Facebook & Instagram'}
            </button>
            <button
              className="lf-btn lf-btn--secondary lf-btn--sm"
              type="button"
              disabled={busy !== null}
              onClick={() => post({ action: 'sync' }, 'sync')}
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync lead forms'}
            </button>
            {config.connected && (
              <button
                className="lf-btn lf-btn--secondary lf-btn--sm"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  // §29: the impact is stated before it happens, and history stays.
                  if (
                    window.confirm(
                      'Disconnect Facebook & Instagram?\n\nNew Meta leads will stop syncing. Existing CRM leads and activities will remain, and your routing stays saved for when you reconnect.',
                    )
                  ) {
                    void post({ action: 'disconnect' }, 'disconnect');
                  }
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        )}

        {canEdit && !config.oauthReady && (
          <p className="lf-inbox__muted">
            Connecting is unavailable on this deployment: no Meta app is configured. An operator needs to set{' '}
            <code>META_APP_ID</code> and <code>META_APP_SECRET</code>, and add this server&apos;s callback URL to the
            Meta app&apos;s allowed redirect URIs.
          </p>
        )}

        {notice && (
          <p className={notice.tone === 'ok' ? 'lf-meta__ok' : 'lf-inbox__error'} role="status">
            {notice.text}
          </p>
        )}
      </section>

      {/* ── Capabilities ──────────────────────────────────────────────── */}
      <section className="lf-meta__panel">
        <h2 className="lf-channels__title">Available capabilities</h2>
        <ul className="lf-meta__caps">
          {config.capabilities.map((cap) => (
            <li key={cap.label} data-on={cap.available ? 'true' : 'false'}>
              <span aria-hidden="true">{cap.available ? '✓' : '—'}</span>
              <span className="lf-meta__capname">{cap.label}</span>
              <span className="lf-meta__capstate">{cap.available ? 'Enabled' : 'Not available'}</span>
              <span className="lf-meta__capnote">{cap.note}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Lead forms ────────────────────────────────────────────────── */}
      <section className="lf-meta__panel">
        <h2 className="lf-channels__title">Lead forms</h2>
        {config.forms.length === 0 ? (
          <div className="lf-empty">
            <p>No lead forms found</p>
            <p className="lf-inbox__muted">
              {config.connected
                ? "We couldn't find any lead forms for the connected Facebook Page."
                : 'Connect Facebook & Instagram to bring your lead forms in.'}
            </p>
          </div>
        ) : (
          <div className="lf-meta__forms">
            {config.forms.map((form) => (
              <article className="lf-meta__form" key={form.id} data-enabled={form.enabled ? 'true' : 'false'}>
                <div className="lf-meta__formmain">
                  <span className="lf-meta__formname">{form.formName}</span>
                  <span className="lf-inbox__muted">
                    {form.enabled
                      ? `${form.stage?.name ?? 'Default stage'} · ${
                          form.assignedUser?.fullName ?? form.assignedTeam?.name ?? 'Distribution rules'
                        }`
                      : 'Not creating leads'}
                  </span>
                </div>
                <span className="lf-badge">{form.enabled ? 'Active' : 'Off'}</span>
                <span className="lf-inbox__muted lf-meta__formwhen">Last lead {when(form.lastLeadAt)}</span>
                {canEdit && (
                  <button
                    className="lf-btn lf-btn--secondary lf-btn--sm"
                    type="button"
                    onClick={() => setEditing(form)}
                  >
                    Configure
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Webhook health ────────────────────────────────────────────── */}
      <section className="lf-meta__panel">
        <h2 className="lf-channels__title">Webhook health</h2>
        <dl className="lf-meta__facts">
          <div>
            <dt>Status</dt>
            <dd>{title(config.webhook.health)}</dd>
          </div>
          <div>
            <dt>Last event</dt>
            <dd>{when(config.webhook.lastEventAt)}</dd>
          </div>
          <div>
            <dt>Last processed</dt>
            <dd>{when(config.webhook.lastProcessedAt)}</dd>
          </div>
          <div>
            <dt>Failed events</dt>
            <dd>{config.webhook.failed}</dd>
          </div>
        </dl>

        <h3 className="lf-meta__subhead">Recent events</h3>
        {config.recentEvents.length === 0 ? (
          <p className="lf-inbox__muted">No Meta events received yet.</p>
        ) : (
          <ul className="lf-meta__events">
            {config.recentEvents.map((event) => (
              <li key={event.id}>
                <span className="lf-meta__eventtype">{title(event.eventType)}</span>
                <span className="lf-inbox__muted">{when(event.createdAt)}</span>
                <span className="lf-inbox__muted">
                  {event.processed ? 'Processed' : `Failed · ${event.attempts} attempts`}
                </span>
                {event.errorMessage && <span className="lf-meta__eventerr">{event.errorMessage}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Advanced ──────────────────────────────────────────────────── */}
      <details className="lf-meta__panel lf-meta__advanced">
        <summary>Advanced details</summary>
        <dl className="lf-meta__facts">
          {Object.entries(config.advanced).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        {/* No tokens, no app secret, no signing key — §30. */}
        <p className="lf-inbox__muted">Credentials are encrypted and never displayed.</p>
      </details>

      {editing && (
        <RoutingDrawer
          form={editing}
          options={config.options}
          busy={busy === 'routing'}
          onClose={() => setEditing(null)}
          onSave={(payload) => post({ action: 'routing', ...payload }, 'routing')}
          workspaceSlug={workspaceSlug}
        />
      )}
    </>
  );
}

/**
 * Where a form's leads go (§13–§18).
 *
 * Assignment is three choices, not a strategy enum: a person, a team, or the
 * workspace's existing distribution rules. That mirrors the data model exactly —
 * naming neither a user nor a team is what falls through to the engine — so the
 * UI cannot express a state the backend does not have.
 */
function RoutingDrawer({
  form,
  options,
  busy,
  onClose,
  onSave,
}: {
  form: Form;
  options: Config['options'];
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  workspaceSlug: string;
}) {
  const [enabled, setEnabled] = useState(form.enabled);
  const [source, setSource] = useState(form.source);
  const [stageId, setStageId] = useState(form.stageId ?? '');
  const [priority, setPriority] = useState(form.priority);
  const [mode, setMode] = useState<'rules' | 'user' | 'team'>(
    form.assignedUserId ? 'user' : form.assignedTeamId ? 'team' : 'rules',
  );
  const [userId, setUserId] = useState(form.assignedUserId ?? '');
  const [teamId, setTeamId] = useState(form.assignedTeamId ?? '');
  const [notifyOwner, setNotifyOwner] = useState(true);

  const destination =
    mode === 'user'
      ? (options.users.find((u) => u.id === userId)?.fullName ?? 'a chosen user')
      : mode === 'team'
        ? (options.teams.find((t) => t.id === teamId)?.name ?? 'a chosen team')
        : 'your existing distribution rules';

  return (
    <div className="lf-drawer" role="dialog" aria-modal="true" aria-label={`Route leads from ${form.formName}`}>
      <div className="lf-drawer__scrim" onClick={onClose} />
      <div className="lf-drawer__panel">
        <header className="lf-drawer__head">
          <div>
            <h2 className="lf-channels__title">Route Facebook leads</h2>
            <p className="lf-inbox__muted">{form.formName}</p>
          </div>
          <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="lf-drawer__body">
          <label className="lf-meta__toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Receive leads from this form</span>
          </label>
          {!enabled && (
            <p className="lf-meta__alert" role="note">
              New Meta leads from this form will be recorded as provider events but won&apos;t create CRM leads until
              this is switched back on.
            </p>
          )}

          <label className="lf-meta__field">
            <span>Lead source</span>
            <select className="lf-input" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {title(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="lf-meta__field">
            <span>Initial stage</span>
            <select className="lf-input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Workspace default</option>
              {options.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="lf-meta__field">
            <span>Priority</span>
            <select className="lf-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {title(p)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="lf-meta__field">
            <legend>Assignment</legend>
            {(
              [
                [
                  'rules',
                  'Use existing lead distribution',
                  `${PRODUCT_NAME} assigns this lead using your current distribution rules.`,
                ],
                ['user', 'Assign to a person', 'Every lead from this form goes straight to one person.'],
                ['team', 'Route to a team', "The team's distribution rules choose who inside it takes the lead."],
              ] as const
            ).map(([key, label, note]) => (
              <label className="lf-meta__radio" key={key}>
                <input type="radio" name="assignment" checked={mode === key} onChange={() => setMode(key)} />
                <span>
                  <strong>{label}</strong>
                  <span className="lf-inbox__muted">{note}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'user' && (
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
          )}

          {mode === 'team' && (
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

          <label className="lf-meta__toggle">
            <input type="checkbox" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} />
            <span>Notify the assigned person</span>
          </label>

          {/* §18: what this will do, in a sentence, before it is saved. */}
          <div className="lf-meta__summary">
            <strong>New leads from this form will</strong>
            <ul>
              <li>Enter as {options.stages.find((s) => s.id === stageId)?.name ?? 'the workspace default stage'}</li>
              <li>Use priority {title(priority)}</li>
              <li>Record source {title(source)}</li>
              <li>Go to {destination}</li>
            </ul>
          </div>
        </div>

        <footer className="lf-drawer__foot">
          <button className="lf-btn lf-btn--ghost lf-btn--sm" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="lf-btn lf-btn--sm"
            type="button"
            disabled={busy || (mode === 'user' && !userId) || (mode === 'team' && !teamId)}
            onClick={() =>
              onSave({
                providerFormId: form.providerFormId,
                enabled,
                source,
                stageId: stageId || null,
                priority,
                assignedUserId: mode === 'user' ? userId : null,
                assignedTeamId: mode === 'team' ? teamId : null,
                notifyOwner,
              })
            }
          >
            {busy ? 'Saving…' : 'Save routing'}
          </button>
        </footer>
      </div>
    </div>
  );
}
