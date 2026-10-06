'use client';

import Link from 'next/link';
import { useState } from 'react';

const FIELDS = [
  { key: 'companyName', label: 'Company', type: 'text', autoComplete: 'organization' },
  { key: 'slug', label: 'Workspace address', type: 'text', autoComplete: 'off' },
  { key: 'fullName', label: 'Your name', type: 'text', autoComplete: 'name' },
  { key: 'email', label: 'Work email', type: 'email', autoComplete: 'username' },
  { key: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
] as const;
type Key = (typeof FIELDS)[number]['key'];

/** A company name suggests the address; the person can change it. */
const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export default function SignupForm() {
  const [form, setForm] = useState<Record<Key, string>>({
    companyName: '',
    slug: '',
    fullName: '',
    email: '',
    password: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.errors?.map((e: { message: string }) => e.message).join(' ') || data.detail || 'Please check the form.',
        );
        return;
      }
      setSent(data.message);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="lf-alert" role="status">
        {sent} It is for {form.email}, and works once, for 24 hours.
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}
      {FIELDS.map((field) => (
        <div className="lf-field" key={field.key}>
          <label className="lf-label" data-required htmlFor={`signup-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`signup-${field.key}`}
            className="lf-input"
            type={field.type}
            autoComplete={field.autoComplete}
            required
            value={form[field.key]}
            onChange={(event) => {
              const value = event.target.value;
              if (field.key === 'slug') setSlugTouched(true);
              setForm((f) => ({
                ...f,
                [field.key]: value,
                ...(field.key === 'companyName' && !slugTouched && { slug: toSlug(value) }),
              }));
            }}
          />
          {field.key === 'slug' && form.slug && <span className="lf-hint">Your workspace: …/{form.slug}</span>}
          {field.key === 'password' && (
            <span className="lf-hint">At least 12 characters, with upper- and lower-case letters and a number.</span>
          )}
        </div>
      ))}
      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy || Object.values(form).some((v) => !v.trim())}>
        {busy ? 'Sending…' : 'Email me the link'}
      </button>
      <Link href="/login" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center' }}>
        Already have an account? Sign in
      </Link>
    </form>
  );
}
