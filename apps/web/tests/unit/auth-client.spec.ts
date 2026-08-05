import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAuthClientForTests, authFetch, onSessionEnded, refreshSession } from '@/lib/auth/client';

/**
 * The browser half of session refresh.
 *
 * The concurrency case is the one that matters most. The server treats a
 * replayed rotated token as theft and revokes every session for the account, so
 * a client that fires parallel refreshes does not merely waste requests — it
 * signs the user out of everything. Single flight is a correctness requirement,
 * not an optimisation.
 */
type Handler = (url: string, init?: RequestInit) => { status: number };

function stubFetch(handler: Handler) {
  const calls: { url: string; method: string }[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
    const { status } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify({ status }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return { calls, spy };
}

beforeEach(() => { __resetAuthClientForTests(); });
afterEach(() => { vi.unstubAllGlobals(); __resetAuthClientForTests(); });

describe('no token is ever held in JavaScript', () => {
  it('never touches localStorage or sessionStorage', async () => {
    const localSet = vi.fn();
    const sessionSet = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: localSet, removeItem: vi.fn() });
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: sessionSet, removeItem: vi.fn() });
    stubFetch(() => ({ status: 200 }));

    await authFetch('/api/v1/thing');
    await refreshSession();

    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it('sends the session cookie rather than an Authorization header', async () => {
    const { spy } = stubFetch(() => ({ status: 200 }));
    await authFetch('/api/v1/thing');
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });
});

describe('expiry and rotation', () => {
  it('passes a successful response straight through without refreshing', async () => {
    const { calls } = stubFetch(() => ({ status: 200 }));
    const response = await authFetch('/api/v1/thing');
    expect(response.status).toBe(200);
    expect(calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(0);
  });

  it('refreshes once on a 401 and replays the original request', async () => {
    let firstAttemptDone = false;
    const { calls } = stubFetch((url) => {
      if (url.includes('/auth/refresh')) return { status: 200 };
      if (!firstAttemptDone) { firstAttemptDone = true; return { status: 401 }; }
      return { status: 200 };
    });

    const response = await authFetch('/api/v1/thing');
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/thing', '/api/v1/auth/refresh', '/api/v1/thing',
    ]);
  });

  it('retries at most once — a second 401 is the answer', async () => {
    const { calls } = stubFetch((url) => (url.includes('/auth/refresh') ? { status: 200 } : { status: 401 }));
    const response = await authFetch('/api/v1/thing');
    expect(response.status).toBe(401);
    expect(calls.filter((call) => call.url === '/api/v1/thing')).toHaveLength(2);
    expect(calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('does not retry when the caller opts out', async () => {
    const { calls } = stubFetch(() => ({ status: 401 }));
    const response = await authFetch('/api/v1/thing', { retryOnUnauthorized: false });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
  });
});

describe('single flight', () => {
  it('collapses concurrent 401s into exactly one refresh', async () => {
    const expired = new Set(['/api/v1/a', '/api/v1/b', '/api/v1/c', '/api/v1/d', '/api/v1/e']);
    const { calls } = stubFetch((url) => {
      if (url.includes('/auth/refresh')) return { status: 200 };
      if (expired.has(url)) { expired.delete(url); return { status: 401 }; }
      return { status: 200 };
    });

    const responses = await Promise.all(
      ['/api/v1/a', '/api/v1/b', '/api/v1/c', '/api/v1/d', '/api/v1/e'].map((url) => authFetch(url)),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    // Five parallel 401s, one refresh. More would be replays, and the server
    // treats a replayed rotated token as theft.
    expect(calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('allows a fresh refresh after the previous one settles', async () => {
    const { calls } = stubFetch(() => ({ status: 200 }));
    await refreshSession();
    await new Promise((resolve) => { queueMicrotask(() => resolve(null)); });
    await refreshSession();
    expect(calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(2);
  });
});

describe('failing closed', () => {
  it('notifies listeners and stops when refresh is refused', async () => {
    const { calls } = stubFetch((url) => ({ status: url.includes('/auth/refresh') ? 401 : 401 }));
    const ended = vi.fn();
    onSessionEnded(ended);

    const response = await authFetch('/api/v1/thing');
    expect(response.status).toBe(401);
    expect(ended).toHaveBeenCalledTimes(1);
    // The original request is not replayed when the refresh itself failed.
    expect(calls.filter((call) => call.url === '/api/v1/thing')).toHaveLength(1);
  });

  it('treats a network failure during refresh as a failed refresh, not a success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/refresh')) throw new Error('network down');
      return new Response(null, { status: 401 });
    }));
    const ended = vi.fn();
    onSessionEnded(ended);

    const response = await authFetch('/api/v1/thing');
    expect(response.status).toBe(401);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners when the replayed request is still unauthorised', async () => {
    stubFetch((url) => (url.includes('/auth/refresh') ? { status: 200 } : { status: 401 }));
    const ended = vi.fn();
    onSessionEnded(ended);
    await authFetch('/api/v1/thing');
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('survives a listener that throws', async () => {
    stubFetch(() => ({ status: 401 }));
    onSessionEnded(() => { throw new Error('bad listener'); });
    const good = vi.fn();
    onSessionEnded(good);
    await expect(authFetch('/api/v1/thing')).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
  });

  it('stops notifying once a listener unsubscribes', async () => {
    stubFetch(() => ({ status: 401 }));
    const ended = vi.fn();
    const off = onSessionEnded(ended);
    off();
    await authFetch('/api/v1/thing');
    expect(ended).not.toHaveBeenCalled();
  });
});
