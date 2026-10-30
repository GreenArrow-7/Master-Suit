/**
 * An automation trigger must reach the queue on every edit, not only the first.
 *
 * `enqueue` derives a job id from a hash of its payload, and BullMQ ignores an
 * `add` whose id already exists — including the completed jobs it retains
 * (`removeOnComplete: 1_000`). The payload for `record.updated` names only the
 * tenant, the event, the object and the record, so every edit of one lead
 * hashed to the same id: the second edit was dropped, and a workspace's rules
 * ran once per record and then silently never again, until a thousand other
 * automation jobs had pushed the old one out.
 *
 * Two halves, because either alone would pass while the bug was live:
 *   1. every automation trigger asks for a `fresh` id — checked at the call
 *      sites rather than against a list, so the next one is covered too;
 *   2. `fresh` genuinely produces a different id, so (1) is not asserting a
 *      no-op.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The text of the `enqueue(...)` call starting at `open`, parentheses balanced. */
function callText(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Every `enqueue(` call in `text`, as source, with the offset it starts at. */
function enqueueCalls(text: string): string[] {
  const calls: string[] = [];
  const pattern = /\benqueue\s*\(/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    calls.push(callText(text, m.index + m[0].length - 1));
  }
  return calls;
}

/**
 * Events that can happen to one record more than once, so two of them carry the
 * same payload. `record.created` is deliberately absent: a created record has an
 * id nothing else has ever had, which makes its payload unique by construction
 * and its job id unique with it. Demanding `fresh` there would be asking for a
 * salt against a collision that cannot occur.
 */
const RECURS = ['record.updated', 'sla.warning'];

const triggers = sourceFiles(srcDir).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  if (!text.includes("'automation'")) return [];
  return (
    enqueueCalls(text)
      // The first two arguments, in order: the queue and the job name.
      .filter((call) => /^\(\s*'automation'\s*,\s*'trigger'\s*,/.test(call))
      .map((call) => ({ file: path.relative(srcDir, file), call }))
  );
});

describe('every automation trigger that can repeat asks for a fresh id', () => {
  const offenders = triggers
    .filter(({ call }) => RECURS.some((event) => call.includes(`'${event}'`)))
    .filter(({ call }) => !/fresh:\s*true/.test(call))
    .map(({ file, call }) => `${file}: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);

  it('leaves none of them on a payload-derived id', () => {
    expect(offenders).toEqual([]);
  });

  it('finds the call sites at all, so an empty pass means something', () => {
    const recurring = triggers.filter(({ call }) => RECURS.some((event) => call.includes(`'${event}'`)));
    expect(recurring.length).toBeGreaterThanOrEqual(4);
  });
});

describe('fresh changes the job id', () => {
  const added: { jobId?: string }[] = [];

  beforeEach(() => {
    added.length = 0;
    vi.resetModules();
  });

  it('gives two identical payloads two ids with fresh, and one without', async () => {
    // Both stubbed so importing the queue does not pull in lib/env, which
    // refuses to load without a configured deployment. The id derivation under
    // test reads neither.
    vi.doMock('@/lib/redis', () => ({ redis: {} }));
    vi.doMock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));
    vi.doMock('bullmq', () => ({
      Queue: class {
        add(_name: string, _payload: unknown, opts: { jobId?: string }) {
          added.push(opts);
          return Promise.resolve({ id: opts.jobId });
        }
      },
    }));
    const { enqueue } = await import('@/lib/queue');

    const payload = { tenantId: 't1', event: 'record.updated', object: 'LEAD', recordId: 'lead-1' };
    await enqueue('automation', 'trigger', payload);
    await enqueue('automation', 'trigger', payload);
    expect(added[0].jobId).toBe(added[1].jobId);

    // `fresh` salts with the clock, so two calls in one millisecond would still
    // collide. Moved on deliberately rather than slept through.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));
    await enqueue('automation', 'trigger', payload, { fresh: true });
    vi.setSystemTime(new Date('2026-10-30T00:00:00.050Z'));
    await enqueue('automation', 'trigger', payload, { fresh: true });
    vi.useRealTimers();
    expect(added[2].jobId).not.toBe(added[3].jobId);
  });
});
