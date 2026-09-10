/**
 * Attendance captures live in object storage now, not on the container's disk.
 *
 * That directory was the one thing making the web tier stateful: a second
 * replica would take punches whose evidence only the first replica could read.
 *
 * What has to stay true through the move, and is asserted here:
 *
 *   - the frame is encrypted before it leaves this process, so what reaches the
 *     bucket is never a readable JPEG of an identifiable person;
 *   - `capturePath` keeps the shape already written to thousands of
 *     `HrAttendancePunch` rows, so no column migration is needed;
 *   - a capture stored before the move is still readable after it — a disputed
 *     punch from last month must not become unreadable on deploy day;
 *   - storing never throws, because the caller is an employee at a door;
 *   - retention sweeps *both* vaults, per workspace. Missing the legacy one
 *     would leave the oldest biometric data on the system as the only data with
 *     no retention applied to it.
 *
 * The storage layer is mocked, which is this repository's convention for
 * storage-touching code and is also what CI can run. It means the AWS SDK calls
 * themselves are not exercised here — only every decision this module makes.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in bucket: key -> { body, lastModified }. */
const bucket = new Map<string, { body: Buffer; lastModified: Date }>();
let putShouldFail = false;
/** SPEC-0005: the store refusing is not the same outcome as the object being gone. */
let deleteShouldFail = false;

vi.mock('@/lib/storage', () => ({
  putObject: vi.fn(async (key: string, body: Buffer) => {
    if (putShouldFail) throw new Error('bucket unreachable');
    bucket.set(key, { body, lastModified: new Date() });
    return key;
  }),
  getObject: vi.fn(async (key: string) => {
    const hit = bucket.get(key);
    if (!hit) throw new Error('NoSuchKey');
    return hit.body;
  }),
  listPrefixes: vi.fn(async (prefix: string) => {
    const shards = new Set<string>();
    for (const key of bucket.keys()) {
      if (!key.startsWith(prefix)) continue;
      shards.add(`${prefix}${key.slice(prefix.length).split('/')[0]}/`);
    }
    return [...shards];
  }),
  listObjects: vi.fn(async (prefix: string) =>
    [...bucket.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, lastModified: value.lastModified, size: value.body.length })),
  ),
  deleteObjects: vi.fn(async (keys: string[]) => {
    if (deleteShouldFail) throw new Error('bucket unreachable');
    let removed = 0;
    for (const key of keys) if (bucket.delete(key)) removed += 1;
    return removed;
  }),
}));

// The retention window comes from the workspace's HR policy; the default is what
// an unconfigured workspace gets, and is all these tests need.
vi.mock('@/lib/db', () => ({
  prisma: { organizationSetting: { findUnique: vi.fn(async () => null) } },
}));

const FRAME = Buffer.from('a jpeg, pretend');

let vault: typeof import('@/services/hr/captureVault');
let legacyRoot: string;

beforeEach(async () => {
  bucket.clear();
  putShouldFail = false;
  deleteShouldFail = false;
  legacyRoot = mkdtempSync(join(tmpdir(), 'captures-'));
  process.env.ATTENDANCE_CAPTURE_DIR = legacyRoot;
  vi.resetModules();
  vault = await import('@/services/hr/captureVault');
});

afterEach(() => {
  delete process.env.ATTENDANCE_CAPTURE_DIR;
});

describe('storing a capture', () => {
  it('returns the same relative path shape the punch column already holds', async () => {
    const when = new Date('2026-08-15T09:00:00Z');
    const relative = await vault.storeCapture('t1', 'emp1', 'punch1', FRAME, when);
    expect(relative).toBe('t-t1/emp-emp1/2026-08/punch-punch1.jpg.enc');
  });

  it('writes under one prefix, so a sweep can find captures without walking the bucket', async () => {
    await vault.storeCapture('t1', 'emp1', 'punch1', FRAME);
    expect([...bucket.keys()][0].startsWith('attendance/')).toBe(true);
  });

  it('never lets the frame reach storage in the clear', async () => {
    await vault.storeCapture('t1', 'emp1', 'punch1', FRAME);
    const stored = [...bucket.values()][0].body;
    expect(stored.includes(FRAME)).toBe(false);
    // IV + ciphertext + GCM tag, so strictly longer than the plaintext.
    expect(stored.length).toBeGreaterThan(FRAME.length);
  });

  it('returns null rather than throwing when storage is down', async () => {
    // The caller is an employee standing at a door. Losing the capture is bad;
    // refusing the punch is worse, and the punch row is written either way.
    putShouldFail = true;
    await expect(vault.storeCapture('t1', 'emp1', 'punch1', FRAME)).resolves.toBeNull();
  });

  it('ignores an empty frame instead of storing one', async () => {
    await expect(vault.storeCapture('t1', 'emp1', 'punch1', Buffer.alloc(0))).resolves.toBeNull();
    expect(bucket.size).toBe(0);
  });
});

describe('reading a capture', () => {
  it('round-trips the exact bytes', async () => {
    const relative = await vault.storeCapture('t1', 'emp1', 'punch1', FRAME);
    expect(await vault.loadCapture(relative!)).toEqual(FRAME);
  });

  it('still reads a capture written before the move, from the old directory', async () => {
    // Produced by the current writer, then relocated to disk and removed from
    // the bucket — exactly the state of a deployment mid-migration.
    const relative = await vault.storeCapture('t1', 'emp1', 'legacy', FRAME);
    const [key, value] = [...bucket.entries()][0];
    mkdirSync(join(legacyRoot, 't-t1', 'emp-emp1', relative!.split('/')[2]), { recursive: true });
    writeFileSync(join(legacyRoot, relative!), value.body);
    bucket.delete(key);

    expect(await vault.loadCapture(relative!)).toEqual(FRAME);
  });

  it('refuses to read outside the vault', async () => {
    // The expectation — a traversal key is refused — is unchanged. Only *where*
    // it is refused moved: SPEC-0005 requires a malformed key to be rejected
    // before it is ever resolved to a filesystem path, so this no longer
    // reaches the containment check. Both are refusals to act outside the
    // vault, and either satisfies the property this case exists for.
    await expect(vault.loadCapture('../../etc/passwd')).rejects.toThrow(
      /Refusing to (read outside|act on a malformed)/,
    );
  });

  // ST-001 (SPEC-0005). Every hostile shape, asserted separately rather than in
  // a loop, so a failure names the form that got through.
  describe('refuses a key that is not a plain relative location', () => {
    const HOSTILE: [string, string][] = [
      ['parent segment', 't-x/../../etc/passwd'],
      ['backslash parent', 't-x\\..\\..\\windows\\win.ini'],
      ['POSIX absolute', '/etc/passwd'],
      ['Windows absolute', 'C:\\Windows\\win.ini'],
      ['drive-relative', 'C:passwd'],
      ['UNC', '\\\\server\\share\\x'],
      ['current-directory segment', 't-x/./emp-y/f.jpg.enc'],
      ['empty segment', 't-x//emp-y/f.jpg.enc'],
      ['empty key', ''],
    ];

    for (const [name, key] of HOSTILE) {
      it(`refuses a ${name}`, async () => {
        await expect(vault.loadCapture(key)).rejects.toThrow(/Refusing to/);
        await expect(vault.deleteCapture(key)).rejects.toThrow(/Refusing to/);
      });
    }

    // ST-004 (SPEC-0005, TH-009, AD-004). Normalisation must not decode, and it
    // must happen once. A percent-encoded traversal stays a literal segment —
    // `..%2f` is not `..` — so it can never become a traversal on the way
    // through. The danger this pins is a future edit adding a decode step:
    // decode-then-validate is safe, validate-then-decode is a traversal.
    it('does not decode a percent-encoded traversal into one', async () => {
      for (const key of ['t-x/..%2f..%2fetc/passwd', 't-x/%2e%2e%2fetc/passwd', 't-x/%252e%252e%252fetc/passwd']) {
        // Either outcome is safe: refused, or treated as a literal segment that
        // resolves inside the vault. What must never happen is escaping it.
        await expect(vault.loadCapture(key)).rejects.toThrow(/Refusing to|NoSuchKey|ENOENT|no such file/i);
      }
    });

    it('names no key material in the refusal', async () => {
      // SEC-005: a key carries a tenant id and an employee id.
      await expect(vault.loadCapture('t-secret/../../etc/passwd')).rejects.toThrow(
        /^Refusing to act on a malformed attendance capture key\.$/,
      );
    });
  });

  // FR-011 / AC-003. A row written by a Windows host must stay readable, and
  // the row itself must not be rewritten by reading it.
  it('still reads a capture whose stored key holds backslashes', async () => {
    const relative = await vault.storeCapture('t1', 'emp1', 'legacy-sep', FRAME);
    const legacy = relative!.split('/').join('\\');
    expect(legacy).toContain('\\');
    expect(await vault.loadCapture(legacy)).toEqual(FRAME);
    // Unchanged: normalisation is for resolution only (FR-012).
    expect(legacy).toBe(relative!.split('/').join('\\'));
  });
});

/**
 * The deletion contract (SPEC-0005, TASK-004).
 *
 * The harm this specification exists for is not "a capture that cannot be
 * read". It is a retention sweep that deletes the punch row believing the
 * encrypted frame went with it, when nothing was deleted at all.
 */
describe('deleting a capture', () => {
  it('CASE 1 — canonical key, object present: the object is removed', async () => {
    const relative = await vault.storeCapture('t1', 'emp1', 'gone', FRAME);
    expect(bucket.has(`attendance/${relative}`)).toBe(true);
    await vault.deleteCapture(relative!);
    expect(bucket.has(`attendance/${relative}`)).toBe(false);
  });

  it('CASE 2 — the store refuses: the failure reaches the caller', async () => {
    // The invariant Application Security approved: a physical-object deletion
    // failure must not be presented as a completed cleanup. Before this change
    // the rejection was caught and discarded, and the caller could not tell a
    // failed delete from a successful one.
    const relative = await vault.storeCapture('t1', 'emp1', 'unreachable', FRAME);
    deleteShouldFail = true;
    await expect(vault.deleteCapture(relative!)).rejects.toThrow(/bucket unreachable/);
    deleteShouldFail = false;
    // Still there, which is the point: nothing was cleaned up.
    expect(bucket.has(`attendance/${relative}`)).toBe(true);
  });

  it('CASE 3 — legacy backslash key: the right object is removed', async () => {
    const relative = await vault.storeCapture('t1', 'emp1', 'legacy-del', FRAME);
    const legacy = relative!.split('/').join('\\');
    await vault.deleteCapture(legacy);
    expect(bucket.has(`attendance/${relative}`)).toBe(false);
  });

  it('CASE 4 — object already absent: that is the outcome asked for, not an error', async () => {
    const relative = await vault.storeCapture('t1', 'emp1', 'twice', FRAME);
    await vault.deleteCapture(relative!);
    await expect(vault.deleteCapture(relative!)).resolves.toBeUndefined();
  });
});

describe('retention', () => {
  it('deletes what is past the window and keeps what is not', async () => {
    const fresh = await vault.storeCapture('t1', 'emp1', 'fresh', FRAME);
    const stale = await vault.storeCapture('t1', 'emp1', 'stale', FRAME);
    bucket.get(`attendance/${stale}`)!.lastModified = new Date(Date.now() - 400 * 86_400_000);

    const result = await vault.purgeExpiredCaptures();

    expect(result.removed).toBe(1);
    expect(bucket.has(`attendance/${fresh}`)).toBe(true);
    expect(bucket.has(`attendance/${stale}`)).toBe(false);
  });

  it('applies the window per workspace and counts each once', async () => {
    await vault.storeCapture('t1', 'emp1', 'a', FRAME);
    await vault.storeCapture('t2', 'emp2', 'b', FRAME);
    const result = await vault.purgeExpiredCaptures();
    expect(result.workspaces).toBe(2);
  });

  it('keeps an object the listing could not date', async () => {
    // Wrong in the safe direction: a capture kept too long is a policy problem,
    // one deleted early is evidence that no longer exists.
    const relative = await vault.storeCapture('t1', 'emp1', 'undated', FRAME);
    (bucket.get(`attendance/${relative}`) as { lastModified: Date | null }).lastModified = null;

    await vault.purgeExpiredCaptures();

    expect(bucket.has(`attendance/${relative}`)).toBe(true);
  });

  it('sweeps the legacy directory too', async () => {
    const dir = join(legacyRoot, 't-t1', 'emp-emp1', '2026-01');
    mkdirSync(dir, { recursive: true });
    const old = join(dir, 'punch-ancient.jpg.enc');
    writeFileSync(old, Buffer.from('ciphertext'));
    // Older than any retention window this codebase offers.
    const past = new Date(Date.now() - 400 * 86_400_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(old, past, past);

    const result = await vault.purgeExpiredCaptures();

    expect(result.removed).toBe(1);
    const { existsSync } = await import('node:fs');
    expect(existsSync(old)).toBe(false);
  });
});
