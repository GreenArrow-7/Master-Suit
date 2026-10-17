'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

export interface RuleRow {
  id: string;
  name: string;
  isActive: boolean;
  everyone: boolean;
  people: string[];
  /** A short description of the rule's conditions, or null when it takes every lead. */
  routes: string | null;
  /** Passes over agents off shift or on a holiday (M18-08). */
  workingHours: boolean;
}

/**
 * Automatic assignment rules (audit M7-01). New leads go round-robin through the
 * first active rule's people; with no active rule they wait under "Waiting".
 */
export default function RulesPanel({
  rules,
  agents,
  sources,
}: {
  rules: RuleRow[];
  agents: { id: string; fullName: string }[];
  sources: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await authFetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.detail ?? data.title ?? 'The rule could not be saved.');
      return;
    }
    router.refresh();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userIds = form.getAll('userIds').map(String);
    const cities = String(form.get('cities') ?? '')
      .split(',')
      .map((city) => city.trim())
      .filter(Boolean);
    await send('/api/v1/distribution-rules', 'POST', {
      name: String(form.get('name') ?? ''),
      everyone: userIds.length === 0,
      userIds,
      conditions: { sourceIds: form.getAll('sourceIds').map(String), cities },
      respectWorkingHours: form.get('respectWorkingHours') === 'on',
    });
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-3)' }}>
      <h2 className="lf-h2" style={{ margin: 0 }}>
        Automatic assignment
      </h2>
      <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
        New leads are handed out in turn to the people of the first rule that is on. Leave and quotas are respected, and
        working hours and holidays (Administration → Holidays, or People → Holidays) unless a rule ignores them.
      </p>
      {rules.length === 0 && <p style={{ margin: 0 }}>No rule yet — every new lead waits to be handed out by hand.</p>}
      {rules.map((rule) => (
        <div
          key={rule.id}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--lf-space-2)', alignItems: 'center' }}
        >
          <strong>{rule.name}</strong>
          <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            {rule.everyone ? 'Everyone' : rule.people.join(', ') || 'Nobody'}
            {' · '}
            {rule.routes ?? 'every lead'}
            {rule.workingHours ? '' : ' · ignores working hours'}
          </span>
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={busy}
            onClick={() =>
              send(`/api/v1/distribution-rules/${rule.id}`, 'PATCH', { respectWorkingHours: !rule.workingHours })
            }
          >
            {rule.workingHours ? 'Ignore working hours' : 'Respect working hours'}
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--sm"
            disabled={busy}
            onClick={() => send(`/api/v1/distribution-rules/${rule.id}`, 'PATCH', { isActive: !rule.isActive })}
          >
            {rule.isActive ? 'On — turn off' : 'Off — turn on'}
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--secondary lf-btn--sm"
            disabled={busy}
            onClick={() => send(`/api/v1/distribution-rules/${rule.id}`, 'DELETE')}
          >
            Delete
          </button>
        </div>
      ))}
      <form onSubmit={create} style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
        <label className="lf-field">
          <span className="lf-label" data-required="">
            New rule name
          </span>
          <input id="rule-name" className="lf-input" name="name" required minLength={2} maxLength={120} />
        </label>
        <label className="lf-field">
          <span className="lf-label">People (none selected = everyone)</span>
          <select id="rule-people" className="lf-input" name="userIds" multiple size={6}>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-label">Only leads from these sources (none selected = any source)</span>
          <select id="rule-sources" className="lf-input" name="sourceIds" multiple size={5}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-label">Only leads in these cities (comma-separated, blank = any city)</span>
          <input id="rule-cities" className="lf-input" name="cities" maxLength={500} />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input type="checkbox" name="respectWorkingHours" defaultChecked />
          Skip people off shift, checked out or on a holiday
        </label>
        <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          A lead goes to the first rule that is on and whose conditions it meets.
        </p>
        <div>
          <button type="submit" className="lf-btn lf-btn--sm" disabled={busy}>
            Add rule
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-danger)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
