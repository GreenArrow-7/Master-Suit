import { describe, expect, it, vi } from 'vitest';

/**
 * The phone's four tabs, filtered by what the signed-in person may open.
 *
 * The bar used to take the workspace's modules and the current path and
 * nothing else, so it was drawn from what the *company* owns rather than what
 * the *person* may reach: an employee in a Sales workspace was given Leads and
 * Calls tabs that the server refused. Four tabs are the whole of the
 * navigation on a phone, so two of them being closed doors is most of it.
 *
 * Rendered rather than asserted against an exported helper, because the
 * filtering is the component's own and an exported copy could drift from it.
 */
let pathname = '/acme/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
      createElement('a', { href, ...rest }, children as never),
  };
});

const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');
const MobileTabBar = (await import('@/components/workspace/MobileTabBar')).default;

/**
 * The tab labels the bar renders, in order, without the trailing "Menu"
 * button — that is the drawer, not one of the four destinations, and it is
 * there for everyone.
 */
function labels(opts: { path: string; modules: string[]; permitted: string[] }) {
  pathname = opts.path;
  const html = renderToStaticMarkup(
    createElement(MobileTabBar, { slug: 'acme', modules: opts.modules, permitted: opts.permitted }),
  );
  return [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]!).filter((label) => label !== 'Menu');
}

const SALES_FULL = ['leads:VIEW', 'calls:VIEW', 'tasks:VIEW'];

describe('the phone tab bar', () => {
  it('gives a sales agent their day', () => {
    expect(labels({ path: '/acme/dashboard', modules: ['SALES'], permitted: SALES_FULL })).toEqual([
      'Home',
      'Leads',
      'Calls',
      'Tasks',
    ]);
  });

  it('does not offer an employee the Leads and Calls tabs the server would refuse', () => {
    const shown = labels({ path: '/acme/dashboard', modules: ['SALES'], permitted: [] });
    expect(shown).not.toContain('Leads');
    expect(shown).not.toContain('Calls');
  });

  it('gives that employee a usable bar instead of one tab and three closed doors', () => {
    const shown = labels({ path: '/acme/dashboard', modules: ['SALES'], permitted: [] });
    expect(shown).toEqual(['Home', 'Check in', 'My Leave', 'My Tasks']);
  });

  it('keeps a tab the person does hold', () => {
    const shown = labels({ path: '/acme/dashboard', modules: ['SALES'], permitted: ['tasks:VIEW'] });
    expect(shown).toContain('Tasks');
    expect(shown).not.toContain('Leads');
  });

  it('never renders more than four', () => {
    for (const permitted of [[], ['leads:VIEW'], SALES_FULL, [...SALES_FULL, 'employee:VIEW', 'visits:VIEW']])
      expect(labels({ path: '/acme/dashboard', modules: ['SALES'], permitted }).length).toBeLessThanOrEqual(4);
  });

  it('hides the employee directory from someone who cannot read it', () => {
    const shown = labels({ path: '/acme/people/leave', modules: ['HRMS'], permitted: [] });
    expect(shown).not.toContain('People');
    // Check-in and leave are self-service: every member keeps them.
    expect(shown).toContain('Check in');
  });

  it('shows the directory to HR', () => {
    const shown = labels({ path: '/acme/people/leave', modules: ['HRMS'], permitted: ['employee:VIEW'] });
    expect(shown).toContain('People');
  });

  it('filters the Real Estate and Lead Eagle bars the same way', () => {
    for (const [path, product] of [
      ['/acme/realty/dashboard', 'realty'],
      ['/acme/lead-eagle/dashboard', 'lead-eagle'],
    ] as const) {
      const modules = [product === 'realty' ? 'REAL_ESTATE' : 'LEAD_EAGLE'];
      expect(labels({ path, modules, permitted: ['leads:VIEW', 'calls:VIEW', 'visits:VIEW'] }), product).toEqual([
        'Home',
        'Leads',
        'Calls',
        'Visits',
      ]);
      const bare = labels({ path, modules, permitted: [] });
      expect(bare, product).not.toContain('Leads');
      expect(bare, product).not.toContain('Visits');
    }
  });
});
