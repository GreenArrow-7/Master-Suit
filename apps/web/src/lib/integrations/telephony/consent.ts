/**
 * One definition of "this consent row may authorise processing real call audio".
 *
 * `consentGiven && !withdrawnAt` was not enough. The demo simulation upserts a
 * consent row onto the **real** `Call` record it is pretending to place
 * (`api/v1/calls/[id]/live/route.ts`), so pressing "Start simulated call" on a
 * real lead left consent on file, and the next "Place call with AI assistance"
 * skipped its confirmation and asked the provider to fork the conversation.
 *
 * The demo row identifies itself in `consentedBy`, so a predicate keyed on that
 * sentinel also neutralises every demo row already in every database — no
 * migration, no backfill, no deploy ordering. That is why the sentinel is
 * exported and the demo writer uses this constant rather than its own literal.
 *
 * A person recording consent through POST /calls/:id/consent overwrites
 * `consentedBy` with their own actor id, and the call becomes streamable: the
 * guard is an upgrade path, not a dead end.
 *
 * Deliberately NOT routed through here:
 *   - reading an existing recording or transcript (`recording/`, `transcript/`,
 *     `recording/media/`) — those rows are already written and their own gates
 *     are unchanged; this is about authorising *new* processing.
 *   - `callIntelligence.consented()` — it gates post-call analysis and audit,
 *     including for the demo simulation, which is the one live-coaching path
 *     that runs today and is meant to stay reviewable.
 */

/** What the demo simulation writes into `consentedBy`. */
export const DEMO_CONSENT_BY = 'Demo simulation — verbal consent assumed at session start';

/** The prefix that marks a row as written by the demo path rather than a person. */
const DEMO_CONSENT_PREFIX = 'Demo simulation';

export type ConsentRow = {
  consentGiven: boolean;
  withdrawnAt: Date | null;
  consentedBy: string | null;
} | null;

/** A consent row written by the demo simulation rather than by a person. */
export function isDemoConsent(consent: ConsentRow): boolean {
  return Boolean(consent?.consentedBy?.startsWith(DEMO_CONSENT_PREFIX));
}

/**
 * Whether this row authorises processing the call's real audio: the provider
 * fork, the device microphone, keeping provider media, and the dial that asks
 * for the fork.
 */
export function consentAuthorisesLiveAudio(consent: ConsentRow): boolean {
  return Boolean(consent?.consentGiven) && !consent?.withdrawnAt && !isDemoConsent(consent);
}
