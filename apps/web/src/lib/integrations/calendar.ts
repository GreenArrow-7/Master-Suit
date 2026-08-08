import { logger } from '../logger';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar provider abstraction
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string;
  attendees?: { email: string; name?: string }[];
  createMeetLink?: boolean;
}

export interface CalendarEventResult {
  externalCalendarId: string;
  externalMeetId?: string;
  meetingUrl?: string;
  htmlLink?: string;
}

export interface CalendarProvider {
  name: string;
  createEvent(event: CalendarEvent): Promise<CalendarEventResult>;
  updateEvent(externalId: string, event: Partial<CalendarEvent>): Promise<CalendarEventResult>;
  cancelEvent(externalId: string): Promise<void>;
  getEvent(externalId: string): Promise<CalendarEventResult | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider for development
// ─────────────────────────────────────────────────────────────────────────────

export class MockCalendarProvider implements CalendarProvider {
  name = 'mock';

  async createEvent(event: CalendarEvent): Promise<CalendarEventResult> {
    const id = `mock_cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const meetId = event.createMeetLink ? `mock_meet_${id}` : undefined;
    logger.info({ provider: 'mock', action: 'createEvent', title: event.title }, 'calendar mock');
    return {
      externalCalendarId: id,
      externalMeetId: meetId,
      meetingUrl: meetId ? `https://meet.example.com/${meetId}` : undefined,
      htmlLink: `https://calendar.example.com/event/${id}`,
    };
  }

  async updateEvent(externalId: string, _event: Partial<CalendarEvent>): Promise<CalendarEventResult> {
    logger.info({ provider: 'mock', action: 'updateEvent', externalId }, 'calendar mock');
    return { externalCalendarId: externalId };
  }

  async cancelEvent(externalId: string): Promise<void> {
    logger.info({ provider: 'mock', action: 'cancelEvent', externalId }, 'calendar mock');
  }

  async getEvent(externalId: string): Promise<CalendarEventResult | null> {
    return { externalCalendarId: externalId };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar provider (requires credentials)
//
// Setup:
//   1. Create a Google Cloud project with Calendar API enabled
//   2. Create OAuth2 credentials (Web application type)
//   3. Store refresh token in IntegrationConnection table
//   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
//
// This provider is a skeleton. It documents the exact Google API calls needed
// but will throw until real credentials are configured.
// ─────────────────────────────────────────────────────────────────────────────

export class GoogleCalendarProvider implements CalendarProvider {
  name = 'google';

  constructor(private accessToken: string) {}

  async createEvent(event: CalendarEvent): Promise<CalendarEventResult> {
    const body = {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.startAt.toISOString(), timeZone: event.timezone },
      end: { dateTime: event.endAt.toISOString(), timeZone: event.timezone },
      location: event.location,
      attendees: event.attendees?.map((a) => ({ email: a.email, displayName: a.name })),
      conferenceData: event.createMeetLink
        ? {
            createRequest: { requestId: `lf_${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
          }
        : undefined,
    };

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
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
      htmlLink: data.htmlLink,
    };
  }

  async updateEvent(externalId: string, event: Partial<CalendarEvent>): Promise<CalendarEventResult> {
    const body: Record<string, unknown> = {};
    if (event.title) body.summary = event.title;
    if (event.description !== undefined) body.description = event.description;
    if (event.startAt) body.start = { dateTime: event.startAt.toISOString(), timeZone: event.timezone };
    if (event.endAt) body.end = { dateTime: event.endAt.toISOString(), timeZone: event.timezone };
    if (event.location !== undefined) body.location = event.location;

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${externalId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Google Calendar update error: ${res.status}`);
    const data = await res.json();
    return { externalCalendarId: data.id, meetingUrl: data.hangoutLink, htmlLink: data.htmlLink };
  }

  async cancelEvent(externalId: string): Promise<void> {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${externalId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok && res.status !== 410) throw new Error(`Google Calendar cancel error: ${res.status}`);
  }

  async getEvent(externalId: string): Promise<CalendarEventResult | null> {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${externalId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Google Calendar get error: ${res.status}`);
    const data = await res.json();
    return { externalCalendarId: data.id, meetingUrl: data.hangoutLink, htmlLink: data.htmlLink };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function getCalendarProvider(provider: string, accessToken?: string): CalendarProvider {
  if (provider === 'google' && accessToken) return new GoogleCalendarProvider(accessToken);
  return new MockCalendarProvider();
}
