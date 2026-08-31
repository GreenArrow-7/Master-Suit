'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';
import { problemSummary } from '@/components/forms/useFormErrors';

export default function NewEventForm() {
  const router = useRouter();
  const base = useModuleBase();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const fd = new FormData(e.currentTarget);
    const body = {
      title: fd.get('title'),
      description: fd.get('description') || undefined,
      eventType: fd.get('eventType'),
      startAt: fd.get('startAt'),
      endAt: fd.get('endAt'),
      timezone: fd.get('timezone') || 'Asia/Dubai',
      location: fd.get('location') || undefined,
      meetingUrl: fd.get('meetingUrl') || undefined,
      capacity: fd.get('capacity') ? Number(fd.get('capacity')) : undefined,
    };

    const res = await fetch('/api/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const event = await res.json();
      router.push(`${base}/events/${event.id}`);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(problemSummary(err, 'Failed to create event'));
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="lf-h1">New Event</h1>

      <form
        onSubmit={handleSubmit}
        className="lf-card"
        style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)', maxWidth: 640 }}
      >
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <div>
            <label className="lf-label" htmlFor="title">
              Title *
            </label>
            <input className="lf-input" id="title" name="title" required maxLength={200} />
          </div>
          <div>
            <label className="lf-label" htmlFor="description">
              Description
            </label>
            <textarea className="lf-input" id="description" name="description" rows={3} maxLength={5000} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-4)' }}>
            <div>
              <label className="lf-label" htmlFor="eventType">
                Type
              </label>
              <select className="lf-input" id="eventType" name="eventType" defaultValue="PHYSICAL">
                <option value="PHYSICAL">Physical</option>
                <option value="ONLINE">Online</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="lf-label" htmlFor="capacity">
                Capacity
              </label>
              <input className="lf-input" id="capacity" name="capacity" type="number" min={1} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-4)' }}>
            <div>
              <label className="lf-label" htmlFor="startAt">
                Start *
              </label>
              <input className="lf-input" id="startAt" name="startAt" type="datetime-local" required />
            </div>
            <div>
              <label className="lf-label" htmlFor="endAt">
                End *
              </label>
              <input className="lf-input" id="endAt" name="endAt" type="datetime-local" required />
            </div>
          </div>
          <div>
            <label className="lf-label" htmlFor="timezone">
              Timezone
            </label>
            <input className="lf-input" id="timezone" name="timezone" defaultValue="Asia/Dubai" />
          </div>
          <div>
            <label className="lf-label" htmlFor="location">
              Location
            </label>
            <input
              className="lf-input"
              id="location"
              name="location"
              maxLength={300}
              placeholder="Venue name or address"
            />
          </div>
          <div>
            <label className="lf-label" htmlFor="meetingUrl">
              Meeting URL
            </label>
            <input
              className="lf-input"
              id="meetingUrl"
              name="meetingUrl"
              type="url"
              placeholder="Google Meet, Zoom, etc."
            />
          </div>

          {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 'var(--lf-space-3)' }}>
            <button className="lf-btn" type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create Event'}
            </button>
            <SalesLink href="/events" className="lf-btn lf-btn--ghost">
              Cancel
            </SalesLink>
          </div>
        </div>
      </form>
    </>
  );
}
