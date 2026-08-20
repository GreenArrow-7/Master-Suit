/**
 * The filter allow-list, checked against the database it filters.
 *
 * FIELD_MAP is hand-written, and three separate things can be wrong with a
 * hand-written map — each of which surfaces as a 500 to a caller who did nothing
 * wrong, or as a route that silently offers a filter it cannot compile:
 *
 *   1. A `path` naming a column that does not exist (a rename, a typo).
 *   2. A `nullable` flag that disagrees with the schema, which makes
 *      `is_null` / `is_not_null` either reject a valid query or emit a filter
 *      Prisma refuses to build.
 *   3. An object a route compiles against with no map registered at all — the
 *      shape the assessment found, where every route but `leads` advertised a
 *      `filter` parameter that returned 400 "unknown-object" for any value.
 *
 * All three are checked here against prisma/schema.prisma and the route sources,
 * so the map cannot drift from either.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FIELD_MAP, compileFilterTree } from '@/lib/api/filterTree';

const root = path.resolve(__dirname, '../..');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

interface Column {
  type: string;
  list: boolean;
  nullable: boolean;
}

/** Enough of a Prisma parser for `name Type[]? @attrs` — which is every line that matters here. */
function parseModels(source: string): Map<string, Map<string, Column>> {
  const models = new Map<string, Map<string, Column>>();
  for (const model of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const columns = new Map<string, Column>();
    for (const line of model[2]!.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(trimmed);
      if (!field) continue;
      columns.set(field[1]!, { type: field[2]!, list: Boolean(field[3]), nullable: Boolean(field[4]) });
    }
    models.set(model[1]!, columns);
  }
  return models;
}

const models = parseModels(schema);

/** The filter object name as routes spell it, to the Prisma model it filters. */
const MODEL_OF: Record<string, string> = {
  LEAD: 'Lead',
  OPPORTUNITY: 'Opportunity',
  CONTACT: 'Contact',
  ACCOUNT: 'Account',
};

/** Walks `stage.key` through the relation to PipelineStage.key. */
function resolve(model: string, fieldPath: string): Column | null {
  const parts = fieldPath.split('.');
  const first = models.get(model)?.get(parts[0]!);
  if (!first) return null;
  if (parts.length === 1) return first;
  return models.get(first.type)?.get(parts[1]!) ?? null;
}

describe('FIELD_MAP agrees with the schema', () => {
  it('every registered object names a real model', () => {
    for (const object of Object.keys(FIELD_MAP)) {
      expect(MODEL_OF[object], `${object} has no model mapping in this test`).toBeDefined();
      expect(models.has(MODEL_OF[object]!), `${MODEL_OF[object]} is not a model`).toBe(true);
    }
  });

  it('every path resolves to a real column', () => {
    const broken: string[] = [];
    for (const [object, fields] of Object.entries(FIELD_MAP)) {
      for (const [name, spec] of Object.entries(fields)) {
        if (!resolve(MODEL_OF[object]!, spec.path)) broken.push(`${object}.${name} -> ${spec.path}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every nullable flag matches the column', () => {
    const wrong: string[] = [];
    for (const [object, fields] of Object.entries(FIELD_MAP)) {
      for (const [name, spec] of Object.entries(fields)) {
        const column = resolve(MODEL_OF[object]!, spec.path)!;
        if (Boolean(spec.nullable) !== column.nullable) {
          wrong.push(
            `${object}.${name} is ${spec.nullable ? 'marked' : 'not marked'} nullable; schema says ${column.nullable}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every array-typed entry is a scalar list in the schema, and vice versa', () => {
    const wrong: string[] = [];
    for (const [object, fields] of Object.entries(FIELD_MAP)) {
      for (const [name, spec] of Object.entries(fields)) {
        const column = resolve(MODEL_OF[object]!, spec.path)!;
        if ((spec.type === 'array') !== column.list) wrong.push(`${object}.${name}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never exposes tenantId or deletedAt to a caller-supplied filter', () => {
    // Both are set by the query builders that wrap compileFilterTree. A filter
    // able to name either could widen a query past its tenant or resurrect
    // soft-deleted rows, because a later fragment used to overwrite an earlier
    // one — and even under mergeWhere, offering them is offering nothing good.
    const exposed: string[] = [];
    for (const [object, fields] of Object.entries(FIELD_MAP)) {
      for (const [name, spec] of Object.entries(fields)) {
        if (/^(tenantId|deletedAt)$/.test(spec.path) || /^(tenantId|deletedAt)$/.test(name)) {
          exposed.push(`${object}.${name}`);
        }
      }
    }
    expect(exposed).toEqual([]);
  });
});

/** Every `compileFilterTree('X', …)` in the app, with X. */
function compiledObjects(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(full, 'utf8');
      for (const call of source.matchAll(/compileFilterTree\(\s*'(\w+)'/g)) {
        const rel = path.relative(root, full);
        found.set(call[1]!, [...(found.get(call[1]!) ?? []), rel]);
      }
    }
  };
  walk(path.join(root, 'src'));
  return found;
}

describe('every object a route compiles has a map', () => {
  it('no caller compiles against an unregistered object', () => {
    // This is the assessment finding itself, as a test: `leads` was the only
    // route whose `filter` parameter could ever succeed. The other three parsed
    // the tree, validated it against field security, and then threw
    // "No filter map registered for OPPORTUNITY."
    const unregistered = [...compiledObjects()]
      .filter(([object]) => !(object in FIELD_MAP))
      .map(([object, files]) => `${object} (${files.join(', ')})`);
    expect(unregistered).toEqual([]);
  });

  it('finds the callers it claims to scan', () => {
    // Guards the scanner: a regex that silently matched nothing would make the
    // test above pass forever, which is exactly how this gap survived.
    const objects = compiledObjects();
    expect(objects.size).toBeGreaterThanOrEqual(4);
    expect(objects.has('LEAD')).toBe(true);
  });
});

describe('null checks compile to something Prisma can build', () => {
  // compileFilterTree only reads these three off the context, to resolve the
  // `$currentUser` tokens that keep a saved view portable between users.
  const ctx = { actor: { id: 'u1', teamIds: ['t1'], branchId: 'b1' } } as never;
  const leaf = (field: string, cmp: string) => ({ field, cmp }) as never;

  it('is_null on a nullable column compares to null', () => {
    expect(compileFilterTree('LEAD', leaf('email', 'is_null'), ctx)).toEqual({ email: null });
  });

  it('is_not_null uses the nested `not`, not a NOT wrapper', () => {
    // `{ NOT: { email: null } }` is the intuitive form and the one this used to
    // emit. Prisma rejects it — inside NOT a null value reads as "argument not
    // provided" — so every is_not_null filter in the product was a 500.
    expect(compileFilterTree('LEAD', leaf('email', 'is_not_null'), ctx)).toEqual({ email: { not: null } });
  });

  it('nests through a relation path', () => {
    expect(compileFilterTree('OPPORTUNITY', leaf('lead.id', 'is_not_null'), ctx)).toEqual({ leadId: { not: null } });
  });

  it('refuses a null check on a required column with a 400, not a 500', () => {
    // `createdAt` is `DateTime @default(now())`. Prisma builds a filter type for
    // a required column with nowhere to put a null, so the question cannot be
    // asked at all — and a caller deserves to be told that rather than handed a
    // server error.
    expect(() => compileFilterTree('LEAD', leaf('createdAt', 'is_null'), ctx)).toThrow(/never be null/i);
    expect(() => compileFilterTree('LEAD', leaf('createdAt', 'is_not_null'), ctx)).toThrow(/never be null/i);
  });

  it('refuses a null check on a scalar list', () => {
    // A list column is empty, never null; `{ tags: null }` is not a question.
    expect(() => compileFilterTree('LEAD', leaf('tags', 'is_null'), ctx)).toThrow(/is a list/i);
  });

  it('still rejects a field that is not on the allow-list', () => {
    expect(() => compileFilterTree('LEAD', leaf('notes', 'is_null'), ctx)).toThrow(/Cannot filter on/i);
  });
});
