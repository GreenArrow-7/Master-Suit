import type { CallOutcome } from '@prisma/client';

/**
 * The one-step call log (PROP-02.2, M4-27): what a call found, as the dialog
 * offers it and the API accepts it. Stored as written on the call's Activity,
 * so the timeline reads it as it reads a call logged by hand.
 */
export const CALL_LOG_OUTCOMES = [
  'Connected',
  'Interested',
  'Not interested',
  'Call back later',
  'No answer',
  'Busy',
  'Switched off',
  'Wrong number',
] as const;

/** The dialog's outcome as a provider call's own, when the log is of that call (M9-02). */
export const CALL_OUTCOME_OF: Record<(typeof CALL_LOG_OUTCOMES)[number], CallOutcome> = {
  Connected: 'CONNECTED',
  Interested: 'INTERESTED',
  'Not interested': 'NOT_INTERESTED',
  'Call back later': 'CALLBACK_REQUESTED',
  'No answer': 'NO_ANSWER',
  Busy: 'BUSY',
  'Switched off': 'NO_ANSWER',
  'Wrong number': 'WRONG_NUMBER',
};

/** A call that reached someone, as the Calls list's Connected tab reads a call's outcome. */
export const CONNECTED_CALL_OUTCOMES: readonly CallOutcome[] = [
  'CONNECTED',
  'CALLBACK_REQUESTED',
  'INTERESTED',
  'QUALIFIED',
  'CONVERTED',
];

/** The same, in this dialog's words: a logged call's outcome. */
export const CONNECTED_LOG_OUTCOMES: readonly string[] = ['Connected', 'Interested', 'Call back later'];

/** The follow-up the dialog books: what the Follow-ups list shows for it. */
export const FOLLOW_UP_TITLE = 'Follow-up call';

/**
 * What a follow-up is for (`FollowUpTask.kind`, M3-04): a call unless it was
 * booked as something else. The Lead Eagle board's Callbacks are the calls.
 */
export const FOLLOW_UP_KINDS = ['CALL', 'MEETING', 'SITE_VISIT', 'OTHER'] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export const FOLLOW_UP_KIND_LABELS: Record<FollowUpKind, string> = {
  CALL: 'Call',
  MEETING: 'Meeting',
  SITE_VISIT: 'Site visit',
  OTHER: 'Other',
};

/** "YYYY-MM-DDT10:00" for tomorrow on the workspace's clock: the dialog's default follow-up. */
export function tomorrowAtTen(timeZone: string, now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  return `${new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10)}T10:00`;
}

/**
 * The other party's number on a call: who rang in on an inbound call, not the
 * workspace's line it reached. The Calls list, the call's own page and a
 * seller's day all show and dial it through here.
 */
export const callNumber = (call: {
  direction?: string | null;
  callerNumber?: string | null;
  recipientNumber?: string | null;
}) => (call.direction === 'INBOUND' ? call.callerNumber : call.recipientNumber) ?? null;
