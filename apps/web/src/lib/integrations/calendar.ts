import { logger } from '../logger';

/**
 * Hard ceiling on one provider round-trip. A hung provider must fail the one
 * feature that needed it, not hold a connection (and on the request path, a
 * request) open indefinitely — graceful degradation starts with a deadline.
 */
const PROVIDER_TIMEOUT_MS = 30_000;

export interface CalendarEvent {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string;
  createMeetLink?: boolean;
}

export interface CalendarEventResult {
  externalCalendarId: string;
  externalMeetId?: string;
  meetingUrl?: string;
}

/**
 * Creates the event on the workspace's connected Google Calendar ('primary'),
 * with a Meet link when asked for one.
 *
 * Setup:
 *   1. Create a Google Cloud project with Calendar API enabled
 *   2. Create OAuth2 credentials (Web application type)
 *   3. Store refresh token in IntegrationConnection table
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  event: CalendarEvent,
): Promise<CalendarEventResult> {
  const body = {
    summary: event.title,
    description: event.description,
    start: { dateTime: event.startAt.toISOString(), timeZone: event.timezone },
    end: { dateTime: event.endAt.toISOString(), timeZone: event.timezone },
    location: event.location,
    conferenceData: event.createMeetLink
      ? { createRequest: { requestId: `lf_${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      : undefined,
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ provider: 'google', status: res.status, err }, 'Google Calendar API error');
    throw new Error(`Google Calendar API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    externalCalendarId: data.id,
    externalMeetId: data.conferenceData?.conferenceId,
    meetingUrl: data.hangoutLink ?? data.conferenceData?.entryPoints?.[0]?.uri,
  };
}
