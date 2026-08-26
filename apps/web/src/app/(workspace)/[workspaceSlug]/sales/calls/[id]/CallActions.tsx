'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  callId: string;
  hasConsent: boolean;
  callStatus: string;
  hasTranscript: boolean;
  hasAnalysis: boolean;
  hasRecording: boolean;
}

export default function CallActions({
  callId,
  hasConsent,
  callStatus,
  hasTranscript,
  hasAnalysis,
  hasRecording,
}: Props) {
  // Lets the analysis poll below notice the component is gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  async function api(url: string, method: string, body?: Record<string, unknown>) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail ?? `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function recordConsent(method: string) {
    setBusy('consent');
    setError('');
    try {
      await api(`/api/v1/calls/${callId}/consent`, 'POST', { consentGiven: true, method });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  async function withdrawConsent() {
    setBusy('withdraw');
    setError('');
    try {
      await api(`/api/v1/calls/${callId}/consent`, 'DELETE');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  async function updateOutcome(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('outcome');
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/api/v1/calls/${callId}`, 'PATCH', {
        outcome: fd.get('outcome') as string,
        status: 'COMPLETED',
        endedAt: new Date().toISOString(),
        notes: (fd.get('notes') as string) || undefined,
      });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  async function submitTranscript(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('transcript');
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/api/v1/calls/${callId}/transcript`, 'POST', {
        content: fd.get('content') as string,
        language: (fd.get('language') as string) || 'en',
      });
      setShowTranscript(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  async function triggerAnalysis() {
    setBusy('analysis');
    setError('');
    try {
      await api(`/api/v1/calls/${callId}/analysis`, 'POST');
      // The analysis runs in the background; poll until it leaves PROCESSING so
      // the panel updates without a manual reload.
      for (let attempt = 0; attempt < 16 && alive.current; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (!alive.current) return;
        if (document.hidden) continue;
        const res = await fetch(`/api/v1/calls/${callId}/analysis`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status && data.status !== 'PROCESSING') break;
      }
      if (!alive.current) return;
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  async function uploadRecording(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('recording');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      // Multipart PUT: the server scans, stores and queues transcription itself.
      const res = await fetch(`/api/v1/calls/${callId}/recording/media`, { method: 'PUT', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Upload failed (${res.status})`);
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy('');
  }

  async function createFollowUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('followup');
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api('/api/v1/follow-ups', 'POST', {
        callId,
        title: fd.get('title') as string,
        dueAt: fd.get('dueAt') as string,
        priority: fd.get('priority') as string,
      });
      setShowFollowUp(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy('');
  }

  const isActive = ['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(callStatus);

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Actions
      </div>

      {error && (
        <div
          style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)', marginBottom: 'var(--lf-space-3)' }}
        >
          {error}
        </div>
      )}

      {/* Consent */}
      {!hasConsent && isActive && (
        <div style={{ marginBottom: 'var(--lf-space-4)' }}>
          <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500, marginBottom: 8 }}>Record Consent</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['VERBAL', 'ELECTRONIC', 'PRE_AUTHORIZED'].map((m) => (
              <button key={m} className="lf-btn lf-btn--secondary" onClick={() => recordConsent(m)} disabled={!!busy}>
                {busy === 'consent' ? '…' : m.toLowerCase().replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasConsent && isActive && (
        <div style={{ marginBottom: 'var(--lf-space-4)' }}>
          <button
            className="lf-btn lf-btn--secondary"
            onClick={withdrawConsent}
            disabled={!!busy}
            style={{ color: 'var(--lf-vermillion)' }}
          >
            {busy === 'withdraw' ? '…' : 'Withdraw Consent'}
          </button>
        </div>
      )}

      {/* Complete call */}
      {isActive && (
        <form onSubmit={updateOutcome} style={{ marginBottom: 'var(--lf-space-4)' }}>
          <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500, marginBottom: 8 }}>Complete Call</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <select name="outcome" required className="lf-input">
              <option value="">Select outcome…</option>
              {[
                'CONNECTED',
                'NO_ANSWER',
                'BUSY',
                'VOICEMAIL',
                'WRONG_NUMBER',
                'CALLBACK_REQUESTED',
                'NOT_INTERESTED',
                'INTERESTED',
                'QUALIFIED',
                'CONVERTED',
              ].map((o) => (
                <option key={o} value={o}>
                  {o.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <textarea name="notes" className="lf-input" rows={2} placeholder="Post-call notes…" />
            <button type="submit" className="lf-btn lf-btn--primary" disabled={!!busy}>
              {busy === 'outcome' ? 'Saving…' : 'Complete'}
            </button>
          </div>
        </form>
      )}

      {/* Recording upload — consent gate mirrors the server's */}
      {hasConsent && (
        <label
          className="lf-btn lf-btn--secondary"
          style={{ marginBottom: 8, display: 'block', textAlign: 'center', cursor: 'pointer' }}
        >
          {busy === 'recording' ? 'Uploading…' : hasRecording ? 'Replace Recording' : 'Upload Recording'}
          <input
            type="file"
            accept="audio/*,video/*"
            style={{ display: 'none' }}
            onChange={uploadRecording}
            disabled={!!busy}
          />
        </label>
      )}
      {!hasConsent && !isActive && (
        <p className="lf-hint" style={{ marginBottom: 8 }}>
          Recordings and transcripts need recorded consent first.
        </p>
      )}

      {/* Transcript upload */}
      {!showTranscript ? (
        <button
          className="lf-btn lf-btn--secondary"
          onClick={() => setShowTranscript(true)}
          disabled={!!busy}
          style={{ marginBottom: 8, display: 'block' }}
        >
          {hasTranscript ? 'Update Transcript' : 'Upload Transcript'}
        </button>
      ) : (
        <form onSubmit={submitTranscript} style={{ marginBottom: 'var(--lf-space-4)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500 }}>Transcript</div>
          <textarea name="content" required className="lf-input" rows={6} placeholder="Paste call transcript here…" />
          <input name="language" className="lf-input" defaultValue="en" placeholder="Language code (e.g. en, ar)" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn lf-btn--primary" disabled={!!busy}>
              {busy === 'transcript' ? 'Saving…' : 'Save Transcript'}
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setShowTranscript(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* AI Analysis trigger */}
      {hasTranscript && (
        <button
          className="lf-btn lf-btn--primary"
          onClick={triggerAnalysis}
          disabled={!!busy}
          style={{ marginBottom: 8, display: 'block' }}
        >
          {busy === 'analysis' ? 'Analyzing…' : hasAnalysis ? 'Re-run AI Analysis' : 'Run AI Analysis'}
        </button>
      )}

      {/* Follow-up */}
      {!showFollowUp ? (
        <button className="lf-btn lf-btn--secondary" onClick={() => setShowFollowUp(true)}>
          Create Follow-up
        </button>
      ) : (
        <form onSubmit={createFollowUp} style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 500 }}>New Follow-up</div>
          <input name="title" required className="lf-input" placeholder="Follow-up title" />
          <input name="dueAt" type="datetime-local" required className="lf-input" />
          <select name="priority" className="lf-input" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn lf-btn--primary" disabled={!!busy}>
              {busy === 'followup' ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setShowFollowUp(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
