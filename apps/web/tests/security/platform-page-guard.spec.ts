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

const PLATFORM_ROOT = path.resolve(__dirname, '../../src/app/(platform)');

/**
 * Pages that deliberately serve no protected content and therefore need no
 * gate. Every entry needs a reason, and the list is expected to stay empty:
 * anything reachable under `/platform` is control-plane by definition.
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

const pages = pagesUnder(PLATFORM_ROOT).sort();
const rel = (p: string) => path.relative(path.resolve(__dirname, '../..'), p);

describe('platform pages authorize before they read', () => {
  it('finds the platform pages from the filesystem, so a new one cannot escape this suite', () => {
    // Not an exact count: pages may legitimately be added or removed. The point
    // is that the inventory is discovered, and every discovered page is checked
    // below. A hardcoded list of eleven would pass forever while a twelfth
    // shipped unguarded.
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((p) => [rel(p), p]))('%s calls requirePlatformPage() first', (relPath, full) => {
    const source = readFileSync(full, 'utf8');

    if (JUSTIFIED_UNGUARDED[relPath as string]) {
      expect(source).not.toContain('requirePlatformPage');
      return;
    }

    expect(source, `${relPath} does not import the platform page guard`).toContain("from '@/lib/platform-page'");

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

    expect(firstStatement, `${relPath} must await requirePlatformPage() as its first statement`).toBe(
      'await requirePlatformPage();',
    );
  });

  it('no platform page module exports a second entry point that renders protected content', () => {
    // `ai-usage/page.tsx` once exported its own body so a test could render it
    // without a request scope, which put a function capable of producing the
    // whole protected page on the route module with no gate in front of it.
    // A route module exports its default, and Next's own config values.
    const ALLOWED = new Set(['default', 'dynamic', 'metadata', 'revalidate', 'runtime', 'generateMetadata']);
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/gm)].map(
        (m) => m[1],
      );
      const extra = exported.filter((name) => !ALLOWED.has(name));
      expect(extra, `${rel(page)} exports ${extra.join(', ')} beside its default`).toEqual([]);
    }
  });
});
