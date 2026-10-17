import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The phone app's outbox (lib/offline.ts): kept when there is no connection,
 * sent in order when there is, kept again on a signed-out or failing server,
 * and a refusal dropped and reported rather than retried forever.
 */
const store = new Map<string, string>();
const fetchMock = vi.fn();
const net: { onLine: boolean; locks?: { request: (name: string, run: () => unknown) => unknown } } = { onLine: true };
// The workspace frame names whose screen this is (layout.tsx, data-outbox-owner).
const frame = { dataset: { outboxOwner: 'tenant-x:agent-a' } };
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', { dispatchEvent: () => true });
vi.stubGlobal('document', { querySelector: () => frame });
vi.stubGlobal('navigator', net);
vi.stubGlobal('fetch', fetchMock);

const { flush, forget, pending, sendOrQueue } = await import('@/lib/offline');
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  net.onLine = true;
  delete net.locks;
  frame.dataset.outboxOwner = 'tenant-x:agent-a';
});

describe('offline outbox', () => {
  it('sends straight away when online', async () => {
    fetchMock.mockResolvedValue(reply(200));
    const res = await sendOrQueue('/api/v1/leads/1', 'PATCH', { stageId: 's' }, 'Stage');
    expect(res).not.toBe('queued');
    expect(pending()).toHaveLength(0);
  });

  it('keeps it when offline, or when the send fails on the network', async () => {
    net.onLine = false;
    expect(await sendOrQueue('/a', 'PATCH', { n: 1 }, 'First')).toBe('queued');
    net.onLine = true;
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await sendOrQueue('/b', 'POST', { n: 2 }, 'Second')).toBe('queued');
    expect(pending().map((p) => p.label)).toEqual(['First', 'Second']);
  });

  it('sends what waited in order, and stops at a signed-out session keeping the rest', async () => {
    net.onLine = false;
    await sendOrQueue('/a', 'PATCH', {}, 'First');
    await sendOrQueue('/b', 'POST', {}, 'Second');
    await sendOrQueue('/c', 'POST', {}, 'Third');
    fetchMock.mockResolvedValueOnce(reply(200)).mockResolvedValueOnce(reply(401));
    expect(await flush()).toEqual({ sent: 1, refused: [] });
    expect(pending().map((p) => p.label)).toEqual(['Second', 'Third']);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/a', '/b']);
  });

  it('sends one Idempotency-Key per change, the same on every attempt, so a late or repeated send is replayed', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(reply(200));
    expect(await sendOrQueue('/api/v1/follow-ups', 'POST', { title: 'Call back' }, 'New follow-up')).toBe('queued');
    await sendOrQueue('/api/v1/follow-ups/1', 'PATCH', { status: 'COMPLETED' }, 'Follow-up done');
    await flush();
    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('idempotency-key'));
    expect(keys).toHaveLength(3);
    expect(keys.every(Boolean)).toBe(true);
    // The first change, failed then flushed, kept its key; the second has its own.
    expect(keys[2]).toBe(keys[0]);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('drops and reports a refusal, which retrying would not change', async () => {
    net.onLine = false;
    await sendOrQueue('/a', 'POST', {}, 'Call logged');
    fetchMock.mockResolvedValueOnce(reply(422, { detail: 'An activity is logged within a week of when it happened.' }));
    const result = await flush();
    expect(result.sent).toBe(0);
    expect(result.refused.map((r) => [r.label, r.reason])).toEqual([
      ['Call logged', 'An activity is logged within a week of when it happened.'],
    ]);
    expect(pending()).toHaveLength(0);
  });

  it("never sends one session's change as another's: held until its workspace and person are back", async () => {
    net.onLine = false;
    await sendOrQueue('/api/v1/follow-ups', 'POST', { title: 'Call back Ahmed' }, 'New follow-up');
    // Signed out by expiry, then someone else (or the same agent in another workspace) signs in.
    frame.dataset.outboxOwner = 'tenant-y:agent-b';
    net.onLine = true;
    fetchMock.mockResolvedValue(reply(200));
    expect(pending()).toHaveLength(0);
    expect(await flush()).toEqual({ sent: 0, refused: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    // Back in workspace X as agent A: sent.
    frame.dataset.outboxOwner = 'tenant-x:agent-a';
    expect(pending().map((p) => p.label)).toEqual(['New follow-up']);
    expect(await flush()).toEqual({ sent: 1, refused: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends each change once when two sends start together (reconnecting and coming back to the app)', async () => {
    net.onLine = false;
    await sendOrQueue('/api/v1/follow-ups', 'POST', { title: 'Call back' }, 'New follow-up');
    await sendOrQueue('/api/v1/cold-data/1', 'PATCH', { status: 'INTERESTED' }, 'Cold call');
    net.onLine = true;
    fetchMock.mockImplementation(() => new Promise((done) => setTimeout(() => done(reply(200)), 5)));
    const [first, second] = await Promise.all([flush(), flush()]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/follow-ups', '/api/v1/cold-data/1']);
    expect(first.sent + second.sent).toBe(2);
    expect(pending()).toHaveLength(0);
  });

  it('sends under the Web Lock where there is one, so two tabs take turns', async () => {
    net.onLine = false;
    await sendOrQueue('/a', 'PATCH', {}, 'First');
    net.onLine = true;
    const request = vi.fn((_name: string, run: () => unknown) => run());
    net.locks = { request };
    fetchMock.mockResolvedValue(reply(200));
    expect(await flush()).toEqual({ sent: 1, refused: [] });
    expect(request).toHaveBeenCalledWith('youhan.outbox.v1', expect.any(Function));
  });

  it('forgets what waited on signing out', async () => {
    net.onLine = false;
    await sendOrQueue('/a', 'PATCH', {}, 'First');
    forget();
    expect(store.has('youhan.outbox.v1')).toBe(false);
    expect(pending()).toHaveLength(0);
  });
});
