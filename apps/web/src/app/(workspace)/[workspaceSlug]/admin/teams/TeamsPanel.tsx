'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface TeamRow {
  id: string;
  name: string;
  managerId: string | null;
  memberIds: string[];
}

export default function TeamsPanel({
  teams,
  people,
  canManage,
}: {
  teams: TeamRow[];
  people: { id: string; fullName: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = new Map(people.map((person) => [person.id, person.fullName]));

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
      setError(data.detail ?? data.title ?? 'The team could not be saved.');
      return false;
    }
    router.refresh();
    return true;
  }

  function values(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      name: String(data.get('name') ?? ''),
      managerId: String(data.get('managerId') ?? '') || null,
      memberIds: data.getAll('memberIds').map(String),
    };
  }

  function fields(prefix: string, team?: TeamRow) {
    return (
      <>
        <label className="lf-field">
          <span className="lf-label" data-required="">
            Team name
          </span>
          <input
            id={`${prefix}-name`}
            className="lf-input"
            name="name"
            required
            minLength={2}
            defaultValue={team?.name}
          />
        </label>
        <label className="lf-field">
          <span className="lf-label">Manager</span>
          <select id={`${prefix}-manager`} className="lf-input" name="managerId" defaultValue={team?.managerId ?? ''}>
            <option value="">No manager</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-label">Members</span>
          <select
            id={`${prefix}-members`}
            className="lf-input"
            name="memberIds"
            multiple
            size={6}
            defaultValue={team?.memberIds}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      {teams.length === 0 && (
        <p className="lf-card" style={{ margin: 0, padding: 'var(--lf-space-4)' }}>
          No teams yet. Until there are, team scope means a person and the people who report to them.
        </p>
      )}
      {teams.map((team) => (
        <section key={team.id} className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 8 }}>
          <strong>{team.name}</strong>
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            Manager: {team.managerId ? (nameOf.get(team.managerId) ?? '—') : 'none'} · Members:{' '}
            {team.memberIds.map((id) => nameOf.get(id) ?? '—').join(', ') || 'none'}
          </span>
          {canManage && (
            <details>
              <summary>Edit</summary>
              <form
                style={{ display: 'grid', gap: 8, marginTop: 8 }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  await send(`/api/v1/teams/${team.id}`, 'PATCH', values(event.currentTarget));
                }}
              >
                {fields(`team-${team.id}`, team)}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="submit" className="lf-btn lf-btn--sm" disabled={busy}>
                    Save team
                  </button>
                  <button
                    type="button"
                    className="lf-btn lf-btn--secondary lf-btn--sm"
                    disabled={busy}
                    onClick={() => send(`/api/v1/teams/${team.id}`, 'DELETE')}
                  >
                    Delete team
                  </button>
                </div>
              </form>
            </details>
          )}
        </section>
      ))}
      {canManage && (
        <form
          className="lf-card"
          style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 8 }}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (await send('/api/v1/teams', 'POST', values(form))) form.reset();
          }}
        >
          <strong>New team</strong>
          {fields('new-team')}
          <div>
            <button type="submit" className="lf-btn lf-btn--sm" disabled={busy}>
              Create team
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
