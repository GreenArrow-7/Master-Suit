import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeModule } from '@/lib/nav/workspaceNav';

/**
 * One product module, four declarations, and nothing making them agree.
 *
 * `ModuleKey` in the schema is authoritative, but the application restates it as
 * hand-maintained TypeScript in three more places: `ProductModule` and
 * `PRODUCT_MODULES` in lib/security/entitlements.ts, and the `Module` union in
 * lib/nav/workspaceNav.ts. Adding REAL_ESTATE meant editing all four, and the
 * typecheck only caught it because a route happened to reference the new value —
 * a module added to the schema and used nowhere yet would have drifted silently
 * until something refused at runtime.
 *
 * Read from source rather than imported, because `PRODUCT_MODULES` and `Module`
 * are not exported and should not become exported for a test's convenience. Same
 * approach as filter-field-maps.spec.ts, which checks its maps against this same
 * schema file.
 *
 * This is a drift check, not a type system. If the four lists agree, it passes.
 */
const root = path.join(__dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** The values of a Prisma enum block, in declaration order. */
function prismaEnum(schema: string, name: string): string[] {
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (!block) throw new Error(`enum ${name} not found in schema.prisma`);
  return block[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

/** The members of a single-line TypeScript string-literal union. */
function tsUnion(source: string, declaration: RegExp): string[] {
  const line = declaration.exec(source);
  if (!line) throw new Error(`declaration ${declaration} not found`);
  return [...line[1]!.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]!);
}

const schemaModules = prismaEnum(read('prisma/schema.prisma'), 'ModuleKey');
const entitlements = read('src/lib/security/entitlements.ts');
const nav = read('src/lib/nav/workspaceNav.ts');

describe('the product module list does not drift', () => {
  it('finds a non-trivial list to check', () => {
    // A parser that quietly matched nothing would make every assertion below
    // pass against two empty arrays.
    expect(schemaModules.length).toBeGreaterThanOrEqual(2);
    expect(schemaModules).toContain('REAL_ESTATE');
  });

  it('ProductModule matches ModuleKey', () => {
    const declared = tsUnion(entitlements, /export type ProductModule = ([^;]+);/);
    expect([...declared].sort()).toEqual([...schemaModules].sort());
  });

  it('PRODUCT_MODULES matches ModuleKey', () => {
    const declared = tsUnion(entitlements, /const PRODUCT_MODULES = \[([^\]]+)\]/);
    expect([...declared].sort()).toEqual([...schemaModules].sort());
  });

  it("the navigation's Module union matches ModuleKey", () => {
    const declared = tsUnion(nav, /type Module = ([^;]+);/);
    expect([...declared].sort()).toEqual([...schemaModules].sort());
  });
});

describe('activeModule answers for every product', () => {
  it('reads the URL segment first', () => {
    expect(activeModule('/acme/realty/leads', ['SALES', 'REAL_ESTATE'])).toBe('realty');
    expect(activeModule('/acme/sales/leads', ['SALES', 'REAL_ESTATE'])).toBe('sales');
    expect(activeModule('/acme/people/leave', ['SALES', 'HRMS'])).toBe('people');
  });

  /**
   * A shared route (`/{slug}/dashboard`) has to pick one tab bar. Picking a
   * product the workspace is not entitled to would offer a phone user four links
   * that all refuse.
   */
  it('falls back to something the workspace actually owns', () => {
    expect(activeModule('/acme/dashboard', ['REAL_ESTATE'])).toBe('realty');
    expect(activeModule('/acme/dashboard', ['HRMS'])).toBe('people');
    // SALES keeps its existing answer, so no entitled workspace moves.
    expect(activeModule('/acme/dashboard', ['SALES', 'REAL_ESTATE'])).toBe('sales');
  });
});
