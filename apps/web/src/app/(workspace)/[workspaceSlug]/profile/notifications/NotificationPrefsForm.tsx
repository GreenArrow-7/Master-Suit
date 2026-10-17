'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/auth/client';
import type { NotificationPrefs } from '@/lib/notificationPrefs';

export default function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save(next: NotificationPrefs) {
    setPrefs(next);
    setStatus(null);
    const response = await authFetch('/api/v1/notification-preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    setStatus(response.ok ? 'Saved.' : 'Your choice could not be saved. Try again.');
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-3)' }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          id="pref-push"
          type="checkbox"
          checked={prefs.push}
          onChange={(event) => save({ ...prefs, push: event.target.checked })}
        />
        <span>
          <strong>Phone notifications</strong>
          <br />
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            Follow-ups and visits coming due, leads handed to you, missed calls, and leads past their first-contact
            time. Needs the YOUHAN ONE app with notifications allowed.
          </span>
        </span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          id="pref-email"
          type="checkbox"
          checked={prefs.email}
          onChange={(event) => save({ ...prefs, email: event.target.checked })}
        />
        <span>
          <strong>Email copies</strong>
          <br />
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            The same notifications, also sent to your email address.
          </span>
        </span>
      </label>
      {status && (
        <p role="status" style={{ margin: 0, fontSize: 'var(--lf-text-sm)' }}>
          {status}
        </p>
      )}
    </section>
  );
}
