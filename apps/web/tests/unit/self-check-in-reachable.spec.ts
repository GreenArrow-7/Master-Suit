import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNavigation, findActive, NAV_PERMISSIONS, type NavInput, type NavSection } from '@/lib/nav/workspaceNav';

/**
 * Self check-in is reachable by any workspace, whatever it licenses.
 *
 * Checking yourself in is not an HR privilege — the API behind the screen is
 * `selfService` with no module gate — but the screen lived under `people/`,
 * whose layout asserts HRMS for everything beneath it, and the navigation only
 * offered it under People → My HR. A brokerage licensing Sales or Real Estate
 * without People had no way in, and the dashboard's own "Open check-in" link
 * bounced them back to the dashboard.
 *
 * Two halves, because the bug had two halves. The filesystem half pins where
 * the screen lives, since a module gate inherited from a layout fails no
 * behaviour test and reads as if it is not there. The navigation half pins that
 * every kind of workspace is actually offered the link.
 */

const web = join(__dirname, '..', '..', 'src');
const workspaceRoot = join(web, 'app', '(workspace)', '[workspaceSlug]');
const checkIn = join(workspaceRoot, 'check-in');

/** Passing a `module:` to either page helper is what asserts an entitlement. */
function gatesAModule(source: string): boolean {
  return /\bmodule:\s*'(HRMS|SALES|REAL_ESTATE)'/.test(source);
}

function allSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSources(full));
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('self check-in: where the screen lives', () => {
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
    const stale = allSources(web)
      .filter((file) => !file.includes(join('people', 'check-in')))
      // The navigation holds the old address as an alias of the new tab, on purpose.
      .filter((file) => !file.endsWith(join('nav', 'workspaceNav.ts')))
      .filter((file) => /['"`][^'"`]*people\/check-in/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(web.length + 1));

    expect(stale, 'these link to the gated address').toEqual([]);
  });
});

describe('self check-in: the navigation offers it to every workspace, once', () => {
  const SLUG = 'ws';
  const base: NavInput = { slug: SLUG, modules: [], permitted: NAV_PERMISSIONS, peopleOversight: false };

  /** Every area offering the check-in screen, by key. */
  const offeredIn = (sections: NavSection[]) =>
    sections
      .flatMap((section) => section.areas)
      .filter((area) => area.tabs.some((tab) => tab.href === `/${SLUG}/check-in`))
      .map((area) => area.key);

  /**
   * Where People is licensed, My HR files it beside My Attendance and My Leave —
   * the navigation's own design. Everywhere else it has to be somewhere, and
   * Home is the one area every workspace has. Never both: two links to one
   * screen is two places to look.
   */
  it.each([
    ['Sales only', ['SALES'], 'my-workspace'],
    ['Real Estate only', ['REAL_ESTATE'], 'my-workspace'],
    ['Sales and Real Estate', ['SALES', 'REAL_ESTATE'], 'my-workspace'],
    ['People only', ['HRMS'], 'my-hr'],
    ['everything', ['SALES', 'HRMS', 'REAL_ESTATE'], 'my-hr'],
  ] as const)('%s → %s', (_label, modules, area) => {
    expect(offeredIn(buildNavigation({ ...base, modules: [...modules] }))).toEqual([area]);
  });

  it.each([
    ['Sales only', ['SALES'], 'my-workspace'],
    ['with People', ['SALES', 'HRMS'], 'my-hr'],
  ] as const)('still lands the old address on the tab that is shown — %s', (_label, modules, area) => {
    const nav = buildNavigation({ ...base, modules: [...modules] });
    const found = findActive(nav, `/${SLUG}/people/check-in`, new URLSearchParams());
    expect(found?.area.key).toBe(area);
    expect(found?.tab.href).toBe(`/${SLUG}/check-in`);
  });

  it('gives a platform service identity none — it has no attendance of its own', () => {
    const nav = buildNavigation({ ...base, modules: ['SALES', 'HRMS', 'REAL_ESTATE'], serviceMode: true });
    expect(offeredIn(nav)).toEqual([]);
  });
});
