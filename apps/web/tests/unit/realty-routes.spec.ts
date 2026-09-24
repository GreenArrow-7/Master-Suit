import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Real Estate reuses Sales' client register rather than copying it.
 *
 * The brief was explicit: no `RealEstateLead`, no `RealEstateCall`, no second
 * implementation of a register that already exists. Leads, follow-ups, calls and
 * site visits are one set of rows read by two products, so the `realty/` routes
 * re-export the `sales/` pages and there is deliberately nothing else in them.
 *
 * That arrangement has three ways to rot, and this file guards each:
 *
 *   1. Somebody "fixes" a Real Estate screen by pasting the Sales page into the
 *      realty route and editing it. The two then drift, which is the exact
 *      outcome the no-duplicate-entities rule exists to prevent.
 *   2. A re-export points at a file that has moved, which typecheck catches for
 *      a bad path but not for a route silently left behind.
 *   3. A shared page's entitlement is reverted to `module: 'SALES'`. Typecheck
 *      is happy — and every Real Estate workspace is refused the screen at
 *      runtime, because it does not own Sales.
 *
 * Read from source rather than imported: importing a server component here would
 * drag Prisma, Redis and `next/headers` into a unit test to assert something
 * that is a property of the file's text.
 */
const web = path.join(__dirname, '..', '..');
const APP = path.join(web, 'src', 'app', '(workspace)', '[workspaceSlug]');
const read = (file: string) => readFileSync(file, 'utf8');

/** Every `page.tsx` beneath a module root, as a module-relative route. */
function pages(moduleRoot: string): string[] {
  const root = path.join(APP, moduleRoot);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'page.tsx') out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/** The registers Real Estate shares with Sales, as route prefixes. */
const SHARED = ['leads', 'follow-ups', 'calls', 'site-visits'];
const isShared = (route: string) =>
  SHARED.some((prefix) => route === `${prefix}/page.tsx` || route.startsWith(`${prefix}/`));

const realtyRoutes = pages('realty');
const sharedRealtyRoutes = realtyRoutes.filter(isShared);

describe('the shared registers exist under Real Estate', () => {
  it('finds routes to check', () => {
    // A walker that matched nothing would make every assertion below vacuous.
    expect(sharedRealtyRoutes.length).toBeGreaterThanOrEqual(11);
  });

  it('covers every shared register Sales has a screen for', () => {
    const sales = pages('sales').filter(isShared).sort();
    expect(sharedRealtyRoutes.sort()).toEqual(sales);
  });
});

describe('the Real Estate routes re-export rather than reimplement', () => {
  it.each(sharedRealtyRoutes)('%s is a re-export of its Sales page', (route) => {
    const source = read(path.join(APP, 'realty', route));

    // A re-export and its comment, and nothing that queries or authorises.
    expect(source).toMatch(/^export \{ default(, metadata)? \} from '/m);
    for (const forbidden of ['prisma', 'requirePageAccess', 'visibilityWhere', 'useState']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each(sharedRealtyRoutes)('%s points at a file that exists', (route) => {
    const source = read(path.join(APP, 'realty', route));
    const target = /from '(\.[^']+)'/.exec(source);
    expect(target, `${route} has no relative re-export`).not.toBeNull();
    const resolved = path.join(path.dirname(path.join(APP, 'realty', route)), `${target![1]!}.tsx`);
    expect(existsSync(resolved), `${route} re-exports ${target![1]} which does not exist`).toBe(true);
    // And it is the Sales page, not another realty file pretending to be one.
    expect(resolved).toContain(`${path.sep}sales${path.sep}`);
  });
});

describe('the shared Sales pages admit a Real Estate workspace', () => {
  const salesShared = pages('sales').filter(isShared);

  it.each(salesShared)('%s asserts either product, not Sales alone', (route) => {
    const source = read(path.join(APP, 'sales', route));
    // The failure this catches is silent: `module: 'SALES'` typechecks and
    // refuses every Real Estate workspace the screen at runtime.
    expect(source).not.toMatch(/module: 'SALES'/);
    expect(source).toContain('module: SALES_OR_REALTY');
    expect(source).toContain("from '@/lib/security/entitlements'");
  });
});

describe('module-relative links resolve under Real Estate', () => {
  /**
   * `useModuleBase` derives `/{slug}/realty` from the path and then checks the
   * segment against this list. It produced the right prefix all along; the list
   * was what disagreed, so every Real Estate page warned about its own correct
   * base. A missing entry is a warning today and a wrong assumption tomorrow.
   */
  it('realty is a module root', () => {
    const source = read(path.join(web, 'src', 'components', 'workspace', 'SalesLink.tsx'));
    const list = /const MODULE_ROOTS = new Set\(\[([^\]]+)\]\)/.exec(source);
    expect(list).not.toBeNull();
    const roots = [...list![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(roots).toContain('realty');
    expect(roots).toContain('sales');
  });
});

describe('a refused module is named correctly', () => {
  /**
   * The refusal text was `module === 'HRMS' ? 'HR' : 'Sales'`, which was true
   * for two modules and became a lie on the third: a workspace without Real
   * Estate was told Sales was not enabled — naming a product it may be paying
   * for, and sending the reader to the wrong place.
   */
  it('every product module has its own label', () => {
    const source = read(path.join(web, 'src', 'lib', 'security', 'entitlements.ts'));
    // The throw site specifically — the comment above it quotes the old
    // ternary on purpose, and a test that greps the whole file would fail on
    // the explanation of the bug rather than the bug.
    expect(source).toMatch(/throw Forbidden\(`\$\{MODULE_LABEL\[module\]\}/);
    const block = /const MODULE_LABEL: Record<ProductModule, string> = \{([^}]*)\}/.exec(source);
    expect(block).not.toBeNull();
    const labelled = [...block![1]!.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]);
    const declared = [.../const PRODUCT_MODULES = \[([^\]]+)\]/.exec(source)![1]!.matchAll(/'([A-Z_]+)'/g)].map(
      (m) => m[1],
    );
    expect([...labelled].sort()).toEqual([...declared].sort());
  });
});
