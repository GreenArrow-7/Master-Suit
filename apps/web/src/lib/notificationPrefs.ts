/**
 * Per-person delivery choices (audit M17-11, M18-10), kept in the existing
 * `User.notificationPrefs` column. The bell always gets the row; these decide
 * the copies: a phone push (on unless turned off) and an email (off unless
 * turned on) — each notification as it happens, or, with `digest`, one summary
 * each morning instead (audit M8-04, M17-04; services/notifications/digest.ts).
 *
 * ponytail: one switch per channel, not per event — add per-event keys when
 * someone wants pushes for follow-ups but not for assignments.
 */
export interface NotificationPrefs {
  push: boolean;
  email: boolean;
  /** Email as one morning summary instead of one mail per notification; only with `email`. */
  digest: boolean;
}

export function readPrefs(raw: unknown): NotificationPrefs {
  const prefs = (raw ?? {}) as Partial<NotificationPrefs>;
  const email = prefs.email === true;
  return { push: prefs.push !== false, email, digest: email && prefs.digest === true };
}
