import { describe, expect, it } from 'vitest';
import {
  appendEntry,
  DIAGNOSTIC_KEY,
  forgetOtherOwners,
  formatReport,
  keyFor,
  makeEntry,
  MAX_ENTRIES,
  readEntries,
  redactMessage,
  redactPath,
  writeEntries,
  type DiagnosticEntry,
} from '@/lib/diagnostics/clientLog';

/**
 * The diagnostic ships to production, so what it must *not* record matters more
 * than what it does. These are the privacy rules, asserted.
 */
describe('nothing identifying survives redaction', () => {
  it('replaces record ids with :id, keeping the screen', () => {
    expect(redactPath('/manath-homes/sales/leads/cmwbq1qcz00n07shzjd67tdor')).toBe('/manath-homes/sales/leads/:id');
  });

  it('keeps the workspace slug, which names a workspace and not a person', () => {
    expect(redactPath('/manath-homes/sales/leads')).toBe('/manath-homes/sales/leads');
  });

  it('drops the query string, which carries filters and search terms', () => {
    expect(redactPath('/w/sales/leads?q=John+Smith&token=abc')).toBe('/w/sales/leads');
  });

  it.each([
    ['cuid', '/w/leads/cmwbq1qcz00n07shzjd67tdor'],
    ['uuid', '/w/leads/3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['numeric', '/w/leads/128374'],
  ])('treats a %s segment as an identifier', (_label, path) => {
    expect(redactPath(path)).toBe('/w/leads/:id');
  });

  it('redacts identifiers inside an error message too', () => {
    const message = redactMessage(
      new TypeError('Load failed for https://one.youhan.in/manath-homes/sales/leads/cmwbq1qcz00n07shzjd67tdor'),
    );
    expect(message).toContain('/manath-homes/sales/leads/:id');
    expect(message).not.toContain('cmwbq1qcz00n07shzjd67tdor');
  });

  it('truncates a long thrown value rather than storing it whole', () => {
    const long = redactMessage('x'.repeat(5000));
    expect(long.length).toBeLessThanOrEqual(201);
    expect(long.endsWith('…')).toBe(true);
  });

  it('survives a thrown value that is not an Error and not serialisable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => redactMessage(circular)).not.toThrow();
    expect(() => redactMessage(undefined)).not.toThrow();
  });
});

describe('the buffer is bounded', () => {
  it(`keeps at most ${MAX_ENTRIES}, dropping the oldest`, () => {
    let entries: DiagnosticEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 15; i++) {
      entries = appendEntry(entries, makeEntry('error', `/w/screen-${i}`, `boom ${i}`));
    }
    expect(entries).toHaveLength(MAX_ENTRIES);
    // The newest survives and the first is long gone.
    expect(entries.at(-1)!.detail).toContain(`boom ${MAX_ENTRIES + 14}`);
    expect(entries.some((e) => e.detail.includes('boom 0'))).toBe(false);
  });
});

describe('storage never breaks the page it is diagnosing', () => {
  const throwing = {
    getItem() {
      throw new DOMException('denied');
    },
    setItem() {
      throw new DOMException('denied');
    },
  };

  it('reads nothing when storage is unavailable', () => {
    expect(readEntries(throwing, keyFor('t:u'))).toEqual([]);
    expect(readEntries(undefined, keyFor('t:u'))).toEqual([]);
  });

  it('writes without throwing when storage is unavailable', () => {
    expect(() => writeEntries(throwing, keyFor('t:u'), [makeEntry('error', '/w', 'x')])).not.toThrow();
    expect(() => writeEntries(undefined, keyFor('t:u'), [])).not.toThrow();
  });

  it('reads nothing when the stored value is not a list', () => {
    expect(readEntries({ getItem: () => '{"not":"a list"}' }, keyFor('t:u'))).toEqual([]);
    expect(readEntries({ getItem: () => 'not json at all' }, keyFor('t:u'))).toEqual([]);
  });

  it('round-trips through a real-shaped store', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const key = keyFor('tenant1:user1');
    const entries = [makeEntry('blank-screen', '/w/sales/leads/cmwbq1qcz00n07shzjd67tdor', 'main was empty')];
    writeEntries(storage, key, entries);
    expect(store.has(key)).toBe(true);
    expect(key.startsWith(DIAGNOSTIC_KEY)).toBe(true);
    expect(readEntries(storage, key)[0]!.path).toBe('/w/sales/leads/:id');
  });
});

describe('the report a person copies out', () => {
  it('says so plainly when nothing was recorded', () => {
    expect(formatReport([], '83d9a85e')).toContain('(nothing recorded)');
  });

  it('names the build and lists events oldest first', () => {
    const report = formatReport(
      [
        makeEntry('error', '/w/a', 'first', new Date('2026-11-11T10:00:00Z')),
        makeEntry('blank-screen', '/w/b', 'second', new Date('2026-11-11T10:00:05Z')),
      ],
      '84d71629',
    );
    expect(report).toContain('build 84d71629');
    expect(report.indexOf('first')).toBeLessThan(report.indexOf('second'));
    expect(report).toContain('blank-screen');
  });

  it('records time only to the second — enough to match a server log, no more', () => {
    const entry = makeEntry('error', '/w', 'x', new Date('2026-11-11T10:00:05.123Z'));
    expect(entry.at).toBe('2026-11-11T10:00:05Z');
  });
});

/**
 * Redacting record ids out of paths does not prove an arbitrary thrown message
 * is safe to copy out. A message is whatever the code interpolated: a bearer
 * token from a failed request, the account's email, a lead's phone number.
 */
describe('secrets and personal data never reach the log', () => {
  it.each([
    ['bearer token', 'Request failed: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop', /eyJhbGci|abcdefghij/],
    ['authorization header', 'headers: {authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l}', /YWxhZGRpbg/],
    ['api key', 'fetch failed api_key=sk_live_51H8zQ2KdefghIJKL', /sk_live_51H8zQ2/],
    ['password', 'login failed password: hunter2correct', /hunter2correct/],
    ['session token', 'token=abc123def456ghi789jkl', /abc123def456/],
  ])('removes a %s', (_label, message, mustNotAppear) => {
    expect(redactMessage(message)).not.toMatch(mustNotAppear);
  });

  it('removes an email address', () => {
    const out = redactMessage('Could not invite amina.alrashid@example.com');
    expect(out).not.toContain('amina.alrashid@example.com');
    expect(out).toContain('[redacted-email]');
  });

  it('removes a phone number', () => {
    const out = redactMessage('Invalid phone +971 50 123 4567 for lead');
    expect(out).not.toContain('971 50 123 4567');
    expect(out).toContain('[redacted-number]');
  });

  it('scrubs before truncating, so a long secret cannot survive by position', () => {
    // A token at the front would otherwise be kept whole by a 200-char clip.
    const out = redactMessage(`token=${'s'.repeat(400)} and then some trailing text`);
    expect(out).not.toContain('ssssssssss');
  });

  it('keeps a message that carries nothing sensitive', () => {
    expect(redactMessage(new TypeError('Load failed'))).toBe('TypeError: Load failed');
  });
});

describe('one log per person on a shared device', () => {
  it('keys by owner, so two people on one phone do not share a log', () => {
    expect(keyFor('tenantA:userA')).not.toBe(keyFor('tenantA:userB'));
    expect(keyFor('tenantA:userA')).not.toBe(keyFor('tenantB:userA'));
  });

  it("forgets everybody else's log when somebody signs in", () => {
    const store = new Map<string, string>([
      [keyFor('t:previous'), '[]'],
      [keyFor('t:current'), '[{"at":"x"}]'],
      // No owner at all: unreadable through the UI, so it must not survive.
      [DIAGNOSTIC_KEY, '[{"at":"from an earlier build"}]'],
      ['unrelated.app.key', 'keep me'],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;

    forgetOtherOwners(storage, keyFor('t:current'));

    expect(store.has(keyFor('t:previous'))).toBe(false);
    expect(store.has(DIAGNOSTIC_KEY)).toBe(false);
    expect(store.has(keyFor('t:current'))).toBe(true);
    // Never touches anything that is not ours.
    expect(store.has('unrelated.app.key')).toBe(true);
  });

  it('does not throw when storage is absent', () => {
    expect(() => forgetOtherOwners(undefined, keyFor('t:u'))).not.toThrow();
  });
});
