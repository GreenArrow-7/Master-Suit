import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Self check-in is reachable by any workspace, whatever it licenses.
 *
 * This is a filesystem guard rather than a behaviour test because that is the
 * shape the bug took. The page was changed to stop asserting HRMS and it made
 * no difference: `people/layout.tsx` asserts the entitlement for everything
 * beneath it and redirects to the dashboard, so a Sales-only workspace still
 * bounced — and the dashboard's own "Open check-in" link sent them straight
 * back to the dashboard. Nothing failed. No test noticed. The only way to see
 * it was to license one module and click the link.
 *
 * So what is pinned here is the structure: the screen lives outside both
 * module folders, nothing above it gates a module, and every link in the
 * product points at that address.
 */

const web = join(__dirname, '..', '..', 'src');
const workspaceRoot = join(web, 'app', '(workspace)', '[workspaceSlug]');
const checkIn = join(workspaceRoot, 'check-in');

/** Passing a `module:` to either page helper is what asserts an entitlement. */
function gatesAModule(source: string): boolean {
  return /\bmodule:\s*'(HRMS|SALES)'/.test(source);
}

function allTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsx(full));
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('self check-in', () => {
  it('lives outside the module folders', () => {
    expect(existsSync(join(checkIn, 'page.tsx'))).toBe(true);
  });

  it('asserts no product module of its own', () => {
    expect(gatesAModule(readFileSync(join(checkIn, 'page.tsx'), 'utf8'))).toBe(false);
  });

  /**
   * The part that actually broke. A layout gates every route beneath it, so an
   * ungated page under a gated folder is still gated — and reads as if it is not.
   */
  it('has no module gate anywhere above it', () => {
    const layouts = [join(checkIn, 'layout.tsx'), join(workspaceRoot, 'layout.tsx')].filter(existsSync);
    for (const layout of layouts) {
      expect(gatesAModule(readFileSync(layout, 'utf8')), `${layout} gates a module`).toBe(false);
    }
  });

  it('is not somewhere a module layout would capture it', () => {
    for (const folder of ['people', 'sales']) {
      expect(
        existsSync(join(workspaceRoot, folder, 'check-in', 'CheckInConsole.tsx')),
        `the console is back under ${folder}/, where that folder's layout gates it`,
      ).toBe(false);
    }
  });

  /**
   * The old address stays as a redirect, because it was in the navigation, the
   * mobile tab bar and on the dashboard, so it is in people's history.
   */
  it('keeps the old address working', () => {
    const moved = join(workspaceRoot, 'people', 'check-in', 'page.tsx');
    expect(existsSync(moved)).toBe(true);
    expect(readFileSync(moved, 'utf8')).toMatch(/permanentRedirect\(`\/\$\{workspaceSlug\}\/check-in`\)/);
  });

  it('is what every link in the product points at', () => {
    const stale = allTsx(web)
      .filter((file) => !file.includes(join('people', 'check-in')))
      .filter((file) => /['"`][^'"`]*people\/check-in/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(web.length + 1));

    expect(stale, 'these link to the gated address').toEqual([]);
  });
});
