'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModuleBase } from '@/components/workspace/SalesLink';

interface LeadOption {
  id: string;
  fullName: string;
  company: string | null;
  phone: string | null;
}

export default function NewCallForm() {
  const router = useRouter();
  const base = useModuleBase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Lead picker: search-as-you-type against the leads API instead of asking a
  // salesperson to paste a database id.
  const [leadQuery, setLeadQuery] = useState('');
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [lead, setLead] = useState<LeadOption | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Which results the dropdown may show, computed rather than stored.
   *
   * The effect below used to call `setLeadOptions([])` synchronously to discard
   * results once a lead was picked or the query got too short. That is a state
   * write during an effect for a value render can derive, and the React
   * Compiler flags it as a cascading render. Deriving it also closes the window
   * where results from a previous query were briefly still on screen.
   */
  const visibleOptions = lead || leadQuery.trim().length < 2 ? [] : leadOptions;

  useEffect(() => {
    if (lead || leadQuery.trim().length < 2) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/v1/leads?q=${encodeURIComponent(leadQuery.trim())}&pageSize=8`);
        if (res.ok) {
          const data = await res.json();
          const rows = (data.data ?? data ?? []) as LeadOption[];
          setLeadOptions(rows.map((r) => ({ id: r.id, fullName: r.fullName, company: r.company, phone: r.phone })));
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [leadQuery, lead]);

  async function submit(destination: 'detail' | 'live', form: HTMLFormElement) {
    setSubmitting(true);
    setError('');
    const fd = new FormData(form);
    const body: Record<string, string> = {};
    body.recipientNumber = (fd.get('recipientNumber') as string) || lead?.phone || '';
    body.direction = fd.get('direction') as string;
    if (lead) body.leadId = lead.id;
    if (fd.get('notes')) body.notes = fd.get('notes') as string;

    if (!body.recipientNumber) {
      setError('Enter a phone number, or pick a lead that has one.');
      setSubmitting(false);
      return;
    }

    const res = await fetch('/api/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? 'Failed to create call');
      setSubmitting(false);
      return;
    }

    const call = await res.json();
    router.push(`${base}/calls/${call.id}${destination === 'live' ? '/live' : ''}`);
  }

  return (
    <>
      <h1 className="lf-h1">New Call</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit('detail', e.currentTarget);
        }}
        className="lf-card"
        style={{ padding: 'var(--lf-space-5)', maxWidth: 480, display: 'grid', gap: 'var(--lf-space-4)' }}
      >
        <div className="lf-field" style={{ position: 'relative' }}>
          <span className="lf-label">Lead</span>
          {lead ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--lf-space-2)',
                border: '1px solid var(--lf-line)',
                borderRadius: 'var(--lf-radius-sm)',
                padding: '6px 10px',
                fontSize: 'var(--lf-text-sm)',
              }}
            >
              <span>
                <strong>{lead.fullName}</strong>
                {lead.company ? ` · ${lead.company}` : ''}
                {lead.phone ? ` · ${lead.phone}` : ''}
              </span>
              <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setLead(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="lf-input"
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                placeholder="Search leads by name…"
                aria-label="Search leads"
                autoComplete="off"
              />
              {(visibleOptions.length > 0 || searching) && leadQuery.trim().length >= 2 && (
                <ul
                  className="lf-card"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 30,
                    margin: '4px 0 0',
                    padding: 4,
                    listStyle: 'none',
                    maxHeight: 240,
                    overflowY: 'auto',
                    boxShadow: 'var(--lf-shadow-2)',
                  }}
                >
                  {searching && visibleOptions.length === 0 && (
                    <li style={{ padding: '6px 10px', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                      Searching…
                    </li>
                  )}
                  {visibleOptions.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setLead(option);
                          setLeadOptions([]);
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '6px 10px',
                          border: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                          fontSize: 'var(--lf-text-sm)',
                          borderRadius: 'var(--lf-radius-sm)',
                        }}
                      >
                        <strong>{option.fullName}</strong>
                        <span style={{ color: 'var(--lf-ink-3)' }}>
                          {option.company ? ` · ${option.company}` : ''}
                          {option.phone ? ` · ${option.phone}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="lf-hint">Optional — linking a lead attaches the call to their timeline.</span>
            </>
          )}
        </div>

        <label className="lf-field">
          <span className="lf-label">Phone Number {lead?.phone ? '' : '*'}</span>
          <input
            name="recipientNumber"
            type="tel"
            className="lf-input"
            placeholder={lead?.phone ?? '+971 50 123 4567'}
            required={!lead?.phone}
          />
        </label>

        <label className="lf-field">
          <span className="lf-label">Direction</span>
          <select name="direction" className="lf-input" defaultValue="OUTBOUND">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
        </label>

        <label className="lf-field">
          <span className="lf-label">Notes</span>
          <textarea name="notes" className="lf-input" rows={3} placeholder="Pre-call notes..." />
        </label>

        {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
          <button type="submit" className="lf-btn lf-btn--primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Call'}
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            disabled={submitting}
            onClick={(e) => void submit('live', e.currentTarget.closest('form')!)}
          >
            Create &amp; open live workspace
          </button>
        </div>
      </form>
    </>
  );
}
