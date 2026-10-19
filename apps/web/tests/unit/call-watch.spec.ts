import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallWatchPlugin, CallWatchResult } from '@/lib/leads/callWatch';

/**
 * Calls placed from the phone app log themselves (audit M9-09): CallWatch is
 * armed before the dialler opens, and the call it reports is logged once on
 * the lead through the one-step call log. The plugin is mocked; the outbox
 * (lib/offline.ts) and its fetch are real but for the network.
 */
const fetchMock = vi.fn();
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => stored.set(k, v),
  removeItem: (k: string) => stored.delete(k),
});
vi.stubGlobal('window', { dispatchEvent: () => true });
vi.stubGlobal('document', { querySelector: () => ({ dataset: { outboxOwner: 'tenant-x:agent-a' } }) });
vi.stubGlobal('navigator', { onLine: true });
vi.stubGlobal('fetch', fetchMock);

const { ANSWERED_AFTER_SECS, autoLog, callWatch, dialAndLog } = await import('@/lib/leads/callWatch');
const { flush, pending } = await import('@/lib/offline');

const lead = { id: 'lead-1', fullName: 'Amira Haddad' };
const startedAt = Date.UTC(2026, 9, 19, 9, 0, 0);

/** A CallWatch whose events the test sends: `ended` reports the armed call as the phone would. */
function phone(armed: boolean | 'throws' = true) {
  const handlers: ((r: CallWatchResult) => void)[] = [];
  const removed = vi.fn(async () => {});
  let key = '';
  const plugin: CallWatchPlugin = {
    start: vi.fn(async (options: { key: string }) => {
      if (armed === 'throws') throw new Error('plugin missing');
      key = options.key;
      return { armed };
    }),
    addListener: vi.fn(async (_event, handler) => {
      handlers.push(handler);
      return { remove: removed };
    }),
  };
  const ended = (r: Partial<CallWatchResult>) =>
    handlers.forEach((h) =>
      h({
        key,
        timedOut: false,
        startedAt,
        connectedAt: null,
        endedAt: startedAt + 60_000,
        durationSeconds: 0,
        connected: null,
        ...r,
      }),
    );
  return { plugin, ended, removed, key: () => key };
}

/** Dials, waits for the dialler to open, then lets the phone report. */
async function dialThen(p: ReturnType<typeof phone>, report: () => void) {
  const open = vi.fn();
  const done = dialAndLog(p.plugin, lead, open);
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  report();
  return { watched: await done, open };
}

const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body), headers: init.headers }));

beforeEach(() => {
  stored.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ activity: { id: 'act-9' }, followUp: null })));
});

describe('a call placed from the phone app logs itself (M9-09)', () => {
  it('logs a connected call once, with its real start, talk time, outcome and the armed key', async () => {
    const p = phone();
    const { watched } = await dialThen(p, () =>
      p.ended({ connected: true, connectedAt: startedAt + 9_000, durationSeconds: 125 }),
    );

    expect(sent()).toEqual([
      {
        url: '/api/v1/leads/lead-1/call-log',
        body: {
          outcome: 'Connected',
          durationSecs: 125,
          occurredAt: new Date(startedAt).toISOString(),
          requestKey: p.key(),
        },
        headers: expect.objectContaining({ 'idempotency-key': expect.any(String) }),
      },
    ]);
    expect(watched).toEqual({
      status: 'logged',
      activityId: 'act-9',
      log: { outcome: 'Connected', durationSecs: 125, occurredAt: new Date(startedAt).toISOString() },
    });
    expect(p.removed).toHaveBeenCalled();
  });

  it('logs a call nobody answered as No answer, with no talk time', async () => {
    const p = phone();
    await dialThen(p, () => p.ended({ connected: false, durationSeconds: 0 }));
    expect(sent().map((s) => s.body)).toEqual([expect.objectContaining({ outcome: 'No answer', durationSecs: 0 })]);
  });

  it('reads an Android call, which never says when it was answered, by its time off hook', () => {
    const android = (durationSeconds: number) =>
      autoLog({
        key: 'k',
        timedOut: false,
        startedAt,
        connectedAt: null,
        endedAt: 0,
        durationSeconds,
        connected: null,
      });
    expect(android(ANSWERED_AFTER_SECS - 1)).toMatchObject({ outcome: 'No answer', durationSecs: 0 });
    expect(android(ANSWERED_AFTER_SECS)).toMatchObject({ outcome: 'Connected', durationSecs: ANSWERED_AFTER_SECS });
  });

  it('logs nothing, and opens no dialler, when the phone permission is refused', async () => {
    for (const p of [phone(false), phone('throws')]) {
      const open = vi.fn();
      expect(await dialAndLog(p.plugin, lead, open)).toEqual({ status: 'unarmed' });
      expect(open).not.toHaveBeenCalled();
      expect(p.removed).toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs nothing when no call is placed within the minute', async () => {
    const p = phone();
    const { watched } = await dialThen(p, () => p.ended({ timedOut: true, startedAt: null }));
    expect(watched).toEqual({ status: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a call reported twice once, and ignores a report for an earlier armed call', async () => {
    const p = phone();
    const { watched } = await dialThen(p, () => {
      const mine = p.key();
      p.ended({ key: 'an-earlier-call', connected: true, durationSeconds: 999 });
      p.ended({ key: mine, connected: true, durationSeconds: 61 });
      p.ended({ key: mine, connected: true, durationSeconds: 61 });
    });
    expect(watched).toMatchObject({ status: 'logged', log: { durationSecs: 61 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hands a refusal back for the manual log', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'Lead not found.' }), { status: 404 }));
    const p = phone();
    const { watched } = await dialThen(p, () => p.ended({ connected: true, durationSeconds: 70 }));
    expect(watched).toMatchObject({ status: 'failed', message: 'Lead not found.' });
  });

  it('keeps a call whose answer a retry may change, under the same key, and offers no second log', async () => {
    for (const status of [500, 502, 504, 429, 401]) {
      stored.clear();
      fetchMock.mockReset();
      // The server may have logged it before the error: a 504 from the proxy, or touchLead failing after the commit.
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Gateway timeout' }), { status }));
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ activity: { id: 'act-9' }, followUp: null })));
      const p = phone();
      const { watched } = await dialThen(p, () => p.ended({ connected: true, durationSeconds: 125 }));
      expect(watched).toEqual({
        status: 'logged',
        log: { outcome: 'Connected', durationSecs: 125, occurredAt: new Date(startedAt).toISOString() },
      });
      const [first] = sent();
      expect(pending()).toEqual([
        expect.objectContaining({ body: JSON.stringify(first!.body), id: first!.headers['idempotency-key'] }),
      ]);
      // Sent again as it was: the route replays the call already logged under that request key.
      expect(await flush()).toEqual({ sent: 1, refused: [] });
      expect(sent()[1]).toEqual(first);
      expect(pending()).toEqual([]);
    }
  });

  it('is not there in a browser', () => {
    expect(callWatch()).toBeNull();
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => false, Plugins: { CallWatch: phone().plugin } } });
    expect(callWatch()).toBeNull();
    const plugin = phone().plugin;
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true, Plugins: { CallWatch: plugin } } });
    expect(callWatch()).toBe(plugin);
    vi.stubGlobal('window', { dispatchEvent: () => true });
  });
});
