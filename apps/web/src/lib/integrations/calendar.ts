import { env } from '../env';
import { logger } from '../logger';

/**
 * Hard ceiling on one provider round-trip. A hung provider must fail the one
 * feature that needed it, not hold a connection (and on the request path, a
 * request) open indefinitely — graceful degradation starts with a deadline.
 */
const PROVIDER_TIMEOUT_MS = 30_000;

const CALENDARS = 'https://www.googleapis.com/calendar/v3/calendars';

export interface CalendarEvent {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string;
  createMeetLink?: boolean;
  /** Guests, by email: the CRM record's owner, so it is on their own calendar too. */
  attendees?: string[];
}

export interface CalendarEventResult {
  externalCalendarId: string;
  externalMeetId?: string;
  meetingUrl?: string;
}

function eventBody(event: CalendarEvent) {
  return {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.startAt.toISOString(), timeZone: event.timezone },
    end: { dateTime: event.endAt.toISOString(), timeZone: event.timezone },
    location: event.location,
    attendees: event.attendees?.map((email) => ({ email })),
    conferenceData: event.createMeetLink
      ? { createRequest: { requestId: `lf_${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      : undefined,
  };
}

const call = (accessToken: string, method: string, url: string, body?: unknown) =>
  fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

/**
 * The vendor's status and its own message, logged and thrown; never the request,
 * which holds the token. Google and Microsoft Graph both answer `{ error: { message } }`.
 */
async function failure(res: Response, api = 'Google Calendar API'): Promise<Error> {
  const err = await res.text().catch(() => '');
  logger.error({ api, status: res.status, err }, `${api} error`);
  let message = '';
  try {
    message = JSON.parse(err)?.error?.message ?? '';
  } catch {
    // Not JSON: the status says enough.
  }
  return new Error(`${api} error: ${res.status}${message ? ` ${message}` : ''}`.slice(0, 240));
}

/**
 * Creates the event on the workspace's connected Google Calendar ('primary'),
 * with a Meet link when asked for one.
 *
 * Setup: a Google Cloud OAuth client with the Calendar API enabled, its id and
 * secret in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and the workspace
 * connected from Integrations → Google Workspace (services/integrations/googleCalendar.ts).
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  event: CalendarEvent,
): Promise<CalendarEventResult> {
  const res = await call(accessToken, 'POST', `${CALENDARS}/primary/events?conferenceDataVersion=1`, eventBody(event));
  if (!res.ok) throw await failure(res);

  const data = await res.json();
  return {
    externalCalendarId: data.id,
    externalMeetId: data.conferenceData?.conferenceId,
    meetingUrl: data.hangoutLink ?? data.conferenceData?.entryPoints?.[0]?.uri,
  };
}

/**
 * Writes the event under an id we chose (base32hex, 5–1024 characters): replaced
 * where it already is, inserted where it is not, so a retried or repeated sync
 * converges on one event. No email goes to the guests (`sendUpdates=none`).
 *
 * Not yet on `calendarId`, it may be on a calendar the workspace used before
 * (`earlier`): taken off there first, so a changed calendar never leaves a copy
 * at the old time.
 */
export async function putGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: CalendarEvent,
  earlier: string[] = [],
): Promise<void> {
  const events = `${CALENDARS}/${encodeURIComponent(calendarId)}/events`;
  const body = { ...eventBody(event), id: eventId, status: 'confirmed' };
  let res = await call(accessToken, 'PUT', `${events}/${eventId}?sendUpdates=none`, body);
  if (res.status === 404) {
    // Best effort: a calendar this account can no longer reach must not wedge the sync.
    for (const old of earlier) await deleteGoogleCalendarEvent(accessToken, old, eventId).catch(() => undefined);
    res = await call(accessToken, 'POST', `${events}?sendUpdates=none`, body);
  }
  if (!res.ok) throw await failure(res);
}

/** Removes the event; one already gone (410) or never written (404) is what was asked for. */
export async function deleteGoogleCalendarEvent(accessToken: string, calendarId: string, eventId: string) {
  const res = await call(
    accessToken,
    'DELETE',
    `${CALENDARS}/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=none`,
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) throw await failure(res);
}

/** The deployment's Google OAuth client: without it nobody can connect, and no token is refreshed. */
export const googleOAuthConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export interface OAuthTokens {
  accessToken: string;
  /** Google: only on the first consent (`access_type=offline`, `prompt=consent`). Microsoft: a new one every time. */
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

type TokenGrant = { code: string; redirectUri: string; verifier?: string } | { refreshToken: string };

/** An OAuth token endpoint: the consent screen's code, or a refresh token, for an access token. */
async function tokenRequest(
  url: string,
  vendor: string,
  client: Record<string, string>,
  grant: TokenGrant,
): Promise<OAuthTokens> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...client,
      ...('code' in grant
        ? {
            grant_type: 'authorization_code',
            code: grant.code,
            redirect_uri: grant.redirectUri,
            ...(grant.verifier && { code_verifier: grant.verifier }),
          }
        : { grant_type: 'refresh_token', refresh_token: grant.refreshToken }),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    // The vendor's own words ("Token has been expired or revoked.") tell an administrator to reconnect;
    // Microsoft's run on with trace and correlation ids, and the first line says it.
    const why = String(data.error_description ?? data.error ?? res.status).split(/\r?\n| Trace ID/)[0];
    throw new Error(`${vendor} refused the token: ${why}`.slice(0, 300));
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
    scopes: typeof data.scope === 'string' ? data.scope.split(' ') : [],
  };
}

/** Google's token endpoint. */
export const googleToken = (grant: TokenGrant) =>
  tokenRequest(
    'https://oauth2.googleapis.com/token',
    'Google',
    { client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '' },
    grant,
  );

// ── Microsoft 365 (M8-09) ────────────────────────────────────────────────────

/** Events on the connected account's calendars, a refresh token, and who signed in. */
export const MICROSOFT_SCOPES = ['offline_access', 'Calendars.ReadWrite', 'User.Read'] as const;

/** `common`: a work or school account, or a personal Outlook.com one. */
export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

/** The deployment's Microsoft app registration: without it nobody can connect, and no token is refreshed. */
export const microsoftOAuthConfigured = () => Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);

/** Microsoft's token endpoint. Every refresh hands back a new refresh token, kept in place of the old. */
export const microsoftToken = (grant: TokenGrant) =>
  tokenRequest(
    `${MICROSOFT_LOGIN}/token`,
    'Microsoft',
    {
      client_id: env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: env.MICROSOFT_CLIENT_SECRET ?? '',
      scope: MICROSOFT_SCOPES.join(' '),
    },
    grant,
  );

export const GRAPH_EVENTS = 'https://graph.microsoft.com/v1.0/me/events';
const GRAPH = 'Microsoft Graph';

/** Graph's dateTimeTimeZone: a wall-clock time and its zone. UTC, so no zone name needs translating. */
const graphTime = (at: Date) => ({ dateTime: at.toISOString().replace(/Z$/, ''), timeZone: 'UTC' });

/**
 * The event as Graph takes it. Every field goes on an update too (a PATCH
 * changes only what it names), so a place or a guest taken off comes off.
 * Graph has no `sendUpdates=none`: Exchange sends the guest its invitation and
 * each update, which is how the meeting reaches their own calendar.
 */
export function graphEventBody(event: CalendarEvent) {
  return {
    subject: event.title,
    body: { contentType: 'text', content: event.description ?? '' },
    start: graphTime(event.startAt),
    end: graphTime(event.endAt),
    location: { displayName: event.location ?? '' },
    attendees: (event.attendees ?? []).map((address) => ({ emailAddress: { address }, type: 'required' })),
  };
}

/**
 * Creates the event on the connected account's default calendar and returns
 * Graph's id for it: Graph chooses event ids, so ours are kept in
 * CalendarEventLink. `transactionId` makes a retried create (the first one's
 * answer lost) return the event that one made instead of a second.
 */
export async function createGraphEvent(accessToken: string, event: CalendarEvent, transactionId: string) {
  const res = await call(accessToken, 'POST', GRAPH_EVENTS, { ...graphEventBody(event), transactionId });
  if (!res.ok) throw await failure(res, GRAPH);
  const data = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (typeof data.id !== 'string' || !data.id) throw new Error(`${GRAPH} error: the new event came back without an id`);
  return data.id;
}

/** Moves or rewrites the event; false when it is gone (deleted in Outlook), for the caller to create it again. */
export async function updateGraphEvent(accessToken: string, eventId: string, event: CalendarEvent) {
  const res = await call(accessToken, 'PATCH', `${GRAPH_EVENTS}/${encodeURIComponent(eventId)}`, graphEventBody(event));
  if (res.status === 404) return false;
  if (!res.ok) throw await failure(res, GRAPH);
  return true;
}

/** Removes the event; one already gone (404) is what was asked for. */
export async function deleteGraphEvent(accessToken: string, eventId: string) {
  const res = await call(accessToken, 'DELETE', `${GRAPH_EVENTS}/${encodeURIComponent(eventId)}`);
  if (!res.ok && res.status !== 404) throw await failure(res, GRAPH);
}
