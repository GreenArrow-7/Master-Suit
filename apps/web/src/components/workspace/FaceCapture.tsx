'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

/**
 * The camera end of face check-in and HR enrolment.
 *
 * This component deliberately does no recognition. It captures frames and posts
 * them; detection, liveness and matching all happen on the server. If the
 * browser computed the embedding, a punch would be a vector in a JSON body that
 * anyone could capture once and replay forever.
 *
 * Both modes share the camera plumbing because there is only one correct way to
 * open a stream, draw a frame and shut the track down again — and a leaked
 * camera track is the bug users notice immediately.
 */
type Mode = 'punch' | 'enrol';
type Phase = 'idle' | 'ready' | 'working' | 'done';

const CAPTURE_WIDTH = 640;
const JPEG_QUALITY = 0.82;

export default function FaceCapture({
  mode,
  endpointBase,
  employeeId,
  samplesRequired = 4,
}: {
  mode: Mode;
  /** `/api/v1/workspaces/{slug}/hr/actions` */
  endpointBase: string;
  /** Enrolment only: whose face is being enrolled. */
  employeeId?: string;
  samplesRequired?: number;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<string | null>(null);
  const [samples, setSamples] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPhase('idle');
    setInstruction(null);
  }, []);

  // A camera left running after navigation keeps the device light on, which
  // reads as the app spying. Always release it on unmount.
  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);
    setStatus(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'This browser will not give the page a camera. Browsers only allow camera access over HTTPS or on localhost — reaching this app on a plain http:// LAN address blocks it no matter how the server is configured.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('ready');
    } catch (cause) {
      setError(`The camera could not be opened: ${(cause as Error).message}`);
    }
  }

  function grab(): string {
    const video = videoRef.current!;
    const scale = CAPTURE_WIDTH / (video.videoWidth || CAPTURE_WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round((video.videoHeight || 480) * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]!;
  }

  const wait = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  async function post(action: string, body: unknown) {
    const response = await authFetch(`${endpointBase}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail ?? data.title ?? `The request failed (${response.status}).`);
    return data;
  }

  function position(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser will not share a location.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        resolve,
        (cause) => reject(new Error(`Location unavailable: ${cause.message}`)),
        {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        },
      );
    });
  }

  async function doPunch(punchType: 'CHECK_IN' | 'CHECK_OUT') {
    setPhase('working');
    setError(null);
    setStatus(null);
    try {
      setStatus('Getting your location…');
      const fix = await position();
      const where = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        gpsAccuracyM: Math.round(fix.coords.accuracy ?? 0),
      };

      // Read-only: tells the employee where they stand before anything is spent.
      setStatus('Checking your location against your assigned site…');
      const check = await post('attendance-preflight', { punchType, ...where });
      if (!check.ok) {
        setError(check.message);
        setPhase('ready');
        return;
      }
      setStatus(check.message);

      // The server picks the movement. A client-chosen challenge is no challenge.
      const challenge = await post('attendance-challenge', {});
      setInstruction(challenge.instruction);

      const neutral = grab();
      await wait(400);
      setStatus('Hold that position…');
      await wait(1_400);
      const moved = grab();
      setInstruction(null);

      setStatus('Verifying…');
      const result = await post('attendance-punch', {
        punchType,
        nonce: challenge.nonce,
        frames: [neutral, moved],
        ...where,
        deviceFingerprint: fingerprint(),
        // Lets the same queued punch be synced twice without recording twice.
        clientPunchUid: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        clientTime: new Date().toISOString(),
      });

      if (result.result === 'ACCEPTED' || result.result === 'FLAGGED_REVIEW') {
        setStatus(result.message);
        setPhase('done');
        stop();
        router.refresh();
      } else {
        setError(result.message);
        setPhase('ready');
      }
    } catch (cause) {
      setError((cause as Error).message);
      setPhase('ready');
    }
  }

  async function doEnrol() {
    setPhase('working');
    setError(null);
    try {
      // Four shots of one pose give a template that fails the moment the person
      // tilts their head, so the prompts ask for genuinely different angles.
      const prompts = [
        'Look straight at the camera.',
        'Turn slightly to your left.',
        'Turn slightly to your right.',
        'Tilt your head slightly up.',
      ];
      const frames: string[] = [];
      for (let index = 0; index < Math.max(samplesRequired, prompts.length); index += 1) {
        setInstruction(prompts[index % prompts.length]!);
        setSamples(index);
        await wait(1_600);
        frames.push(grab());
      }
      setInstruction(null);
      setSamples(frames.length);
      setStatus('Building the template…');
      const result = await post('face-enrol', { employeeId, frames });
      setStatus(`Enrolled ${result.samples} samples (spread ${result.sampleSpread}).`);
      setPhase('done');
      stop();
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setPhase('ready');
      setInstruction(null);
      setSamples(0);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          position: 'relative',
          maxWidth: 420,
          aspectRatio: '4 / 3',
          background: '#000',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        {instruction && (
          <div
            role="status"
            style={{
              position: 'absolute',
              inset: 'auto 0 0 0',
              padding: '10px 12px',
              background: 'rgb(0 0 0 / .68)',
              color: '#fff',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {instruction}
          </div>
        )}
        {phase === 'idle' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'rgb(255 255 255 / .6)',
              fontSize: 13,
            }}
          >
            Camera off
          </div>
        )}
      </div>

      {status && (
        <div role="status" style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          {status}
        </div>
      )}
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}
      {mode === 'enrol' && samples > 0 && phase === 'working' && (
        <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          Sample {samples} of {Math.max(samplesRequired, 4)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {phase === 'idle' && (
          <button className="lf-btn" type="button" onClick={() => void start()}>
            Start camera
          </button>
        )}
        {phase === 'ready' && mode === 'punch' && (
          <>
            <button className="lf-btn" type="button" onClick={() => void doPunch('CHECK_IN')}>
              Check in
            </button>
            <button className="lf-btn lf-btn--secondary" type="button" onClick={() => void doPunch('CHECK_OUT')}>
              Check out
            </button>
            <button className="lf-btn lf-btn--ghost" type="button" onClick={stop}>
              Stop camera
            </button>
          </>
        )}
        {phase === 'ready' && mode === 'enrol' && (
          <>
            <button className="lf-btn" type="button" onClick={() => void doEnrol()} disabled={!employeeId}>
              Capture {Math.max(samplesRequired, 4)} samples
            </button>
            <button className="lf-btn lf-btn--ghost" type="button" onClick={stop}>
              Stop camera
            </button>
          </>
        )}
        {phase === 'working' && (
          <button className="lf-btn" type="button" disabled>
            Working…
          </button>
        )}
        {phase === 'done' && (
          <button className="lf-btn lf-btn--ghost" type="button" onClick={() => setPhase('idle')}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A stable-per-browser label, not a security control: it is client-supplied and
 * trivially forged. It exists so HR can see "the same device punched for three
 * different people this morning" when reviewing, nothing more.
 */
function fingerprint(): string {
  const key = 'master-suite:device';
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = `${navigator.platform || 'web'}-${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(key, value);
  }
  return value;
}
