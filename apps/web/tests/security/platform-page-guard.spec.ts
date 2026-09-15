/**
 * Every platform console page must authorize before it does anything else.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * `BUG-008` / `SEC-OBS-014`: the console's only gate was its layout, and in the
 * App Router a layout cannot stop the page beneath it rendering. The refusal
 * set the status and `Location` while the page's output was serialised into the
 * flight payload of that same response — workspace names, the owner's address,
 * platform-wide counts and the security ledger, to a caller with no session.
 *
 * The fix puts `requirePlatformPage()` above the queries on every page. That is
 * correct and it is also fragile in one specific way: **it depends on the next
 * person remembering.** A twelfth page added without the call reopens the
 * vulnerability silently, and nothing in review reliably catches an omission.
 *
 * So the inventory is derived from the filesystem rather than written down
 * here. A new page is included automatically and fails until it is guarded.
 * Deleting a page is fine. Adding an unguarded one is not.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every staff-only route group, and the guard each one's pages must call.
 *
 * Two entries rather than one root, because there are now two staff surfaces
 * with different gates: `(platform)` is the control plane and is OWNER-only;
 * `(monitoring)` is the read-only console SUPPORT and SECURITY_AUDITOR reach.
 * Both inherit BUG-008's problem — a layout cannot stop the page beneath it
 * rendering — so both need the check above the queries, and a new group added
 * here is a new group this suite covers.
 */
const GUARDED_ROOTS = [
  {
    root: path.resolve(__dirname, '../../src/app/(platform)'),
    guard: 'requirePlatformPage',
    module: '@/lib/platform-page',
  },
  {
    root: path.resolve(__dirname, '../../src/app/(monitoring)'),
    guard: 'requireMonitoringPage',
    module: '@/lib/monitoring-page',
  },
] as const;

/**
 * Pages that deliberately serve no protected content and therefore need no
 * gate. Every entry needs a reason, and the list is expected to stay empty:
 * anything reachable under `/platform` or `/monitoring` is staff-only by
 * definition.
 */
const JUSTIFIED_UNGUARDED: Record<string, string> = {};

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

const rel = (p: string) => path.relative(path.resolve(__dirname, '../..'), p);
/** Every discovered page, carrying the guard its own route group requires. */
const pages = GUARDED_ROOTS.flatMap(({ root, guard, module }) =>
  pagesUnder(root)
    .sort()
    .map((full) => ({ full, guard, module })),
);

describe('platform pages authorize before they read', () => {
  it('finds the platform pages from the filesystem, so a new one cannot escape this suite', () => {
    // Not an exact count: pages may legitimately be added or removed. The point
    // is that the inventory is discovered, and every discovered page is checked
    // below. A hardcoded list of eleven would pass forever while a twelfth
    // shipped unguarded.
    expect(pages.length).toBeGreaterThan(0);
    // Both surfaces are actually represented, so a mistyped root that silently
    // discovers nothing fails here rather than passing vacuously.
    for (const { root } of GUARDED_ROOTS) expect(pagesUnder(root).length).toBeGreaterThan(0);
  });

  it.each(pages.map((p) => [rel(p.full), p]))('%s calls its route group guard first', (relPath, page) => {
    const { full, guard, module } = page as { full: string; guard: string; module: string };
    const source = readFileSync(full, 'utf8');

    if (JUSTIFIED_UNGUARDED[relPath as string]) {
      expect(source).not.toContain(guard);
      return;
    }

    expect(source, `${relPath} does not import the ${guard} page guard`).toContain(`from '${module}'`);

    // The default export is what Next renders. The guard has to be the first
    // statement in it — not merely present somewhere in the file, which a page
    // could satisfy while querying above the call.
    const body = source.slice(source.search(/export default async function \w+\([^)]*\)\s*\{/));
    expect(body, `${relPath} has no default async export`).not.toHaveLength(0);

    const firstStatement = body
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));

    // A page may need the context the guard returns, so both the bare call and
    // `const x = await guard()` are accepted — what is not accepted is anything
    // else running first.
    expect(firstStatement, `${relPath} must await ${guard}() as its first statement`).toMatch(
      new RegExp(`^(const \\w+ = )?await ${guard}\\(\\);$`),
    );
  });

  it('no platform page module exports a second entry point that renders protected content', () => {
    // `ai-usage/page.tsx` once exported its own body so a test could render it
    // without a request scope, which put a function capable of producing the
    // whole protected page on the route module with no gate in front of it.
    // A route module exports its default, and Next's own config values.
    const ALLOWED = new Set(['default', 'dynamic', 'metadata', 'revalidate', 'runtime', 'generateMetadata']);
    for (const { full: page } of pages) {
      const source = readFileSync(page, 'utf8');
      const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/gm)].map(
        (m) => m[1],
      );
      const extra = exported.filter((name) => !ALLOWED.has(name));
      expect(extra, `${rel(page)} exports ${extra.join(', ')} beside its default`).toEqual([]);
    }
  });
});
