'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

type Scope = 'NONE' | 'OWN' | 'TEAM' | 'BRANCH' | 'REGION' | 'ORGANIZATION';

const ORDER: Scope[] = ['NONE', 'OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION'];
const LABEL: Record<Scope, string> = {
  NONE: 'No access',
  OWN: 'Own records',
  TEAM: 'Their team',
  BRANCH: 'Their branch',
  REGION: 'Their region',
  ORGANIZATION: 'Whole workspace',
};

export interface MatrixRow {
  permissionId: string;
  module: string;
  action: string;
  granted: boolean;
  scope: Scope;
  /** The most the signed-in administrator may grant here — their own scope. */
  maxScope: Scope;
}

/**
 * The permission matrix for one role.
 *
 * Each row offers only the scopes the signed-in administrator holds themselves.
 * Anything above their own ceiling is shown but disabled rather than hidden, so
 * it is obvious that a wider scope exists and that someone more senior has to
 * grant it — hiding it just makes the screen look broken.
 */
export default function PermissionMatrix({
  endpoint,
  roleId,
  editable,
  rows,
}: {
  endpoint: string;
  roleId: string;
  editable: boolean;
  rows: MatrixRow[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, Scope>>(() =>
    Object.fromEntries(rows.map((row) => [row.permissionId, row.granted ? row.scope : 'NONE'])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const modules = new Map<string, MatrixRow[]>();
    for (const row of rows) {
      const list = modules.get(row.module) ?? [];
      list.push(row);
      modules.set(row.module, list);
    }
    return [...modules.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const dirty = rows.filter((row) => values[row.permissionId] !== (row.granted ? row.scope : 'NONE'));

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authFetch(`${endpoint}/matrix-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleId,
          changes: dirty.map((row) => ({
            permissionId: row.permissionId,
            granted: values[row.permissionId] !== 'NONE',
            scope: values[row.permissionId],
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail ?? 'The permissions could not be saved.');
        return;
      }
      setNotice(
        `Saved ${data.changed} change${data.changed === 1 ? '' : 's'}. ${data.sessionsRevoked} session${data.sessionsRevoked === 1 ? '' : 's'} signed out so the new permissions take effect.`,
      );
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ color: 'var(--lf-ink-600)' }}>
          {notice}
        </div>
      )}

      {grouped.map(([module, moduleRows]) => (
        <section className="lf-card" key={module} style={{ padding: 'var(--lf-space-5)' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 'var(--lf-text-md)', textTransform: 'capitalize' }}>
            {module.replace(/_/g, ' ')}
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {moduleRows.map((row) => {
              const ceiling = ORDER.indexOf(row.maxScope);
              return (
                <div
                  key={row.permissionId}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 'var(--lf-text-sm)' }}>{row.action.replace(/_/g, ' ').toLowerCase()}</span>
                  <select
                    className="lf-input"
                    style={{ maxWidth: 200 }}
                    disabled={!editable}
                    value={values[row.permissionId]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [row.permissionId]: event.target.value as Scope }))
                    }
                  >
                    {ORDER.map((option, index) => (
                      <option key={option} value={option} disabled={index > ceiling}>
                        {LABEL[option]}
                        {index > ceiling ? ' — above your own level' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editable && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="lf-btn" type="button" disabled={busy || dirty.length === 0} onClick={() => void save()}>
            {busy
              ? 'Saving…'
              : dirty.length
                ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`
                : 'No changes'}
          </button>
          {dirty.length > 0 && (
            <button
              className="lf-btn lf-btn--ghost"
              type="button"
              onClick={() =>
                setValues(Object.fromEntries(rows.map((row) => [row.permissionId, row.granted ? row.scope : 'NONE'])))
              }
            >
              Discard
            </button>
          )}
          <span style={{ color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-xs)' }}>
            Saving signs out everyone on this role — a live session carries the permissions it was built with.
          </span>
        </div>
      )}
    </div>
  );
}
