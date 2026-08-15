'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Badge, { type Tone } from '@/components/ui/Badge';

/**
 * What the drawer needs, already formatted.
 *
 * Declared here rather than in the page so the client bundle never imports a
 * type from a module that also pulls in Prisma. Dates arrive as strings because
 * they are only ever displayed, and formatting them server-side keeps one
 * locale across the console.
 */
export interface PlatformUserView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  platformRole: string;
  mfaState: string;
  locked: boolean;
  lockedUntil: string | null;
  failedLoginCount: number;
  lastLoginAt: string;
  createdAt: string;
  emailVerified: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  canSignIn: { ok: boolean; reason: string };
  throttle: { used: number; max: number; throttled: boolean; resetsAt: string };
  memberships: {
    id: string;
    workspace: string;
    slug: string;
    workspaceStatus: string;
    status: string;
    roleKey: string | null;
    roleName: string;
    roleId: string | null;
    salesUserStatus: string | null;
    joinedAt: string | null;
    isPrimaryAdmin: boolean;
  }[];
  effectiveAccess: { module: string; scope: string; actions: string[] }[];
  roleOptions: { id: string; key: string; name: string; rank: number }[];
  events: { id: string; event: string; occurredAt: string; reason: string | null; byOperator: boolean }[];
}

type Action =
  | { action: 'reset-password'; password?: string; requireChange: boolean }
  | { action: 'unlock' }
  | { action: 'reset-mfa' }
  | { action: 'set-active'; active: boolean }
  | { action: 'set-platform-role'; platformRole: string }
  | { action: 'membership-status'; membershipId: string; status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' }
  | { action: 'membership-role'; membershipId: string; roleId: string };

const MFA_TONE: Record<string, Tone> = {
  ENABLED: 'viridian',
  ENROLMENT_PENDING: 'brass',
  ENROLMENT_REQUIRED: 'brass',
  RECOVERY_REQUIRED: 'brass',
  NOT_CONFIGURED: 'slate',
};

/**
 * One account's real authentication state, and the buttons that repair it.
 *
 * Two rules shape the whole panel:
 *
 *  - **The verdict comes first.** The sign-in form answers every credential
 *    failure with one deliberately vague message so nobody can enumerate
 *    accounts. That vagueness is owed to the public, not to the operator with a
 *    customer on the phone — so the banner at the top says plainly whether
 *    login would succeed today and, if not, which check refuses it.
 *  - **Destructive actions arm before they fire.** Each one replaces itself with
 *    a confirmation naming the account, rather than opening a dialog that can be
 *    dismissed by reflex.
 */
export default function UserDrawer({ user, back }: { user: PlatformUserView; back: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'ok' | 'bad'; message: string } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // Held in state, never in the URL and never re-fetchable: the server returns a
  // generated password exactly once, from the call that created it.
  const [issued, setIssued] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requireChange, setRequireChange] = useState(true);
  const closeRef = useRef<HTMLAnchorElement>(null);

  /**
   * Escape closes, and focus starts on the close control.
   *
   * A panel that declares `aria-modal` and then cannot be dismissed from the
   * keyboard is worse than one that never claimed to be a dialog — the
   * announcement promises a behaviour the keyboard user does not get.
   */
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(back);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, back]);

  async function send(body: Action, success: string) {
    setBusy(body.action);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/platform/users/${user.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ tone: 'bad', message: data.detail ?? data.title ?? 'That did not work.' });
        return;
      }
      if (data.temporaryPassword) setIssued(data.temporaryPassword);
      setArmed(null);
      setPassword('');
      setConfirmPassword('');
      setToast({ tone: 'ok', message: success });
      router.refresh();
    } catch {
      setToast({ tone: 'bad', message: 'Could not reach the server.' });
    } finally {
      setBusy(null);
    }
  }

  const primary = user.memberships[0];

  return (
    <div className="lf-drawer" role="dialog" aria-modal="true" aria-label={`Account ${user.email}`}>
      <Link className="lf-drawer__scrim" href={back} aria-label="Close" />
      <div className="lf-drawer__panel">
        <header className="lf-drawer__head">
          <div>
            <h2>{user.fullName}</h2>
            <p>{user.email}</p>
          </div>
          <Link className="lf-drawer__close" href={back} aria-label="Close" ref={closeRef}>
            ×
          </Link>
        </header>

        <div className="lf-drawer__body">
          <div className="lf-alert" data-tone={user.canSignIn.ok ? 'viridian' : 'brass'} role="status">
            <strong>{user.canSignIn.ok ? 'Sign-in permitted' : 'Sign-in refused'}</strong>
            <span style={{ display: 'block', marginTop: 2 }}>{user.canSignIn.reason}</span>
            {user.throttle.throttled && (
              <span style={{ display: 'block', marginTop: 6 }}>
                Separately, the per-account sign-in throttle is closed ({user.throttle.used}/{user.throttle.max} attempts
                in this window, resets {user.throttle.resetsAt}). Unlocking clears it.
              </span>
            )}
          </div>

          {toast && (
            <div className="lf-toast" role="status">
              {toast.tone === 'ok' ? '✓' : '!'} {toast.message}
            </div>
          )}

          {issued && (
            <section>
              <h3 className="lf-section-title">Temporary password — shown once</h3>
              <p className="lf-secret">{issued}</p>
              <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-xs)' }}>
                Read it out in person or by phone — not by email or chat. It is not stored in readable form and cannot
                be shown again. {user.mustChangePassword ? 'The user must set their own before anything else opens.' : ''}
              </p>
            </section>
          )}

          <section>
            <h3 className="lf-section-title">Authentication state</h3>
            <dl className="lf-facts">
              <div>
                <dt>Account status</dt>
                <dd>{user.status}</dd>
              </div>
              <div>
                <dt>Platform role</dt>
                <dd>{user.platformRole.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{primary ? primary.workspace : 'None'}</dd>
              </div>
              <div>
                <dt>Workspace role</dt>
                <dd>{primary?.roleName ?? '—'}</dd>
              </div>
              <div>
                <dt>Authentication</dt>
                <dd>{user.hasPassword ? 'Password' : 'No password set'}</dd>
              </div>
              <div>
                <dt>MFA</dt>
                <dd>
                  <Badge tone={MFA_TONE[user.mfaState] ?? 'slate'}>{user.mfaState.replaceAll('_', ' ').toLowerCase()}</Badge>
                </dd>
              </div>
              <div>
                <dt>Account lock</dt>
                <dd>{user.locked ? `Locked until ${user.lockedUntil}` : 'Unlocked'}</dd>
              </div>
              <div>
                <dt>Failed attempts</dt>
                <dd>{user.failedLoginCount}</dd>
              </div>
              <div>
                <dt>Sign-in throttle</dt>
                <dd>
                  {user.throttle.used}/{user.throttle.max} this window
                </dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>{user.mustChangePassword ? 'Temporary — must change' : `Set ${user.passwordChangedAt ?? '—'}`}</dd>
              </div>
              <div>
                <dt>Last login</dt>
                <dd>{user.lastLoginAt}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{user.createdAt}</dd>
              </div>
            </dl>
          </section>

          {/* ── Password ────────────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">Reset password</h3>
            <div className="lf-actionbox">
              <label className="lf-field" style={{ margin: 0 }}>
                <span className="lf-label">New password</span>
                <input
                  className="lf-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Leave blank to generate one"
                />
              </label>
              <label className="lf-field" style={{ margin: 0 }}>
                <span className="lf-label">Confirm new password</span>
                <input
                  className="lf-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Leave blank to generate one"
                />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: 'var(--lf-text-sm)' }}>
                <input
                  type="checkbox"
                  checked={requireChange}
                  onChange={(event) => setRequireChange(event.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  Require a password change at next login.
                  <span style={{ display: 'block', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                    Right for a real customer. Clear it for a demo workspace where the published password must keep
                    working.
                  </span>
                </span>
              </label>

              {armed === 'reset-password' ? (
                <div className="lf-actionrow">
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-2)', flexBasis: '100%' }}>
                    Reset the password for <strong>{user.email}</strong>? Every active session for this account ends
                    immediately.
                  </span>
                  <button
                    type="button"
                    className="lf-btn"
                    disabled={busy !== null}
                    onClick={() =>
                      void send(
                        { action: 'reset-password', password: password || undefined, requireChange },
                        'Password reset successfully.',
                      )
                    }
                  >
                    {busy === 'reset-password' ? 'Resetting…' : 'Reset password'}
                  </button>
                  <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setArmed(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="lf-actionrow">
                  <button
                    type="button"
                    className="lf-btn"
                    disabled={Boolean(password) && password !== confirmPassword}
                    onClick={() => setArmed('reset-password')}
                  >
                    {password ? 'Reset password' : 'Generate temporary password'}
                  </button>
                  {Boolean(password) && password !== confirmPassword && (
                    <span className="lf-hint lf-hint--error">Both fields must match.</span>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── Lock ────────────────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">{user.locked ? 'Account locked' : 'Failed sign-in attempts'}</h3>
            <div className="lf-actionbox">
              <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                {user.locked
                  ? `Locked until ${user.lockedUntil} after ${user.failedLoginCount} failed attempts.`
                  : `${user.failedLoginCount} failed attempts on record; the account is not locked.`}{' '}
                Clearing resets this account&rsquo;s lock, its failed counter and its per-account sign-in throttle.
                Platform-wide and per-IP brute-force limits are unaffected.
              </span>
              <div className="lf-actionrow">
                <button
                  type="button"
                  className="lf-btn"
                  disabled={busy !== null || (!user.locked && user.failedLoginCount === 0 && !user.throttle.throttled)}
                  onClick={() => void send({ action: 'unlock' }, 'Account unlocked.')}
                >
                  {busy === 'unlock' ? 'Working…' : user.locked ? 'Unlock account' : 'Clear failed attempts'}
                </button>
              </div>
            </div>
          </section>

          {/* ── MFA ─────────────────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">Two-factor authentication</h3>
            <div className="lf-actionbox" data-danger={armed === 'reset-mfa'}>
              <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                Resetting invalidates the current authenticator secret and every recovery code. It does not switch
                security off: the next successful password sign-in starts enrolment again.
              </span>
              {armed === 'reset-mfa' ? (
                <div className="lf-actionrow">
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink)', flexBasis: '100%' }}>
                    <strong>Reset MFA for {user.email}?</strong> Their authenticator stops working immediately, every
                    recovery code is destroyed, and every session ends. They cannot sign in again until they enrol a new
                    authenticator.
                  </span>
                  <button
                    type="button"
                    className="lf-btn lf-btn--danger"
                    disabled={busy !== null}
                    onClick={() => void send({ action: 'reset-mfa' }, 'MFA reset. Enrolment starts at next sign-in.')}
                  >
                    {busy === 'reset-mfa' ? 'Resetting…' : 'Yes, reset MFA'}
                  </button>
                  <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setArmed(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="lf-actionrow">
                  <button
                    type="button"
                    className="lf-btn lf-btn--danger"
                    disabled={user.mfaState === 'NOT_CONFIGURED' || user.mfaState === 'ENROLMENT_REQUIRED'}
                    onClick={() => setArmed('reset-mfa')}
                  >
                    Reset MFA
                  </button>
                  {(user.mfaState === 'NOT_CONFIGURED' || user.mfaState === 'ENROLMENT_REQUIRED') && (
                    <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                      Nothing to reset — no authenticator is enrolled.
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── Account standing ────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">Account standing</h3>
            <div className="lf-actionbox">
              <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                A deactivated account cannot authenticate. Records it owns, and its name on past activity, are kept.
              </span>
              <div className="lf-actionrow">
                {user.status === 'ACTIVE' ? (
                  armed === 'deactivate' ? (
                    <>
                      <span style={{ fontSize: 'var(--lf-text-xs)', flexBasis: '100%' }}>
                        Deactivate <strong>{user.email}</strong>? Sessions end immediately.
                      </span>
                      <button
                        type="button"
                        className="lf-btn lf-btn--danger"
                        disabled={busy !== null}
                        onClick={() => void send({ action: 'set-active', active: false }, 'User deactivated.')}
                      >
                        {busy === 'set-active' ? 'Working…' : 'Yes, deactivate'}
                      </button>
                      <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setArmed(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="lf-btn lf-btn--danger" onClick={() => setArmed('deactivate')}>
                      Deactivate user
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="lf-btn"
                    disabled={busy !== null}
                    onClick={() => void send({ action: 'set-active', active: true }, 'User reactivated.')}
                  >
                    {busy === 'set-active' ? 'Working…' : 'Reactivate user'}
                  </button>
                )}
              </div>

              <label className="lf-field" style={{ margin: 0 }}>
                <span className="lf-label">Platform role</span>
                <select
                  className="lf-input"
                  value={user.platformRole}
                  disabled={busy !== null}
                  onChange={(event) =>
                    void send(
                      { action: 'set-platform-role', platformRole: event.target.value },
                      'Platform role changed.',
                    )
                  }
                >
                  {['USER', 'OWNER', 'SUPPORT', 'SECURITY_AUDITOR'].map((role) => (
                    <option key={role} value={role}>
                      {role.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <span className="lf-hint">
                  Who may use this console. Separate from the workspace role below, which decides what they may do
                  inside a customer&rsquo;s workspace.
                </span>
              </label>
            </div>
          </section>

          {/* ── Memberships ─────────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">Workspace membership</h3>
            {user.memberships.length === 0 ? (
              <div className="lf-actionbox">
                <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                  No workspace membership. An ordinary user with none cannot sign in at all — invite them to a workspace
                  from <Link href="/platform/workspaces">Workspaces</Link>.
                </span>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
                {user.memberships.map((membership) => (
                  <div key={membership.id} className="lf-actionbox">
                    <div className="lf-actionrow" style={{ justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 'var(--lf-text-base)' }}>{membership.workspace}</strong>
                      <Badge tone={membership.status === 'ACTIVE' ? 'viridian' : 'brass'}>
                        {membership.status.toLowerCase()}
                      </Badge>
                    </div>
                    <dl className="lf-facts">
                      <div>
                        <dt>Role</dt>
                        <dd>{membership.roleName}</dd>
                      </div>
                      <div>
                        <dt>Workspace user</dt>
                        <dd>{membership.salesUserStatus ?? 'Missing — login will refuse this workspace'}</dd>
                      </div>
                      <div>
                        <dt>Workspace status</dt>
                        <dd>{membership.workspaceStatus}</dd>
                      </div>
                      <div>
                        <dt>Joined</dt>
                        <dd>{membership.joinedAt ?? '—'}</dd>
                      </div>
                    </dl>

                    {user.roleOptions.length > 0 && membership.roleId && (
                      <label className="lf-field" style={{ margin: 0 }}>
                        <span className="lf-label">Change workspace role</span>
                        <select
                          className="lf-input"
                          value={membership.roleId}
                          disabled={busy !== null}
                          onChange={(event) =>
                            void send(
                              { action: 'membership-role', membershipId: membership.id, roleId: event.target.value },
                              'Workspace role changed.',
                            )
                          }
                        >
                          {user.roleOptions.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div className="lf-actionrow">
                      {membership.status !== 'ACTIVE' ? (
                        <button
                          type="button"
                          className="lf-btn"
                          disabled={busy !== null}
                          onClick={() =>
                            void send(
                              { action: 'membership-status', membershipId: membership.id, status: 'ACTIVE' },
                              'Membership activated.',
                            )
                          }
                        >
                          Activate membership
                        </button>
                      ) : armed === `suspend-${membership.id}` ? (
                        <>
                          <span style={{ fontSize: 'var(--lf-text-xs)', flexBasis: '100%' }}>
                            Suspend access to <strong>{membership.workspace}</strong>? Their records stay; they cannot
                            sign into it.
                          </span>
                          <button
                            type="button"
                            className="lf-btn lf-btn--danger"
                            disabled={busy !== null}
                            onClick={() =>
                              void send(
                                { action: 'membership-status', membershipId: membership.id, status: 'SUSPENDED' },
                                'Membership suspended.',
                              )
                            }
                          >
                            Yes, suspend
                          </button>
                          <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setArmed(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="lf-btn lf-btn--secondary"
                          onClick={() => setArmed(`suspend-${membership.id}`)}
                        >
                          Suspend membership
                        </button>
                      )}

                      {armed === `remove-${membership.id}` ? (
                        <>
                          <span style={{ fontSize: 'var(--lf-text-xs)', flexBasis: '100%' }}>
                            <strong>Remove {user.email} from {membership.workspace}?</strong> Their access ends. Leads,
                            deals and activity they own stay in the workspace under their name — nothing is deleted —
                            but restoring access means re-adding the membership.
                          </span>
                          <button
                            type="button"
                            className="lf-btn lf-btn--danger"
                            disabled={busy !== null}
                            onClick={() =>
                              void send(
                                { action: 'membership-status', membershipId: membership.id, status: 'REMOVED' },
                                'Membership removed.',
                              )
                            }
                          >
                            Yes, remove
                          </button>
                          <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setArmed(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        membership.status !== 'REMOVED' && (
                          <button
                            type="button"
                            className="lf-btn lf-btn--ghost"
                            onClick={() => setArmed(`remove-${membership.id}`)}
                          >
                            Remove
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Effective access ────────────────────────────────────────── */}
          {user.effectiveAccess.length > 0 && (
            <section>
              <h3 className="lf-section-title">Effective access</h3>
              <p style={{ margin: '0 0 8px', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                Read from the workspace role&rsquo;s own permission rows — the same table the server checks on every
                request.
              </p>
              <dl className="lf-facts">
                {user.effectiveAccess.map((entry) => (
                  <div key={entry.module}>
                    <dt>{entry.module.replaceAll('_', ' ')}</dt>
                    <dd>{entry.scope.replaceAll('_', ' ').toLowerCase()}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* ── Activity ────────────────────────────────────────────────── */}
          <section>
            <h3 className="lf-section-title">Recent account events</h3>
            {user.events.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>Nothing recorded yet.</p>
            ) : (
              <ul className="lf-eventlist">
                {user.events.map((event) => (
                  <li key={event.id}>
                    <span>
                      {event.event.replaceAll('_', ' ').toLowerCase()}
                      {event.reason ? ` — ${event.reason.replaceAll('_', ' ').toLowerCase()}` : ''}
                      {event.byOperator && (
                        <span style={{ color: 'var(--lf-ink-3)' }}> · by an operator</span>
                      )}
                    </span>
                    <time>{event.occurredAt}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
