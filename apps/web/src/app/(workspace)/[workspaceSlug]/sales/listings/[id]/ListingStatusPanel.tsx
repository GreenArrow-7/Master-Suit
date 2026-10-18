'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import DateInput from '@/components/forms/DateInput';

const LABEL: Record<string, string> = {
  DRAFT: 'Draft (not on the market)',
  ACTIVE: 'Active (on the market)',
  UNDER_OFFER: 'Under offer',
  SOLD: 'Sold',
  RENTED: 'Rented',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired (mandate lapsed)',
};

/**
 * Where the listing stands and its advertising permit (M12-04, M12-09).
 *
 * Active means on the market for the agency's own clients: it matches open
 * requirements and can be shared from a lead whether or not it is ever sent to
 * a portal — a pocket listing is an active listing nobody published. The
 * server refuses Active and Under offer without a live mandate; the panel says
 * so before the agent tries. Expired is never offered: a lapsed mandate sets it.
 */
export default function ListingStatusPanel({
  listingId,
  listingType,
  status,
  permitNumber,
  permitExpiry,
  hasLiveMandate,
}: {
  listingId: string;
  listingType: 'SALE' | 'RENT';
  status: string;
  permitNumber: string | null;
  /** YYYY-MM-DD, or null. */
  permitExpiry: string | null;
  hasLiveMandate: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = listingType === 'RENT' ? 'RENTED' : 'SOLD';
  const options = ['DRAFT', 'ACTIVE', 'UNDER_OFFER', closed, 'WITHDRAWN'];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('status') ?? status);
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(`/api/v1/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(next !== status ? { status: next } : {}),
          permitNumber: String(form.get('permitNumber') ?? '').trim() || null,
          permitExpiry: String(form.get('permitExpiry') ?? '') || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail ?? 'The listing could not be saved.');
        return;
      }
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-form-section" aria-label="Status and permit">
      <div className="lf-form-grid">
        <label className="lf-field" htmlFor={`${id}-status`}>
          <span className="lf-label">Status</span>
          <select id={`${id}-status`} className="lf-input" name="status" defaultValue={status}>
            {!options.includes(status) && <option value={status}>{LABEL[status] ?? status}</option>}
            {options.map((value) => (
              <option
                key={value}
                value={value}
                disabled={!hasLiveMandate && (value === 'ACTIVE' || value === 'UNDER_OFFER') && value !== status}
              >
                {LABEL[value]}
              </option>
            ))}
          </select>
          {!hasLiveMandate && <span className="lf-field__hint">Activate a mandate below to put it on the market.</span>}
        </label>
        <label className="lf-field" htmlFor={`${id}-permit`}>
          <span className="lf-label">Trakheesi permit number</span>
          <input
            id={`${id}-permit`}
            className="lf-input"
            name="permitNumber"
            maxLength={60}
            defaultValue={permitNumber ?? ''}
          />
        </label>
        <label className="lf-field" htmlFor={`${id}-expiry`}>
          <span className="lf-label">Permit expires</span>
          <DateInput id={`${id}-expiry`} name="permitExpiry" defaultValue={permitExpiry} />
        </label>
      </div>
      <div className="lf-form-actions">
        {error && (
          <div className="lf-alert" role="alert">
            {error}
          </div>
        )}
        <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
