'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The attendance console, built to the reference screen.
 *
 * Left: a live GST clock, the circular camera viewport, and the LIVE / IDENTITY
 * / ON SITE verdicts. Right: the assigned location, the GPS diagnostic line,
 * and the actions.
 *
 * Every verdict shown here is the server's. The client reads GPS and camera
 * frames and reports them; distance, geofence, accuracy, sequence, the
 * same-location check-out rule and the face match are all decided server-side
 * (services/hr/attendance). Nothing here can talk itself into a punch — the
 * status line only ever renders what the server said.
 */
export interface AssignedLocation {
  name: string;
  radiusMeters: number;
  checkoutRule: string;
}
export interface RecentPunch {
  id: string;
  type: string;
  at: string;
  result: string;
  location: string | null;
  distanceM: number | null;
  reason: string | null;
}

type Verdict = '—' | 'PASS' | 'FAIL' | '…';

interface Preflight {
  ok: boolean;
  code: string;
  message: string;
  candidates: {
    name: string;
    distanceM: number;
    radiusM: number;
    inside: boolean;
    maxAccuracyM: number;
    accuracyOk: boolean;
  }[];
}

const FRAME_COUNT = 3;

/** Asia/Dubai wall clock — GST — which is the timezone the server reports in. */
function gstNow() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function deviceFingerprint() {
  const KEY = 'lf_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function CheckInConsole({
  endpointBase,
  assigned,
  consented,
  enrolled,
  engineReady,
  openCheckIn,
  initialRecent,
}: {
  endpointBase: string;
  assigned: AssignedLocation[];
  consented: boolean;
  enrolled: boolean;
  engineReady: boolean;
  openCheckIn: boolean;
  initialRecent: RecentPunch[];
}) {
  /**
   * Empty until mounted. A clock rendered on the server is a different second
   * from the one the browser hydrates with, which React reports as a mismatch
   * and re-renders the whole tree over.
   */
  const [clock, setClock] = useState('');
  const [live, setLive] = useState<Verdict>('—');
  const [identity, setIdentity] = useState<Verdict>('—');
  const [onSite, setOnSite] = useState<Verdict>('—');
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [diagnosticBad, setDiagnosticBad] = useState(true);
  const [status, setStatus] = useState('Ready. Check in when you’re on site.');
  const [hint, setHint] = useState('Location not read yet');
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [recent, setRecent] = useState<RecentPunch[]>(initialRecent);
  const [hasOpen, setHasOpen] = useState(openCheckIn);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const position = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    // First tick on the next frame rather than synchronously: setting state
    // inside the effect body cascades a second render on mount.
    const first = requestAnimationFrame(() => setClock(gstNow()));
    const t = setInterval(() => setClock(gstNow()), 1000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(t);
    };
  }, []);

  // Release the camera when the screen goes away — a live indicator left on
  // after navigation is alarming and, on a phone, expensive.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const post = useCallback(
    async (action: string, body: Record<string, unknown>) => {
      const res = await fetch(`${endpointBase}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'That did not work.');
      return data;
    },
    [endpointBase],
  );

  /** High-accuracy fix, then the server's read on where that puts us. */
  const readLocation = useCallback(
    async (punchType: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_IN') => {
      setHint('Reading location…');
      setOnSite('…');
      let fix: GeolocationPosition;
      try {
        fix = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0,
          }),
        );
      } catch (error) {
        const code = (error as GeolocationPositionError)?.code;
        setOnSite('FAIL');
        setDiagnosticBad(true);
        setDiagnostic(
          code === 1
            ? 'Location permission denied — attendance cannot be recorded without it.'
            : code === 3
              ? 'Location timed out. Move somewhere with a clearer view of the sky and retry.'
              : 'Location is unavailable on this device.',
        );
        setHint('Location not read yet');
        return null;
      }

      position.current = fix;
      try {
        const pre = (await post('attendance-preflight', {
          punchType,
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          gpsAccuracyM: fix.coords.accuracy ?? 0,
        })) as Preflight;

        const nearest = pre.candidates[0];
        if (nearest) {
          // The reference's diagnostic line, field for field.
          setDiagnostic(
            `GPS accuracy ±${Math.round(fix.coords.accuracy ?? 0)} m · ${Math.round(nearest.distanceM)} m from ${nearest.name} · radius ${nearest.radiusM} m · ${nearest.inside ? 'INSIDE' : 'OUTSIDE'} geofence`,
          );
          setDiagnosticBad(!pre.ok);
          setOnSite(nearest.inside && pre.ok ? 'PASS' : 'FAIL');
        } else {
          setDiagnostic(pre.message);
          setDiagnosticBad(true);
          setOnSite('FAIL');
        }
        setHint(pre.ok ? 'Location confirmed' : pre.message);
        return pre;
      } catch (error) {
        setDiagnostic((error as Error).message);
        setDiagnosticBad(true);
        setOnSite('FAIL');
        setHint('Location not read yet');
        return null;
      }
    },
    [post],
  );

  async function startCamera() {
    setStatus('Starting camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setLive('…');
      setStatus('Camera on. Look straight at the circle, then check in.');
    } catch {
      setLive('FAIL');
      setCameraOn(false);
      setStatus('Camera permission denied — face check-in needs the camera.');
    }
  }

  /** A few frames a moment apart: identical stills are refused server-side. */
  async function captureFrames(): Promise<string[]> {
    const video = videoRef.current;
    if (!video) return [];
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    const frames: string[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.72));
      await new Promise((r) => setTimeout(r, 220));
    }
    return frames;
  }

  async function refreshRecent() {
    try {
      const res = await fetch(`${endpointBase.replace('/actions', '')}/attendance-punches?limit=8`);
      const rows = await res.json().catch(() => []);
      if (Array.isArray(rows)) {
        setRecent(
          rows.map((row: Record<string, unknown>) => ({
            id: String(row.id),
            type: String(row.punchType),
            at: String(row.serverTime),
            result: String(row.result),
            location: (row.location as { name?: string } | null)?.name ?? null,
            distanceM: row.distanceM == null ? null : Number(row.distanceM),
            reason: (row.rejectReason as string | null) ?? null,
          })),
        );
      }
    } catch {
      /* the list is a convenience; a failed refresh must not break the console */
    }
  }

  async function punch(punchType: 'CHECK_IN' | 'CHECK_OUT') {
    if (busy) return;
    setBusy(true);
    setStatus(punchType === 'CHECK_IN' ? 'Checking in…' : 'Checking out…');
    try {
      const pre = await readLocation(punchType);
      if (!pre) return;
      if (!position.current) return;
      if (!cameraOn) {
        setStatus('Start the camera first — attendance is face verified.');
        return;
      }

      const { nonce } = (await post('attendance-challenge', {})) as { nonce: string };
      const frames = await captureFrames();
      if (frames.length < 2) {
        setStatus('The camera produced no frames. Restart it and try again.');
        return;
      }

      const result = (await post('attendance-punch', {
        punchType,
        nonce,
        frames,
        latitude: position.current.coords.latitude,
        longitude: position.current.coords.longitude,
        gpsAccuracyM: position.current.coords.accuracy ?? 0,
        deviceFingerprint: deviceFingerprint(),
        clientTime: new Date().toISOString(),
        clientPunchUid: crypto.randomUUID(),
      })) as { result: string; message: string; distanceM: number | null };

      const accepted = result.result === 'ACCEPTED' || result.result === 'FLAGGED_REVIEW';
      setStatus(result.message);
      setIdentity(result.result === 'REJECTED_FACE' ? 'FAIL' : accepted ? 'PASS' : identity);
      setLive(result.result === 'REJECTED_LIVENESS' ? 'FAIL' : accepted ? 'PASS' : live);
      setOnSite(result.result === 'REJECTED_GEOFENCE' ? 'FAIL' : accepted ? 'PASS' : onSite);
      if (accepted) setHasOpen(punchType === 'CHECK_IN');
      await refreshRecent();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !consented ? 'consent' : !enrolled ? 'enrolment' : !engineReady ? 'engine' : null;

  return (
    <div className="lf-checkin">
      <section className="lf-card lf-checkin__stage">
        <div className="lf-checkin__clock" suppressHydrationWarning>
          {clock ? `${clock} GST` : ' '}
        </div>
        <div className="lf-checkin__lens" aria-live="polite">
          <video ref={videoRef} playsInline muted className="lf-checkin__video" data-on={cameraOn} />
          {!cameraOn && <span className="lf-checkin__lens-hint">Camera off</span>}
          <i className="lf-checkin__tick" data-at="n" aria-hidden />
          <i className="lf-checkin__tick" data-at="e" aria-hidden />
          <i className="lf-checkin__tick" data-at="s" aria-hidden />
          <i className="lf-checkin__tick" data-at="w" aria-hidden />
        </div>
        <div className="lf-checkin__verdicts">
          {(
            [
              ['LIVE', live],
              ['IDENTITY', identity],
              ['ON SITE', onSite],
            ] as const
          ).map(([label, value]) => (
            <div className="lf-checkin__verdict" key={label}>
              <span className="lf-eyebrow">{label}</span>
              <strong data-state={value}>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="lf-card lf-checkin__panel">
        <h2>Record attendance</h2>

        <div className="lf-checkin__assigned">
          <span className="lf-eyebrow">Your assigned location(s)</span>
          {assigned.length === 0 ? (
            <p className="lf-checkin__none">
              You have no active work-location assignment, so no check-in can be accepted. Ask HR to assign you a
              location.
            </p>
          ) : (
            assigned.map((location) => (
              <p key={location.name} className="lf-checkin__location">
                <strong>{location.name}</strong> — allowed radius {location.radiusMeters} m ·{' '}
                {location.checkoutRule === 'SAME_LOCATION'
                  ? 'check out at the same location'
                  : location.checkoutRule === 'ANY_ASSIGNED'
                    ? 'check out at any assigned location'
                    : 'check-out needs an approved exception'}
              </p>
            ))
          )}
        </div>

        {diagnostic && (
          <p className="lf-checkin__diagnostic" data-bad={diagnosticBad} role="status">
            {diagnostic}
          </p>
        )}

        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => void readLocation()}>
          Retry location
        </button>

        {blocked && (
          <p className="lf-checkin__blocked" role="alert">
            {blocked === 'consent'
              ? 'Record your biometric consent on the Security page before using face check-in.'
              : blocked === 'enrolment'
                ? 'Your face is not enrolled yet. HR does this in person.'
                : 'Face check-in is unavailable while the verification service is down. Nothing is recorded until it returns.'}
          </p>
        )}

        <button
          type="button"
          className="lf-btn lf-checkin__camera"
          onClick={() => void startCamera()}
          disabled={cameraOn || !!blocked}
        >
          {cameraOn ? 'Camera running' : 'Start camera'}
        </button>

        <div className="lf-checkin__actions">
          <button
            type="button"
            className="lf-btn"
            disabled={busy || !!blocked || hasOpen}
            onClick={() => void punch('CHECK_IN')}
            title={hasOpen ? 'You already have an open check-in.' : undefined}
          >
            Check in
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            disabled={busy || !!blocked || !hasOpen}
            onClick={() => void punch('CHECK_OUT')}
            title={hasOpen ? undefined : 'There is no open check-in to close.'}
          >
            Check out
          </button>
        </div>

        <p className="lf-checkin__status" role="status" aria-live="polite">
          {status}
        </p>
        <p className="lf-checkin__hint">{hint}</p>
      </section>

      <section className="lf-card lf-checkin__recent">
        <div className="lf-checkin__recent-head">
          <h2>Recent</h2>
          <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => void refreshRecent()}>
            Refresh
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="lf-checkin__none">No check-in has been attempted yet.</p>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Result</th>
                <th>Location</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td data-label="When">
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone: 'Asia/Dubai',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      hourCycle: 'h23',
                    }).format(new Date(row.at))}
                  </td>
                  <td data-label="Type">{row.type === 'CHECK_IN' ? 'Check in' : 'Check out'}</td>
                  <td data-label="Result">
                    <span className="lf-badge">{row.result.replace(/_/g, ' ').toLowerCase()}</span>
                  </td>
                  <td data-label="Location">{row.location ?? '—'}</td>
                  <td data-label="Distance">{row.distanceM == null ? '—' : `${Math.round(row.distanceM)} m`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
