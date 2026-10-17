/**
 * Per-person delivery choices (audit M17-11, M18-10), kept in the existing
 * `User.notificationPrefs` column. The bell always gets the row; these decide
 * the copies: a phone push (on unless turned off) and an email (off unless
 * turned on).
 *
 * ponytail: one switch per channel, not per event — add per-event keys when
 * someone wants pushes for follow-ups but not for assignments.
 */
export interface NotificationPrefs {
  push: boolean;
  email: boolean;
}

export function readPrefs(raw: unknown): NotificationPrefs {
  const prefs = (raw ?? {}) as Partial<NotificationPrefs>;
  return { push: prefs.push !== false, email: prefs.email === true };
}
