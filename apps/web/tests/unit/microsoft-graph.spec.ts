import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit M8-09: what goes to Microsoft Graph and to Microsoft's token endpoint,
 * request by request. `fetch` is stubbed; nothing leaves the process.
 *
 * Hoisted: lib/env.ts freezes the environment the moment it is imported.
 */
vi.hoisted(() => {
  process.env.MICROSOFT_CLIENT_ID = 'test-ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret-must-never-leak';
});

import {
  createGraphEvent,
  deleteGraphEvent,
  microsoftOAuthConfigured,
  microsoftToken,
  updateGraphEvent,
  type CalendarEvent,
} from '@/lib/integrations/calendar';

type Sent = { url: string; method: string; headers: Headers; body: string };
const sent: Sent[] = [];
let answer: () => Response = () => new Response(null, { status: 204 });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    sent.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: String(init.body ?? ''),
    });
    return answer();
  }),
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  sent.length = 0;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const meeting: CalendarEvent = {
  title: 'Meeting: Payment plan — Sara',
  description: 'Lead: Sara\nhttps://app.example/acme/sales/leads/l1',
  startAt: new Date('2026-11-03T06:00:00.000Z'),
  endAt: new Date('2026-11-03T06:30:00.000Z'),
  timezone: 'Asia/Dubai',
  location: 'Marina Walk',
  attendees: ['agent@acme.test'],
};

describe('Microsoft Graph events', () => {
  it('creates on the account’s default calendar, in UTC, with the owner invited and a transactionId', async () => {
    answer = () => json({ id: 'AAMkAGI2-event-1' }, 201);
    expect(await createGraphEvent('ms-access', meeting, 'tx-1')).toBe('AAMkAGI2-event-1');

    const [req] = sent;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(req.headers.get('authorization')).toBe('Bearer ms-access');
    expect(req.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({
      subject: 'Meeting: Payment plan — Sara',
      body: { contentType: 'text', content: 'Lead: Sara\nhttps://app.example/acme/sales/leads/l1' },
      start: { dateTime: '2026-11-03T06:00:00.000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-03T06:30:00.000', timeZone: 'UTC' },
      location: { displayName: 'Marina Walk' },
      attendees: [{ emailAddress: { address: 'agent@acme.test' }, type: 'required' }],
      transactionId: 'tx-1',
    });
  });

  it('moves with a PATCH of every field, a place or guest taken off included, and no transactionId', async () => {
    answer = () => json({ id: 'AAMk/+=' });
    const bare = { ...meeting, location: undefined, attendees: undefined };
    expect(await updateGraphEvent('ms-access', 'AAMk/+=', bare)).toBe(true);

    const [req] = sent;
    expect(req.method).toBe('PATCH');
    // Graph ids carry '/', '+' and '=': escaped into one path segment.
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/events/AAMk%2F%2B%3D');
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ location: { displayName: '' }, attendees: [] });
    expect(body).not.toHaveProperty('transactionId');
  });

  it('says an event deleted in Outlook is gone, so the sync creates it again', async () => {
    answer = () => json({ error: { code: 'ErrorItemNotFound', message: 'The specified object was not found.' } }, 404);
    expect(await updateGraphEvent('ms-access', 'gone', meeting)).toBe(false);
  });

  it('throws Graph’s own message on a failure, for the Integrations card', async () => {
    answer = () => json({ error: { code: 'ErrorServerBusy', message: 'The server is busy.' } }, 503);
    await expect(updateGraphEvent('ms-access', 'x', meeting)).rejects.toThrow(
      'Microsoft Graph error: 503 The server is busy.',
    );
    await expect(createGraphEvent('ms-access', meeting, 'tx')).rejects.toThrow(/^Microsoft Graph error: 503/);
  });

  it('deletes, and an event already gone is what was asked for', async () => {
    answer = () => new Response(null, { status: 204 });
    await deleteGraphEvent('ms-access', 'AAMk-1');
    expect(sent[0]).toMatchObject({ method: 'DELETE', url: 'https://graph.microsoft.com/v1.0/me/events/AAMk-1' });

    answer = () => json({ error: { message: 'Not found' } }, 404);
    await expect(deleteGraphEvent('ms-access', 'AAMk-1')).resolves.toBeUndefined();
    answer = () => json({ error: { message: 'Access is denied.' } }, 403);
    await expect(deleteGraphEvent('ms-access', 'AAMk-1')).rejects.toThrow(
      'Microsoft Graph error: 403 Access is denied.',
    );
  });
});

describe('Microsoft’s token endpoint', () => {
  it('is configured only with both the client id and secret', () => {
    expect(microsoftOAuthConfigured()).toBe(true);
  });

  it('refreshes with the client and the scopes, and hands back the new refresh token', async () => {
    answer = () =>
      json({
        access_token: 'ms-fresh',
        refresh_token: 'ms-refresh-2',
        expires_in: 3599,
        scope: 'Calendars.ReadWrite User.Read',
      });
    const before = Date.now();
    const tokens = await microsoftToken({ refreshToken: 'ms-refresh-1' });

    const [req] = sent;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(req.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      client_id: 'test-ms-client',
      client_secret: 'test-ms-secret-must-never-leak',
      scope: 'offline_access Calendars.ReadWrite User.Read',
      grant_type: 'refresh_token',
      refresh_token: 'ms-refresh-1',
    });
    expect(tokens).toMatchObject({
      accessToken: 'ms-fresh',
      refreshToken: 'ms-refresh-2',
      scopes: ['Calendars.ReadWrite', 'User.Read'],
    });
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_598_000);
  });

  it('redeems the consent screen’s code with its redirect URI and PKCE verifier', async () => {
    answer = () => json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    await microsoftToken({ code: 'the-code', redirectUri: 'https://app.example/cb', verifier: 'v'.repeat(43) });
    expect(Object.fromEntries(new URLSearchParams(sent[0].body))).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://app.example/cb',
      code_verifier: 'v'.repeat(43),
    });
  });

  it('a refusal reads Microsoft’s first line, never the secret or the trace ids', async () => {
    answer = () =>
      json(
        {
          error: 'invalid_grant',
          error_description:
            "AADSTS70000: The provided value for the 'refresh_token' is expired.\r\nTrace ID: 1f2e Correlation ID: 9a8b Timestamp: 2026-10-18 10:00:00Z",
        },
        400,
      );
    const failure = microsoftToken({ refreshToken: 'stale' });
    await expect(failure).rejects.toThrow(
      "Microsoft refused the token: AADSTS70000: The provided value for the 'refresh_token' is expired.",
    );
    const message = await failure.catch((err: Error) => err.message);
    expect(message).not.toMatch(/Trace ID|test-ms-secret/);
  });
});
