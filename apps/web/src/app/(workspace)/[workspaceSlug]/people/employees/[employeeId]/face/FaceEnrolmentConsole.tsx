'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Administrator-supervised face enrolment.
 *
 * The administrator runs the session; the employee stands at the camera and
 * gives their own consent. That split is why there is no button here that
 * records consent — HR can start an enrolment but the permission has to come
 * from the person whose face it is, from their own Security screen, and the
 * server refuses an enrolment without it.
 *
 * Samples are captured from four angles because templates built from one pose
 * match that pose and little else. Nothing leaves this component except the
 * frames; the templates the server derives from them are never sent back, and
 * the images themselves are not stored.
 */
const ANGLES = [
  { key: 'straight', label: 'Straight on', hint: 'Look directly at the camera.' },
  { key: 'left', label: 'Slightly left', hint: 'Turn your head a little to your left.' },
  { key: 'right', label: 'Slightly right', hint: 'Turn your head a little to your right.' },
  { key: 'up', label: 'Slightly up', hint: 'Lift your chin a little.' },
] as const;

export default function FaceEnrolmentConsole({
  actionsBase,
  employeeId,
  employeeName,
  consented,
  enrolled,
  samplesRequired,
  activityHref,
}: {
  actionsBase: string;
  employeeId: string;
  employeeName: string;
  consented: boolean;
  enrolled: boolean;
  samplesRequired: number;
  activityHref: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [samples, setSamples] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reason, setReason] = useState('');

  // The camera keeps running until the tab is closed otherwise, which is both a
  // privacy problem and a lit webcam light nobody can explain.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setStatus(null);
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
      setStatus({ text: `Camera on. ${ANGLES[0].hint}` });
    } catch {
      setStatus({ text: 'Camera permission denied — enrolment needs the camera.', bad: true });
    }
  }

  function grab(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  function captureSample() {
    const frame = grab();
    if (!frame) {
      setStatus({ text: 'The camera produced no image. Restart it and try again.', bad: true });
      return;
    }
    const next = [...samples, frame];
    setSamples(next);
    const following = ANGLES[next.length];
    setStep(next.length);
    setStatus({
      text: following
        ? `Sample ${next.length} of ${ANGLES.length} captured. ${following.hint}`
        : 'All samples captured. Save the enrolment.',
    });
  }

  async function call(action: string, body: Record<string, unknown>) {
    const res = await fetch(`${actionsBase}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'That did not work.');
    return data;
  }

  async function save() {
    setBusy(true);
    setStatus({ text: 'Checking the samples…' });
    try {
      const result = await call('face-enrol', { employeeId, frames: samples });
      stopCamera();
      setSamples([]);
      setStep(0);
      setStatus({ text: `Enrolled. ${result.samples} templates stored from distinct angles.` });
      router.refresh();
    } catch (error) {
      // A rejection means blurred, duplicate, multi-face or too-alike samples.
      // The server says which; the samples are dropped rather than half-kept so
      // the next attempt starts clean.
      setSamples([]);
      setStep(0);
      setStatus({ text: `${(error as Error).message} Start the samples again.`, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function resetEnrolment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await call('face-reset', { employeeId, reason });
      setResetting(false);
      setReason('');
      setStatus({
        text: `Enrolment reset — ${result.templatesDeleted} templates deleted. This person cannot check in until they are enrolled again.`,
      });
      router.refresh();
    } catch (error) {
      setStatus({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  const done = samples.length >= ANGLES.length;

  return (
    <>
      <div className="lf-face__actions">
        {!cameraOn ? (
          <button type="button" className="lf-btn" onClick={() => void startCamera()} disabled={!consented || busy}>
            {enrolled ? 'Re-enroll' : 'Start enrollment'}
          </button>
        ) : (
          <>
            <button type="button" className="lf-btn" onClick={captureSample} disabled={busy || done}>
              Capture sample
            </button>
            <button type="button" className="lf-btn" onClick={() => void save()} disabled={busy || !done}>
              {busy ? 'Saving…' : 'Save enrollment'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              onClick={() => {
                stopCamera();
                setSamples([]);
                setStep(0);
                setStatus(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        )}
        {enrolled && (
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            onClick={() => setResetting((open) => !open)}
            disabled={busy}
          >
            Reset enrollment
          </button>
        )}
        <Link className="lf-btn lf-btn--secondary" href={activityHref}>
          View recognition activity
        </Link>
      </div>

      {!consented && (
        <p className="lf-face__warn" role="status">
          {employeeName} has not given biometric consent. They must record it themselves on their own Security screen —
          you cannot give it on their behalf, and the server refuses an enrolment without it.
        </p>
      )}

      {status && (
        <p className="lf-security__note" data-bad={status.bad} role="status">
          {status.text}
        </p>
      )}

      {resetting && (
        <form className="lf-card lf-face__reset" onSubmit={resetEnrolment}>
          <h2>Reset face enrollment</h2>
          <p>
            This deletes every stored template for {employeeName}. Face check-in stops working immediately and they must
            be enrolled again in person. Their consent is left alone — only the employee can withdraw that.
          </p>
          <div className="lf-field">
            <label className="lf-label" htmlFor="face-reason">
              Reason (recorded in the audit trail)
            </label>
            <input
              id="face-reason"
              className="lf-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={300}
              required
              placeholder="Poor sample quality, appearance changed, suspected misuse…"
            />
          </div>
          <div className="lf-face__actions">
            <button className="lf-btn" type="submit" disabled={busy || reason.trim().length < 5}>
              {busy ? 'Resetting…' : 'Reset enrollment'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              onClick={() => setResetting(false)}
              disabled={busy}
            >
              Keep enrollment
            </button>
          </div>
        </form>
      )}

      <div className="lf-face__stage" data-on={cameraOn}>
        <div className="lf-face__viewport">
          <video ref={videoRef} playsInline muted className="lf-face__video" data-on={cameraOn} />
          {!cameraOn && <span className="lf-face__off">Camera off</span>}
        </div>
        <ol className="lf-face__steps">
          {ANGLES.map((angle, index) => (
            <li
              key={angle.key}
              data-state={index < samples.length ? 'done' : index === step && cameraOn ? 'now' : 'todo'}
            >
              <span className="lf-face__step-n">{index + 1}</span>
              <span>
                <strong>{angle.label}</strong>
                <em>{angle.hint}</em>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="lf-face__meta">
        {samples.length} of {ANGLES.length} samples captured · policy requires at least {samplesRequired}. Samples are
        sent once, converted to templates on the server, and the images are discarded. Templates are never returned to
        this browser.
      </p>
    </>
  );
}
