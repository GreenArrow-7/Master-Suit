/**
 * The workspace's Google Calendar (M8-08): connecting it, and writing a
 * record's event under an id derived from the record. What a record wants on
 * the calendar, when it is synced and how a failure is retried are the same for
 * every provider (calendarSync.ts).
 *
 * One calendar per workspace, as the Google Workspace connection always was
 * (`IntegrationConnection` per tenant and provider): events go on the calendar
 * it names (`calendarId`, default the connected account's primary).
 */
import { createHash, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';
import { redis } from '@/lib/redis';
import { deleteGoogleCalendarEvent, putGoogleCalendarEvent, type CalendarEvent } from '@/lib/integrations/calendar';
import type { OAuthState } from '@/services/meta/oauth';
import type { CalendarRecord } from './calendarSync';

// ── Connecting ───────────────────────────────────────────────────────────────

/** Events on calendars the account can reach; nothing else of theirs. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'] as const;

const STATE_PREFIX = 'google:oauth:';
const STATE_TTL_SECONDS = 600;

/** One fixed URL: Google matches it exactly against the OAuth client's list. */
export const googleRedirectUri = () => `${env.APP_URL.replace(/\/$/, '')}/api/v1/integrations/google/callback`;

/**
 * Where to send the browser. `state` is a random handle to the flow kept in
 * Redis (single use, ten minutes), as in services/meta/oauth.ts: the URL
 * carries neither the workspace nor the person.
 */
export async function beginGoogleOAuth(state: OAuthState): Promise<string> {
  const handle = randomBytes(32).toString('base64url');
  await redis.set(`${STATE_PREFIX}${handle}`, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // A refresh token, every time: without one the calendar stops after an hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: handle,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function consumeGoogleOAuthState(handle: string): Promise<OAuthState | null> {
  if (!handle || handle.length > 200) return null;
  const raw = await redis.getdel(`${STATE_PREFIX}${handle}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthState;
  } catch {
    return null;
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * The event's id, ours rather than Google's: hex (inside Google's base32hex),
 * the same for the record every time. A sync needs nothing stored to find the
 * event again, and a record deleted outright can still take its event with it.
 */
export const calendarEventId = (tenantId: string, kind: CalendarRecord, id: string) =>
  createHash('sha256').update(`${tenantId}:${kind}:${id}`).digest('hex');

/** Every calendar the workspace's events were written to: a changed `calendarId` leaves events on the old one. */
const writtenTo = (tenantId: string) => `google:calendar:written:${tenantId}`;

/** The record's event as it should stand (`entry`), or removed (null), on the connection's calendar. */
export async function writeGoogleEvent(
  token: string,
  { tenantId, kind, id }: { tenantId: string; kind: CalendarRecord; id: string },
  entry: CalendarEvent | null,
  settings: Record<string, unknown>,
) {
  const calendarId =
    typeof settings.calendarId === 'string' && settings.calendarId.trim() ? settings.calendarId.trim() : 'primary';
  const eventId = calendarEventId(tenantId, kind, id);
  // The calendars written to before `calendarId` changed: the event may still be on one of them.
  const earlier = (await redis.smembers(writtenTo(tenantId))).filter((c) => c !== calendarId);
  if (entry) await putGoogleCalendarEvent(token, calendarId, eventId, entry, earlier);
  else {
    await deleteGoogleCalendarEvent(token, calendarId, eventId);
    // Best effort: a calendar this account can no longer reach must not wedge the sync.
    for (const old of earlier) await deleteGoogleCalendarEvent(token, old, eventId).catch(() => undefined);
  }
  await redis.sadd(writtenTo(tenantId), calendarId);
}
