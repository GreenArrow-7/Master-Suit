'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

const KINDS = [
  ['IMAGE', 'Photo'],
  ['FLOOR_PLAN', 'Floor plan'],
  ['BROCHURE', 'Brochure'],
  ['CREATIVE', 'Creative'],
] as const;

/**
 * Add photo / Add file on a project or listing page (M11-03, M12-02). The
 * server recognises the file by its bytes, scans it and stores it; the page
 * then shows it in its gallery or its files.
 */
export default function MediaUpload({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(endpoint, { method: 'POST', body: new FormData(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail ?? 'That file could not be uploaded.');
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-form-section" aria-label="Add photo or file">
      <div className="lf-form-grid">
        <label className="lf-field" htmlFor={`${id}-kind`}>
          <span className="lf-label">What it is</span>
          <select id={`${id}-kind`} className="lf-input" name="kind" defaultValue="IMAGE">
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field" htmlFor={`${id}-title`}>
          <span className="lf-label">Title</span>
          <input id={`${id}-title`} className="lf-input" name="title" maxLength={200} placeholder="Optional" />
        </label>
        <label className="lf-field" htmlFor={`${id}-file`}>
          <span className="lf-label" data-required="">
            File (photo or PDF)
          </span>
          <input
            id={`${id}-file`}
            className="lf-input"
            name="file"
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            required
          />
        </label>
      </div>
      <div className="lf-form-actions">
        {error && (
          <div className="lf-alert" role="alert">
            {error}
          </div>
        )}
        <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
          {busy ? 'Uploading…' : 'Add photo or file'}
        </button>
      </div>
    </form>
  );
}
