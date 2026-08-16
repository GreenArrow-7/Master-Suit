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
  canEdit,
}: {
  providers: ProviderCard[];
  defaultTelephonyProvider: string | null;
  canEdit: boolean;
}) {
  const categories = [...new Set(providers.map((p) => p.category))];

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <HealthSummary providers={providers} />

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

function HealthSummary({ providers }: { providers: ProviderCard[] }) {
  const rows = providers.map((p) => ({
    label: p.label,
    status: p.status,
    detail: p.errorMessage ?? relative(p.lastSyncAt),
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
            style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--lf-text-sm)' }}
          >
            <Badge tone={TONE[row.status] ?? 'slate'}>{row.status.replace('_', ' ').toLowerCase()}</Badge>
            <span style={{ fontWeight: 500, minWidth: 180 }}>{row.label}</span>
            <span style={{ color: 'var(--lf-ink-3)' }}>{row.detail}</span>
          </div>
        ))}
      </div>
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
          ? 'Disconnected.'
          : verdict?.ok === true
            ? `Verified with ${provider.label}.${verdict.detail ? ` ${verdict.detail}` : ''}`
            : verdict?.ok === null
              ? `Saved. ${verdict.detail}`
              : (verdict?.detail ?? 'Saved.'),
    });
    setValues({});
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

        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(!open)}>
          {open ? 'Close' : configured ? 'Configure' : 'Connect'}
        </button>
      </div>

      {provider.webhookUrl && (
        <div style={{ marginTop: 12 }}>
          <div className="lf-label">Callback URL — paste this into the {provider.label} console</div>
          <code
            style={{
              display: 'block',
              overflowX: 'auto',
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
            {configured && (
              <button
                type="button"
                className="lf-btn lf-btn--danger lf-btn--sm"
                disabled={!canEdit || busy !== null}
                onClick={() => send('disconnect')}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
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
