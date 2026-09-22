import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFilterTree } from '@/lib/api/filterTree';
import {
  NAMED_LEAD_FILTER_KEYS,
  SIMPLE_NAMED_LEAD_FILTERS,
  isNamedLeadFilter,
  simpleNamedLeadFilterWhere,
  wantsClosedOut,
} from '@/lib/leads/namedFilters';
import { AppError } from '@/lib/errors';

/**
 * `?filter=overdue` used to be a 500.
 *
 * `Buffer.from(x, 'base64url')` accepts anything, drops what is not in the
 * alphabet, and returns bytes. The name decoded to `a2 f7 ab 76 e7`, `JSON.parse`
 * threw on the replacement characters, nothing caught it, and the browser console
 * showed `PrismaClientKnownRequestError` for a malformed query parameter.
 */
describe('decodeFilterTree', () => {
  const encode = (tree: unknown) => Buffer.from(JSON.stringify(tree), 'utf8').toString('base64url');

  it('refuses a name with a 422 that says which field, not a 500', () => {
    for (const name of ['overdue', 'mine', 'breached', 'unassigned', 'high_score', 'closed_out']) {
      let thrown: unknown;
      try {
        decodeFilterTree(name);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${name} must be refused`).toBeInstanceOf(AppError);
      expect((thrown as AppError).status).toBe(422);
      expect(JSON.stringify(thrown)).toContain('filter');
    }
  });

  it('refuses base64 that decodes to something that is not a filter tree', () => {
    expect(() => decodeFilterTree(encode({ nonsense: true }))).toThrow(AppError);
    expect(() => decodeFilterTree(encode('a string'))).toThrow(AppError);
    expect(() => decodeFilterTree('!!!!')).toThrow(AppError);
    expect(() => decodeFilterTree('')).toThrow(AppError);
  });

  it('still accepts a real filter tree', () => {
    const tree = { op: 'AND', children: [{ field: 'score', cmp: 'gte', value: 70 }] };
    expect(decodeFilterTree(encode(tree))).toEqual(tree);
  });

  it('never throws anything but an AppError, whatever it is handed', () => {
    const inputs = [
      'overdue',
      '',
      '!!!',
      'x'.repeat(5000),
      '💥',
      'eyJvcCI6',
      Buffer.from([0xff, 0xfe]).toString('base64url'),
    ];
    for (const input of inputs) {
      try {
        decodeFilterTree(input);
      } catch (error) {
        expect(error, `input ${JSON.stringify(input.slice(0, 20))}`).toBeInstanceOf(AppError);
      }
    }
  });
});

describe('named lead filters', () => {
  it('is the single definition the screen, the export and the API all read', () => {
    const page = readFileSync('src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx', 'utf8');
    const exportRoute = readFileSync('src/app/api/v1/leads/export/route.ts', 'utf8');
    const listRoute = readFileSync('src/app/api/v1/leads/route.ts', 'utf8');
    for (const [name, source] of [
      ['screen', page],
      ['export', exportRoute],
      ['list API', listRoute],
    ] as const) {
      expect(source, `${name} must read the shared map`).toContain('@/lib/leads/namedFilters');
    }
    // No private copy may come back: a second literal map is how `mine` came to
    // exist on the screen and not in the export.
    for (const source of [page, exportRoute]) {
      expect(source).not.toMatch(/unassigned:\s*\(\)\s*=>\s*\(\{\s*ownerId:\s*null/);
    }
  });

  it('answers every name the dashboard links to', () => {
    // sales/page.tsx links to breached, overdue and unassigned.
    for (const key of ['breached', 'overdue', 'unassigned']) expect(isNamedLeadFilter(key)).toBe(true);
  });

  it('builds the fragment each simple name means', () => {
    const now = new Date('2026-09-22T00:00:00Z');
    expect(simpleNamedLeadFilterWhere('unassigned', now, 'u1')).toEqual({ ownerId: null });
    expect(simpleNamedLeadFilterWhere('mine', now, 'u1')).toEqual({ ownerId: 'u1' });
    expect(simpleNamedLeadFilterWhere('breached', now, 'u1')).toEqual({ slaState: 'BREACHED' });
    expect(simpleNamedLeadFilterWhere('high_score', now, 'u1')).toEqual({ score: { gte: 70 } });
  });

  it('returns null rather than an empty filter for what it does not answer', () => {
    // Null must never be read as "matches everything": `overdue` is built by the
    // obligation service, and an unknown name is not a filter at all.
    const now = new Date();
    expect(simpleNamedLeadFilterWhere('overdue', now, 'u1')).toBeNull();
    expect(simpleNamedLeadFilterWhere('not-a-filter', now, 'u1')).toBeNull();
    expect(simpleNamedLeadFilterWhere(undefined, now, 'u1')).toBeNull();
    expect(isNamedLeadFilter('not-a-filter')).toBe(false);
  });

  it('lists overdue as a name even though it has no stored fragment', () => {
    expect(NAMED_LEAD_FILTER_KEYS).toContain('overdue');
    expect(Object.keys(SIMPLE_NAMED_LEAD_FILTERS)).not.toContain('overdue');
  });

  it('knows that closed_out is the one view asking for closed-out leads', () => {
    expect(wantsClosedOut('closed_out')).toBe(true);
    for (const key of ['overdue', 'mine', 'breached', undefined]) expect(wantsClosedOut(key)).toBe(false);
  });
});
