'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

/**
 * Uploads a scan. Multipart rather than JSON, so it posts to the dedicated
 * upload handler rather than the usual action endpoint.
 *
 * The declared file type is sent but not trusted — the server identifies the
 * format from the leading bytes and stores that instead.
 */
export default function DocumentUpload({
  endpoint,
  employees,
  kinds,
}: {
  endpoint: string;
  employees: { value: string; label: string }[];
  kinds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authFetch(endpoint, { method: 'POST', body: new FormData(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail ?? 'That file could not be uploaded.');
        return;
      }
      form.reset();
      setNotice(
        data.virusScan === 'skipped'
          ? `Uploaded ${data.originalFilename}. No virus scanner is configured, so this file was not scanned.`
          : `Uploaded ${data.originalFilename}.`,
      );
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-form-section">
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
      <div className="lf-form-grid">
        <label className="lf-field">
          <span className="lf-label">Employee</span>
          <select className="lf-input" name="employeeId" required>
            <option value="">Select…</option>
            {employees.map((employee) => (
              <option key={employee.value} value={employee.value}>
                {employee.label}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-label">Document kind</span>
          <select className="lf-input" name="kind" required>
            <option value="">Select…</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-label">Document number</span>
          <input className="lf-input" name="number" />
        </label>
        <label className="lf-field">
          <span className="lf-label">Issued on</span>
          <input className="lf-input" name="issuedAt" type="date" />
        </label>
        <label className="lf-field">
          <span className="lf-label">Expires on</span>
          <input className="lf-input" name="expiresAt" type="date" />
        </label>
        <label className="lf-field">
          <span className="lf-label">File (PDF or image)</span>
          <input
            className="lf-input"
            name="file"
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp,image/heic"
            required
          />
        </label>
      </div>
      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload document'}
        </button>
      </div>
    </form>
  );
}
