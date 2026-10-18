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

/** Google's status and its own message, logged and thrown; never the request, which holds the token. */
async function failure(res: Response): Promise<Error> {
  const err = await res.text().catch(() => '');
  logger.error({ provider: 'google', status: res.status, err }, 'Google Calendar API error');
  let message = '';
  try {
    message = JSON.parse(err)?.error?.message ?? '';
  } catch {
    // Not JSON: the status says enough.
  }
  return new Error(`Google Calendar API error: ${res.status}${message ? ` ${message}` : ''}`.slice(0, 240));
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
 */
export async function putGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: CalendarEvent,
): Promise<void> {
  const events = `${CALENDARS}/${encodeURIComponent(calendarId)}/events`;
  const body = { ...eventBody(event), id: eventId, status: 'confirmed' };
  let res = await call(accessToken, 'PUT', `${events}/${eventId}?sendUpdates=none`, body);
  if (res.status === 404) res = await call(accessToken, 'POST', `${events}?sendUpdates=none`, body);
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

export interface GoogleTokens {
  accessToken: string;
  /** Only on the first consent (`access_type=offline`, `prompt=consent`). */
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

/** Google's token endpoint: the consent screen's code, or a refresh token, for an access token. */
export async function googleToken(
  grant: { code: string; redirectUri: string } | { refreshToken: string },
): Promise<GoogleTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      ...('code' in grant
        ? { grant_type: 'authorization_code', code: grant.code, redirect_uri: grant.redirectUri }
        : { grant_type: 'refresh_token', refresh_token: grant.refreshToken }),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    // Google's own words ("Token has been expired or revoked.") tell an administrator to reconnect.
    throw new Error(`Google refused the token: ${String(data.error_description ?? data.error ?? res.status)}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
    scopes: typeof data.scope === 'string' ? data.scope.split(' ') : [],
  };
}
