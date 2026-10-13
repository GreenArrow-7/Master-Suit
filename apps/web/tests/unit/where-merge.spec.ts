/**
 * mergeWhere, at the unit level.
 *
 * tests/permission/visibility-where-merge.spec.ts proves the security property
 * end to end, through a real route and a real database. This file pins the two
 * things that make the fix *safe to adopt everywhere*: that `tenantId` stays
 * where lib/db.ts looks for it, and that a merge with nothing to conjoin still
 * produces the same shape the codebase produced before.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { mergeWhere } from '@/lib/api/where';
import { cursorWhere, encodeCursor } from '@/lib/api/pagination';

const scope = { tenantId: 't1', OR: [{ ownerId: { in: ['u1'] } }, { ownerId: null }] };

describe('mergeWhere', () => {
  it('conjoins two ORs instead of keeping only the last', () => {
    const filter = { OR: [{ grade: 'A' }] };
    expect(mergeWhere(scope, filter)).toEqual({
      tenantId: 't1',
      AND: [{ OR: scope.OR }, { OR: filter.OR }],
    });
  });

  it('keeps tenantId at the top level, where the tenant guard and RLS pinning read it', () => {
    // lib/db.ts throws TenantGuardError on a read whose `where` has no top-level
    // tenantId, and resolveTenantId reads the same key to set app.tenant_id. A
    // merge that buried it would break every list query and disable RLS pinning
    // in the same stroke — silently, because the query would still return rows.
    const merged = mergeWhere(scope, { OR: [{ grade: 'A' }] }, { OR: [{ id: { lt: 'c' } }] });
    expect(merged.tenantId).toBe('t1');
  });

  it('does not wrap when there is nothing to collide with', () => {
    expect(mergeWhere({ tenantId: 't1' }, { status: 'OPEN' })).toEqual({ tenantId: 't1', status: 'OPEN' });
  });

  it('leaves a single OR unwrapped, so simple queries keep the shape they had', () => {
    expect(mergeWhere({ tenantId: 't1' }, { OR: [{ grade: 'A' }] })).toEqual({
      tenantId: 't1',
      OR: [{ grade: 'A' }],
    });
  });

  it('narrows rather than replaces when two fragments constrain the same field', () => {
    // The site-visit queues relied on this: `queue=verification` pins status,
    // and a `status=` in the same request used to overwrite that pin.
    expect(mergeWhere({ status: { in: ['A', 'B'] } }, { status: 'C' })).toEqual({
      status: { in: ['A', 'B'] },
      AND: [{ status: 'C' }],
    });
  });

  it('skips null, undefined and absent fragments', () => {
    expect(mergeWhere({ tenantId: 't1' }, null, undefined, {})).toEqual({ tenantId: 't1' });
  });

  it('drops undefined values rather than sending them to Prisma', () => {
    // `{ ownerId: undefined }` is "no filter" to Prisma but "key present" to the
    // collision check — keeping it would push a later real ownerId into AND
    // against a filter that does not exist.
    expect(mergeWhere({ tenantId: 't1', ownerId: undefined }, { ownerId: 'u1' })).toEqual({
      tenantId: 't1',
      ownerId: 'u1',
    });
  });

  it('conjoins a NOT, which never composes by assignment either', () => {
    expect(mergeWhere({ NOT: { a: 1 } }, { NOT: { b: 2 } })).toEqual({
      AND: [{ NOT: { a: 1 } }, { NOT: { b: 2 } }],
    });
  });

  it('preserves an existing AND alongside a new one', () => {
    const listing = { tenantId: 't1', AND: [{ price: { gte: 1 } }] };
    const cursor = { OR: [{ id: { lt: 'c' } }] };
    expect(mergeWhere(listing, cursor)).toEqual({
      tenantId: 't1',
      AND: [{ AND: [{ price: { gte: 1 } }] }, { OR: [{ id: { lt: 'c' } }] }],
    });
  });

  it('is associative over the fragments it is given', () => {
    const a = { tenantId: 't1', OR: [{ x: 1 }] };
    const b = { OR: [{ y: 2 }] };
    const c = { OR: [{ z: 3 }] };
    expect(mergeWhere(a, b, c)).toEqual({ tenantId: 't1', AND: [{ OR: a.OR }, { OR: b.OR }, { OR: c.OR }] });
  });
});

/**
 * The keyset predicate (M4-20). `(updatedAt, id) < cursor` as an OR alone is a
 * filter, so Postgres walked the list index from the first row to reach page
 * 200 (an agent's in a 100,000-lead workspace: 52,000 rows, 130 ms). The bound
 * on the sort key selects the same rows and lets the index seek to the page.
 */
describe('cursorWhere', () => {
  const at = '2026-08-01T15:37:59.450Z';
  const cursor = encodeCursor({ updatedAt: at, id: 'c9' });

  it('bounds updatedAt, so the index seeks to the page instead of filtering from the first row', () => {
    expect(cursorWhere(cursor)).toEqual({
      updatedAt: { lte: new Date(at) },
      OR: [{ updatedAt: { lt: new Date(at) } }, { updatedAt: new Date(at), id: { lt: 'c9' } }],
    });
  });

  it('narrows a date chip on the same column rather than replacing it', () => {
    const chip = { updatedAt: { gte: new Date('2026-01-01T00:00:00Z') } };
    const where = mergeWhere(scope, chip, cursorWhere(cursor)) as { updatedAt: unknown; AND: unknown[] };
    expect(where.updatedAt).toEqual(chip.updatedAt);
    expect(where.AND).toContainEqual({ updatedAt: { lte: new Date(at) } });
  });
});

/**
 * The spread this file exists to replace came back twice after mergeWhere was
 * written — the conversation search and the calendar's call dates each set their
 * own `OR` after spreading a visibility scope, which replaced its ownership
 * clause. Spread still reads like "apply both", so this finds the shape anywhere
 * in src: a scope spread followed by an `OR` key, or by a spread carrying one.
 */
describe('no query spreads a scope and then sets its own OR', () => {
  it('finds none in src', () => {
    const src = path.join(__dirname, '..', '..', 'src');
    const offenders: string[] = [];
    for (const file of readdirSync(src, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(file)) continue;
      const text = readFileSync(path.join(src, file), 'utf8');
      if (!text.includes('OR')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          let scoped = false;
          for (const p of node.properties) {
            const spread = ts.isSpreadAssignment(p) ? p.expression.getText(sf) : null;
            const carriesOr = spread !== null ? /\bOR\s*:/.test(spread) : p.name?.getText(sf) === 'OR';
            if (scoped && carriesOr)
              offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1}`);
            if (spread !== null && /scope|visib/i.test(spread)) scoped = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
