'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The Security screen, built to the reference: two-factor authentication, face
 * check-in consent, and password, in that order and with that wording.
 *
 * Every action is wired to the real endpoint — enrolment issues a genuine TOTP
 * secret and verifies a code, the password change validates the current one and
 * signs other devices out, and withdrawing consent deletes the face templates.
 */
export default function SecurityScreen({
  selfBase,
  hrBase,
  mfaEnabled,
  consentGiven,
  deletionRequest,
  deletionExecutionEnabled,
}: {
  selfBase: string;
  hrBase: string;
  mfaEnabled: boolean;
  consentGiven: boolean;
  /** The viewer's own open deletion request, if they have one. */
  deletionRequest: {
    id: string;
    status: string;
    blockedReason: string | null;
    requestedAt: string | Date;
  } | null;
  /** Whether the worker erases at all right now. Off: requests queue and nothing runs. */
  deletionExecutionEnabled: boolean;
}) {
  const router = useRouter();

  // ── Two-factor ────────────────────────────────────────────────────────────
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl?: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaNote, setMfaNote] = useState<{ text: string; bad?: boolean } | null>(null);
  // Enrolment now re-authenticates; this is that prompt, kept separate from
  // the change-password form's own field below.
  const [enrolPassword, setEnrolPassword] = useState('');

  // ── Consent ───────────────────────────────────────────────────────────────
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentNote, setConsentNote] = useState<{ text: string; bad?: boolean } | null>(null);

  // ── Deleting this account ─────────────────────────────────────────────────
  const [request, setRequest] = useState(deletionRequest);
  const [delPassword, setDelPassword] = useState('');
  const [delCode, setDelCode] = useState('');
  const [delReason, setDelReason] = useState('');
  const [delConfirm, setDelConfirm] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delNote, setDelNote] = useState<{ text: string; bad?: boolean } | null>(null);

  // ── Password ──────────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function call(base: string, action: string, body?: Record<string, unknown>) {
    const res = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'That did not work.');
    return data;
  }

  async function beginEnrolment(event: React.FormEvent) {
    event.preventDefault();
    setMfaBusy(true);
    setMfaNote(null);
    try {
      const data = (await call(selfBase, 'two-factor-begin', { currentPassword: enrolPassword })) as {
        secret: string;
        otpauthUrl?: string;
      };
      setEnrolPassword('');
      setEnrolment(data);
    } catch (error) {
      setMfaNote({ text: (error as Error).message, bad: true });
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmEnrolment(event: React.FormEvent) {
    event.preventDefault();
    setMfaBusy(true);
    setMfaNote(null);
    try {
      const data = (await call(selfBase, 'two-factor-confirm', { code })) as { recoveryCodes?: string[] };
      setRecovery(data.recoveryCodes ?? []);
      setEnrolment(null);
      setCode('');
      setMfaNote({ text: 'Two-factor authentication is on. Save your recovery codes now — they are shown once.' });
      router.refresh();
    } catch (error) {
      setMfaNote({ text: (error as Error).message, bad: true });
    } finally {
      setMfaBusy(false);
    }
  }

  async function withdrawConsent() {
    if (
      !window.confirm(
        'Withdraw biometric consent? Your face templates are deleted immediately and face check-in stops working until you consent and enrol again.',
      )
    )
      return;
    setConsentBusy(true);
    setConsentNote(null);
    try {
      await call(hrBase, 'consent-withdraw', {});
      setConsentNote({ text: 'Consent withdrawn. Your templates have been deleted.' });
      router.refresh();
    } catch (error) {
      setConsentNote({ text: (error as Error).message, bad: true });
    } finally {
      setConsentBusy(false);
    }
  }

  async function grantConsent() {
    setConsentBusy(true);
    setConsentNote(null);
    try {
      await call(hrBase, 'consent-grant', {});
      setConsentNote({ text: 'Consent recorded. Face check-in is available to you.' });
      router.refresh();
    } catch (error) {
      setConsentNote({ text: (error as Error).message, bad: true });
    } finally {
      setConsentBusy(false);
    }
  }

  async function requestDeletion(event: React.FormEvent) {
    event.preventDefault();
    setDelBusy(true);
    setDelNote(null);
    try {
      const body: Record<string, unknown> = { password: delPassword };
      if (mfaEnabled) body.mfaCode = delCode;
      if (delReason.trim()) body.reason = delReason.trim();
      const created = await call(selfBase, 'account-deletion-request', body);
      // Only the declared fields. The response also carries `blockers`, which names the
      // internal id of every workspace this person belongs to; it is their own data, but
      // there is no reason to park it in client state for a card that never reads it.
      setRequest({
        id: created.id,
        status: created.status,
        blockedReason: created.blockedReason ?? null,
        requestedAt: created.requestedAt,
      });
      setDelPassword('');
      setDelCode('');
      setDelConfirm('');
      // The toast has to agree with the card under it. It said "will be deleted shortly"
      // regardless of the switch, which the browser journey caught sitting directly above a
      // paragraph saying processing was not switched on.
      setDelNote({
        text:
          created.status === 'BLOCKED'
            ? 'Recorded, but it cannot go ahead yet — see below.'
            : deletionExecutionEnabled
              ? 'Recorded. Your account will be deleted shortly.'
              : 'Recorded and held. Nothing is deleted until processing is switched on.',
      });
      router.refresh();
    } catch (err) {
      setDelNote({ text: (err as Error).message, bad: true });
    }
    setDelBusy(false);
  }

  async function cancelDeletion() {
    setDelBusy(true);
    setDelNote(null);
    try {
      await call(selfBase, 'account-deletion-cancel');
      setRequest(null);
      setDelNote({ text: 'Withdrawn. Nothing has been deleted.' });
      router.refresh();
    } catch (err) {
      setDelNote({ text: (err as Error).message, bad: true });
    }
    setDelBusy(false);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 12) {
      setPwNote({ text: 'At least 12 characters.', bad: true });
      return;
    }
    setPwBusy(true);
    setPwNote(null);
    try {
      await call(selfBase, 'password-change', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwNote({ text: 'Password changed. Every other device has been signed out.' });
    } catch (error) {
      setPwNote({ text: (error as Error).message, bad: true });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="lf-security">
      <section className="lf-card lf-security__card">
        <header className="lf-security__head">
          <h2>Two-factor authentication</h2>
          <span className="lf-security__pill" data-on={mfaEnabled}>
            {mfaEnabled ? 'ON' : 'OFF'}
          </span>
        </header>
        <p className="lf-security__copy">
          {mfaEnabled
            ? 'On for your account. A stolen password is not enough to sign in as you.'
            : 'Required for your role. Set it up to keep using your account.'}
        </p>
        <p className="lf-callout lf-callout--info">
          An authenticator means a stolen password isn&rsquo;t enough to reach your account — and it lets you reset your
          own password without calling HR.
        </p>

        {enrolment && (
          <form onSubmit={confirmEnrolment} className="lf-security__enrol">
            <p className="lf-security__copy">
              Add this key to your authenticator app, then enter the six-digit code it shows.
            </p>
            <code className="lf-security__secret">{enrolment.secret}</code>
            <label className="lf-label" htmlFor="mfa-code">
              Six-digit code
            </label>
            <input
              id="mfa-code"
              className="lf-input"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              required
            />
            <button className="lf-btn" type="submit" disabled={mfaBusy || code.length !== 6}>
              {mfaBusy ? 'Verifying…' : 'Verify and turn on'}
            </button>
          </form>
        )}

        {recovery && recovery.length > 0 && (
          <div className="lf-security__codes">
            {recovery.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        )}

        {mfaNote && (
          <p className="lf-security__note" data-bad={mfaNote.bad} role="status">
            {mfaNote.text}
          </p>
        )}

        {!enrolment && !mfaEnabled && (
          <form className="lf-security__form" onSubmit={(event) => void beginEnrolment(event)}>
            <div className="lf-field">
              <label className="lf-label" htmlFor="enrol-password">
                Confirm your password to continue
              </label>
              <input
                id="enrol-password"
                className="lf-input"
                type="password"
                autoComplete="current-password"
                value={enrolPassword}
                onChange={(event) => setEnrolPassword(event.target.value)}
                required
              />
              <p className="lf-security__note">
                Setting up an authenticator hands out recovery codes, so it asks for your password the way changing it
                does.
              </p>
            </div>
            <button type="submit" className="lf-btn" disabled={mfaBusy || !enrolPassword}>
              {mfaBusy ? 'Preparing…' : 'Set up authenticator'}
            </button>
          </form>
        )}
      </section>

      <section className="lf-card lf-security__card">
        <header className="lf-security__head">
          <h2>Face check-in consent</h2>
        </header>
        <p className="lf-security__copy">
          Your face data is biometric data. Under UAE PDPL we may only process it with your explicit consent, and you
          can withdraw it at any time. Only you can give this consent — HR cannot record it on your behalf.
        </p>
        <p className="lf-callout lf-callout--warn">
          <strong>What is stored:</strong> four mathematical templates derived from your face, not photographs of you.
          At each check-in the camera frame is encrypted before it is written to disk and is readable only by authorised
          HR staff. Withdrawing consent deletes your templates immediately.
        </p>
        <p className="lf-security__copy">
          <strong>Status:</strong>{' '}
          {consentGiven
            ? 'consent given. Face check-in is available to you.'
            : 'no consent recorded. Face check-in is unavailable.'}
        </p>
        {consentNote && (
          <p className="lf-security__note" data-bad={consentNote.bad} role="status">
            {consentNote.text}
          </p>
        )}
        {consentGiven ? (
          <button
            type="button"
            className="lf-btn lf-btn--danger"
            onClick={() => void withdrawConsent()}
            disabled={consentBusy}
          >
            {consentBusy ? 'Withdrawing…' : 'Withdraw consent'}
          </button>
        ) : (
          <button type="button" className="lf-btn" onClick={() => void grantConsent()} disabled={consentBusy}>
            {consentBusy ? 'Recording…' : 'I consent to face check-in'}
          </button>
        )}
      </section>

      <section className="lf-card lf-security__card lf-security__password">
        <header className="lf-security__head">
          <h2>Password</h2>
        </header>
        <p className="lf-security__copy">Changing your password signs you out of every other device.</p>
        <form onSubmit={changePassword} className="lf-security__form">
          <label className="lf-label" htmlFor="pw-current">
            Current password
          </label>
          <input
            id="pw-current"
            className="lf-input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <label className="lf-label" htmlFor="pw-new">
            New password
          </label>
          <input
            id="pw-new"
            className="lf-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <p className="lf-security__helper">At least 12 characters.</p>
          {pwNote && (
            <p className="lf-security__note" data-bad={pwNote.bad} role="status">
              {pwNote.text}
            </p>
          )}
          <button className="lf-btn" type="submit" disabled={pwBusy}>
            {pwBusy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="lf-card lf-security__card">
        <header className="lf-security__head">
          <h2>Delete my account</h2>
        </header>

        {request ? (
          <>
            {/*
              Three states, because there are three. This branched on BLOCKED versus
              everything-else, so a request the worker had already started read as
              "waiting to be processed" and offered a Withdraw button the server always
              refuses — telling somebody their erasure had not begun when it had.
            */}
            <p className="lf-security__copy">
              {request.status === 'BLOCKED'
                ? 'Your request is recorded but cannot go ahead yet.'
                : request.status === 'IN_PROGRESS'
                  ? 'Your request is being processed now. It can no longer be withdrawn.'
                  : 'Your request is recorded and is queued for processing.'}
            </p>
            {request.status === 'BLOCKED' && request.blockedReason && (
              <p className="lf-security__note" data-bad role="status">
                {request.blockedReason}
              </p>
            )}
            <p className="lf-security__helper">
              Requested {new Date(request.requestedAt).toLocaleString('en-GB')}.{' '}
              {request.status === 'BLOCKED'
                ? 'Once that is resolved, withdraw this request and ask again to start straight away — otherwise it is re-checked automatically every few hours. If you cannot resolve it yourself, ask your workspace administrator or your usual support contact.'
                : request.status === 'IN_PROGRESS'
                  ? 'Processing has started, so this can no longer be withdrawn.'
                  : deletionExecutionEnabled
                    ? 'We aim to complete eligible requests within 24 hours. You can withdraw it until processing starts.'
                    : 'Account deletion processing is not yet switched on, so nothing has been deleted and no time has been scheduled. Your request stays recorded and you can withdraw it at any time.'}
            </p>
            {delNote && (
              <p className="lf-security__note" data-bad={delNote.bad} role="status">
                {delNote.text}
              </p>
            )}
            {request.status !== 'IN_PROGRESS' && (
              <button className="lf-btn lf-btn--secondary" type="button" onClick={cancelDeletion} disabled={delBusy}>
                {delBusy ? 'Withdrawing…' : 'Withdraw my request'}
              </button>
            )}
          </>
        ) : (
          <>
            {/*
              Said plainly, and before the form rather than after it. What goes is this
              person's identity; what stays belongs to the workspace and is not theirs to
              remove, and saying so here is the difference between an informed choice and
              a surprise.
            */}
            <p className="lf-security__copy">
              This deletes your sign-in, your password, your two-factor setup and your personal details, and removes you
              from every workspace you belong to.
            </p>
            <p className="lf-security__helper">
              Your face check-in data is deleted, and any API keys you created are revoked — integrations still using
              one will stop working.
            </p>
            {/*
              Named, not implied. The previous version said the work stays and left the
              reader to assume everything else goes; an employment record holding an IBAN
              and a scanned passport is not something to discover afterwards. These are the
              categories the executor counts and reports on the completed request.
            */}
            <p className="lf-security__helper">
              Some things are kept and are not removed by this request: the work you recorded — leads, calls, receipts
              and approvals — stays with the workspace, with your name against it so the records still make sense; the
              audit trail keeps your name; your employment record and any identity or visa documents held by HR stay,
              because payroll and settlement records depend on them; and encrypted backups still hold your account until
              they age out.
            </p>
            <p className="lf-security__helper">
              {deletionExecutionEnabled
                ? 'We aim to complete eligible requests within 24 hours, and you can withdraw yours until processing starts.'
                : 'Account deletion processing is not yet switched on: your request will be recorded and held, nothing will be deleted until it is, and you can withdraw it at any time.'}{' '}
              It cannot be undone once processed, and this does not close your organisation&rsquo;s workspace.
            </p>
            <form onSubmit={requestDeletion} className="lf-security__form">
              <label className="lf-label" htmlFor="del-password">
                Your password
              </label>
              <input
                id="del-password"
                className="lf-input"
                type="password"
                autoComplete="current-password"
                value={delPassword}
                onChange={(event) => setDelPassword(event.target.value)}
                required
              />
              {mfaEnabled && (
                <>
                  <label className="lf-label" htmlFor="del-code">
                    Authenticator code
                  </label>
                  <input
                    id="del-code"
                    className="lf-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={delCode}
                    onChange={(event) => setDelCode(event.target.value)}
                    required
                  />
                </>
              )}
              <label className="lf-label" htmlFor="del-reason">
                Reason (optional)
              </label>
              <input
                id="del-reason"
                className="lf-input"
                value={delReason}
                onChange={(event) => setDelReason(event.target.value)}
                maxLength={2000}
              />
              <label className="lf-label" htmlFor="del-confirm">
                Type DELETE to confirm
              </label>
              <input
                id="del-confirm"
                className="lf-input"
                value={delConfirm}
                onChange={(event) => setDelConfirm(event.target.value)}
                required
              />
              {delNote && (
                <p className="lf-security__note" data-bad={delNote.bad} role="status">
                  {delNote.text}
                </p>
              )}
              <button
                className="lf-btn"
                style={{ background: 'var(--lf-vermillion)' }}
                type="submit"
                disabled={delBusy || delConfirm !== 'DELETE'}
              >
                {delBusy ? 'Recording…' : 'Delete my account'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
