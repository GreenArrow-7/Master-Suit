'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

export interface ProviderCard {
  key: string;
  label: string;
  category: string;
  description: string;
  capabilities: readonly string[];
  unsignedCallbacks: boolean;
  credentialFields: { key: string; label: string; secret: boolean; hint?: string }[];
  settingFields: { key: string; label: string; hint?: string }[];
  status: string;
  settings: Record<string, unknown>;
  lastSyncAt: string | null;
  errorMessage: string | null;
  webhookUrl: string | null;
}

/**
 * Must match `CONFIRM_PHRASE` in the route. Kept as a literal on both sides
 * rather than shared through an import: this is a client component, and the
 * route module it would import from reaches Prisma.
 */
const CONFIRM_PHRASE = 'remove-all-credentials';

const CATEGORY_TITLES: Record<string, string> = {
  TELEPHONY: 'Telephony',
  MESSAGING: 'Messaging',
  MEETINGS: 'Meetings',
  TRANSCRIPTION: 'Speech to text',
  AI: 'Intelligence',
};

const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  CONNECTED: 'viridian',
  ERROR: 'vermillion',
  DISCONNECTED: 'brass',
  NOT_CONFIGURED: 'slate',
};

/**
 * The screen this product did not have.
 *
 * Google Meet provisioning, WhatsApp circulation, transcription and every
 * outbound call read an IntegrationConnection row and refuse without one — and
 * the only way to create that row was an INSERT by hand. Everything downstream
 * of it was therefore unreachable in a running deployment, which is why this is
 * the first thing built rather than the last.
 *
 * Stored secrets are never sent to the browser. A secret field that already has
 * a value renders empty with a placeholder saying so; leaving it empty keeps
 * what is stored, which is what lets an administrator change a caller number
 * without re-typing a token they are not allowed to read.
 */
export default function IntegrationBoard({
  providers,
  defaultTelephonyProvider,
  aiConfigured,
  canEdit,
}: {
  providers: ProviderCard[];
  defaultTelephonyProvider: string | null;
  aiConfigured: boolean;
  canEdit: boolean;
}) {
  const categories = [...new Set(providers.map((p) => p.category))];

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <HealthSummary providers={providers} deploymentKey={aiConfigured} />

      <RemoveAllKeys providers={providers} canEdit={canEdit} />

      {categories.map((category) => (
        <section key={category}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginBottom: 'var(--lf-space-3)' }}>
            {CATEGORY_TITLES[category] ?? category}
          </h2>

          {category === 'TELEPHONY' && (
            <DefaultProviderPicker
              providers={providers.filter((p) => p.category === 'TELEPHONY')}
              selected={defaultTelephonyProvider}
              canEdit={canEdit}
            />
          )}

          <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
            {providers
              .filter((p) => p.category === category)
              .map((provider) => (
                <ProviderPanel key={provider.key} provider={provider} canEdit={canEdit} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Gemini used to be appended here by hand, reading the deployment's env var.
 * It is a registry provider now, so it arrives with the others — and reports
 * whether *this workspace* has a key rather than whether the server does.
 */
function HealthSummary({ providers, deploymentKey }: { providers: ProviderCard[]; deploymentKey: boolean }) {
  const rows = providers.map((p) => ({
    label: p.label,
    status: p.status,
    detail:
      p.errorMessage ??
      // A workspace with no key of its own still gets AI, on the shared one.
      (p.key === 'gemini' && p.status === 'NOT_CONFIGURED' && deploymentKey
        ? 'Using this deployment’s shared key'
        : relative(p.lastSyncAt)),
  }));

  return (
    <div className="lf-card" style={{ padding: 18 }}>
      <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 12px' }}>
        Health
      </h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            // The fixed 180px label plus a badge plus a detail string overflowed
            // the page at 390px. Wrapping costs nothing on a wide screen, where
            // the rows still line up, and the label only claims its column when
            // there is room for one.
            style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--lf-text-sm)', flexWrap: 'wrap' }}
          >
            <Badge tone={TONE[row.status] ?? 'slate'}>{row.status.replace('_', ' ').toLowerCase()}</Badge>
            <span style={{ fontWeight: 500, minWidth: 'min(180px, 100%)' }}>{row.label}</span>
            <span style={{ color: 'var(--lf-ink-3)', overflowWrap: 'anywhere' }}>{row.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Clear every stored credential in this workspace at once.
 *
 * Disconnect on a single card already deletes the row rather than flagging it,
 * so this grants no new power — it saves opening one panel per provider, which
 * is what somebody rotating a leaked set of keys is actually doing, and what
 * they least want to do half of.
 *
 * The phrase has to be typed. Nothing here comes back: the rows hold the only
 * copy of each key the workspace has, and no vendor will reissue one on
 * request. A button behind a `confirm()` is one misplaced Enter away from
 * taking telephony, messaging and AI down together.
 */
function RemoveAllKeys({ providers, canEdit }: { providers: ProviderCard[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const connected = providers.filter((p) => p.status !== 'NOT_CONFIGURED');
  // Nothing stored means nothing to remove, and an enabled button that can only
  // report "0 removed" reads as broken.
  if (!canEdit || connected.length === 0) return null;

  async function removeAll() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/v1/integrations?confirm=${CONFIRM_PHRASE}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMessage({ tone: 'error', text: data.errors?.[0]?.message ?? data.detail ?? 'That change was refused.' });
      return;
    }
    setMessage({
      tone: 'ok',
      text: data.count
        ? `Removed ${data.count} key${data.count === 1 ? '' : 's'}: ${(data.removed as string[]).join(', ')}.`
        : 'Nothing was stored.',
    });
    setTyped('');
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="lf-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <strong>Stored API keys</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            {connected.length} service{connected.length === 1 ? '' : 's'} hold a credential:{' '}
            {connected.map((p) => p.label).join(', ')}. Removing them cannot be undone — each vendor issues a new key,
            it does not return the old one.
          </p>
        </div>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
        >
          {open ? 'Cancel' : 'Remove all keys'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: 480 }}>
          <label className="lf-label" htmlFor="remove-all-confirm">
            Type <code>{CONFIRM_PHRASE}</code> to confirm
          </label>
          <input
            id="remove-all-confirm"
            className="lf-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div>
            <button
              type="button"
              className="lf-btn lf-btn--danger lf-btn--sm"
              onClick={removeAll}
              disabled={busy || typed.trim() !== CONFIRM_PHRASE}
            >
              {busy ? 'Removing…' : `Remove ${connected.length} key${connected.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          className={message.tone === 'error' ? 'lf-hint lf-hint--error' : 'lf-hint'}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function DefaultProviderPicker({
  providers,
  selected,
  canEdit,
}: {
  providers: ProviderCard[];
  selected: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = providers.filter((p) => p.status === 'CONNECTED');

  async function choose(vendor: string) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/integrations', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultTelephonyProvider: vendor || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.errors?.[0]?.message ?? data.detail ?? 'That change was refused.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="lf-card" style={{ padding: 18, marginBottom: 'var(--lf-space-4)' }}>
      <div className="lf-label">Default calling provider</div>
      <p className="lf-hint" style={{ marginTop: 4 }}>
        Employees never choose a vendor. Every call this workspace places goes through the one selected here.
      </p>

      {connected.length === 0 ? (
        <p className="lf-hint" style={{ marginTop: 10 }}>
          Connect a telephony provider below before choosing a default.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          {connected.map((provider) => (
            <label key={provider.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="defaultTelephonyProvider"
                value={provider.key}
                checked={selected === provider.key}
                disabled={!canEdit || busy}
                onChange={() => choose(provider.key)}
              />
              {provider.label}
            </label>
          ))}
        </div>
      )}

      {error && (
        <p className="lf-hint lf-hint--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ProviderPanel({ provider, canEdit }: { provider: ProviderCard; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  /** Second press confirms; blurring the button forgets the first one. */
  const [confirmRemove, setConfirmRemove] = useState(false);

  const configured = provider.status !== 'NOT_CONFIGURED';

  async function send(action: 'save' | 'test' | 'disconnect') {
    setBusy(action);
    setMessage(null);

    const url = `/api/v1/integrations/${provider.key}`;
    const init: RequestInit =
      action === 'save'
        ? {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              credentials: pick(
                values,
                provider.credentialFields.map((f) => f.key),
              ),
              settings: pick(
                values,
                provider.settingFields.map((f) => f.key),
              ),
            }),
          }
        : { method: action === 'test' ? 'POST' : 'DELETE' };

    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setMessage({ tone: 'error', text: data.errors?.[0]?.message ?? data.detail ?? 'That change was refused.' });
      return;
    }

    const verdict = data.verification;
    setMessage({
      tone: verdict?.ok === false ? 'error' : 'ok',
      text:
        action === 'disconnect'
          ? `Key removed. ${provider.label} is no longer configured for this workspace.`
          : verdict?.ok === true
            ? `Verified with ${provider.label}.${verdict.detail ? ` ${verdict.detail}` : ''}`
            : verdict?.ok === null
              ? `Saved. ${verdict.detail}`
              : (verdict?.detail ?? 'Saved.'),
    });
    setValues({});
    setConfirmRemove(false);
    router.refresh();
  }

  return (
    <div className="lf-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong>{provider.label}</strong>
            <Badge tone={TONE[provider.status] ?? 'slate'}>{provider.status.replace('_', ' ').toLowerCase()}</Badge>
          </div>
          <p className="lf-hint" style={{ marginTop: 4 }}>
            {provider.description}
          </p>
          {provider.capabilities.length > 0 && (
            <p className="lf-hint" style={{ marginTop: 4 }}>
              Supports: {provider.capabilities.map((c) => c.replace(/_/g, ' ').toLowerCase()).join(', ')}
            </p>
          )}
          {provider.errorMessage && (
            <p className="lf-hint lf-hint--error" style={{ marginTop: 4 }}>
              {provider.errorMessage}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(!open)}>
            {open ? 'Close' : configured ? 'Configure' : 'Connect'}
          </button>
          {/*
            Removing a key used to mean Configure → scroll past the form →
            Disconnect, which is three steps behind a button labelled for the
            opposite intent. The moment somebody wants a key gone — it is wrong,
            it leaked, it is 400ing — is the moment they are looking at this
            card, so the action belongs on it.
          */}
          {configured && canEdit && (
            <button
              type="button"
              className="lf-btn lf-btn--danger lf-btn--sm"
              disabled={busy !== null}
              onClick={() => (confirmRemove ? send('disconnect') : setConfirmRemove(true))}
              // The second press is the confirmation. A dialog would be
              // stronger, but this key is one card among many and re-entering
              // it costs a visit to the vendor console, not a rebuild.
              onBlur={() => setConfirmRemove(false)}
            >
              {busy === 'disconnect' ? 'Removing…' : confirmRemove ? 'Confirm — remove key' : 'Remove key'}
            </button>
          )}
        </div>
      </div>

      {/*
        Shown here as well as inside the form, because the Remove button on the
        header is reachable with the form closed — and an action that reports
        nothing reads as an action that did nothing.
      */}
      {message && !open && (
        <p
          className={message.tone === 'error' ? 'lf-hint lf-hint--error' : 'lf-hint'}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      {provider.webhookUrl && (
        <div style={{ marginTop: 12 }}>
          <div className="lf-label">Callback URL — paste this into the {provider.label} console</div>
          <code
            style={{
              display: 'block',
              /**
               * A callback URL is one unbreakable token, so its min-content
               * width is the whole string — `overflowX: auto` alone never got
               * the chance to scroll, because the element simply forced its
               * grid wider and took the page with it. That went unnoticed while
               * APP_URL was `localhost:3000`; a real public hostname is long
               * enough to push the page 291px sideways at 390px.
               */
              overflowWrap: 'anywhere',
              minWidth: 0,
              padding: '8px 10px',
              fontSize: 'var(--lf-text-xs)',
              background: 'var(--lf-surface-2)',
              borderRadius: 6,
            }}
          >
            {provider.webhookUrl}
          </code>
          {provider.unsignedCallbacks && (
            <p className="lf-hint" style={{ marginTop: 4 }}>
              {provider.label} does not sign its callbacks, so the token in this URL is the only credential. Treat it as
              a secret and restrict the endpoint to {provider.label}&apos;s source addresses where your deployment
              allows it.
            </p>
          )}
        </div>
      )}

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send('save');
          }}
          style={{ marginTop: 16, display: 'grid', gap: 12 }}
        >
          {[...provider.credentialFields, ...provider.settingFields].map((field) => {
            const stored = 'secret' in field && field.secret ? configured : false;
            const settingValue = provider.settings[field.key];
            return (
              <div className="lf-field" key={field.key}>
                <label className="lf-label" htmlFor={`${provider.key}-${field.key}`}>
                  {field.label}
                </label>
                <input
                  id={`${provider.key}-${field.key}`}
                  className="lf-input"
                  type={'secret' in field && field.secret ? 'password' : 'text'}
                  autoComplete="off"
                  disabled={!canEdit}
                  placeholder={
                    stored
                      ? 'Stored — leave empty to keep'
                      : typeof settingValue === 'string'
                        ? settingValue
                        : (field.hint ?? '')
                  }
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
                {field.hint && <p className="lf-hint">{field.hint}</p>}
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="lf-btn lf-btn--sm" disabled={!canEdit || busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save and verify'}
            </button>
            {configured && (
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={!canEdit || busy !== null}
                onClick={() => send('test')}
              >
                {busy === 'test' ? 'Testing…' : 'Test connection'}
              </button>
            )}
            {/*
              Removal lives on the card header now, not here. Two buttons for
              one destructive action on one card is worse than either: they had
              different labels and different confirmations, so which one a
              person had pressed was not recoverable from what they remembered.
            */}
          </div>

          {message && (
            <p
              className={message.tone === 'error' ? 'lf-hint lf-hint--error' : 'lf-hint'}
              role={message.tone === 'error' ? 'alert' : 'status'}
            >
              {message.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

const pick = (values: Record<string, string>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, values[k]]));

function relative(date: string | null): string {
  if (!date) return 'Never checked';
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 1) return 'Checked just now';
  if (mins < 60) return `Checked ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Checked ${hrs}h ago`;
  return `Checked ${Math.floor(hrs / 24)}d ago`;
}
