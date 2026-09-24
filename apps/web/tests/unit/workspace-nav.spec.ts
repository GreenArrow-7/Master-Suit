import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeModule,
  buildNavigation,
  findActive,
  NAV_PERMISSIONS,
  tabTarget,
  type NavInput,
  type NavSection,
} from '@/lib/nav/workspaceNav';

/**
 * The work-area navigation model: which areas and tabs a role sees, which one a
 * URL belongs to, and that no existing screen fell out of the navigation.
 */

const SLUG = 'ws';
const everything: NavInput = {
  slug: SLUG,
  // Every module, or the screen-coverage check below silently skips a whole
  // product's routes — which is how a Real Estate screen could ship unreachable.
  modules: ['SALES', 'HRMS', 'REAL_ESTATE'],
  permitted: NAV_PERMISSIONS,
  peopleOversight: true,
};
const at = (sections: NavSection[], url: string) => {
  const [path, query] = url.split('?');
  const found = findActive(sections, path!, new URLSearchParams(query ?? ''));
  return found ? `${found.area.key} / ${found.tab.label}` : null;
};
const areas = (sections: NavSection[]) => sections.flatMap((s) => s.areas.map((a) => a.key));
const tabsOf = (sections: NavSection[], key: string) =>
  sections
    .flatMap((s) => s.areas)
    .find((a) => a.key === key)
    ?.tabs.map((t) => t.label) ?? [];

describe('activeModule: the product the phone tab bar is for', () => {
  const both = ['SALES', 'HRMS'];

  it('follows the URL when the company owns both products', () => {
    // The regression: ownership alone answered 'sales' for every one of these.
    expect(activeModule(`/${SLUG}/people`, both)).toBe('people');
    expect(activeModule(`/${SLUG}/people/leave`, both)).toBe('people');
    expect(activeModule(`/${SLUG}/people/employees/42`, both)).toBe('people');
    expect(activeModule(`/${SLUG}/sales/leads`, both)).toBe('sales');
  });

  it('reads the segment, not a substring', () => {
    expect(activeModule(`/${SLUG}/sales/people`, both)).toBe('sales');
    expect(activeModule('/people-first/sales/leads', both)).toBe('sales');
    expect(activeModule('/salesforce-co/people/leave', both)).toBe('people');
  });

  it('falls back to ownership only on shared routes', () => {
    for (const path of [`/${SLUG}/dashboard`, `/${SLUG}/tasks`, `/${SLUG}/admin/users`]) {
      expect(activeModule(path, both)).toBe('sales');
      expect(activeModule(path, ['SALES'])).toBe('sales');
      expect(activeModule(path, ['HRMS'])).toBe('people');
    }
  });
});

describe('permissions the layout must resolve', () => {
  it('includes the modules the previous list never checked', () => {
    for (const token of ['collections', 'commissions', 'commissionslabs', 'projects', 'payroll', 'visits'])
      expect(NAV_PERMISSIONS).toContain(token);
    expect(NAV_PERMISSIONS).toContain('employee:EDIT');
  });
});

describe('what a role sees', () => {
  it('shows a sales agent CRM work, and no finance, people administration or settings', () => {
    const agent = buildNavigation({
      slug: SLUG,
      modules: ['SALES', 'HRMS'],
      permitted: ['leads', 'contacts', 'accounts', 'opportunities', 'tasks', 'calls', 'visits', 'employee'],
      peopleOversight: false,
    });
    expect(areas(agent)).toEqual(
      expect.arrayContaining(['my-workspace', 'inbox', 'leads', 'customers', 'activities', 'calls', 'my-hr']),
    );
    for (const hidden of ['collections', 'commissions', 'settings', 'payroll', 'employees'])
      expect(areas(agent)).not.toContain(hidden);
    expect(tabsOf(agent, 'leads')).toEqual(['All Leads', 'My Leads', 'Unassigned']);
    expect(tabsOf(agent, 'my-hr')).toEqual(
      expect.arrayContaining(['My Attendance', 'My Leave', 'My Roster', 'My Overtime', 'Holidays', 'My Payslips']),
    );
    expect(areas(agent)).not.toContain('attendance-leave');
    expect(tabsOf(agent, 'reports')).not.toContain('HR');
  });

  it('labels the same People screens for oversight, never both ways at once', () => {
    const hr = buildNavigation(everything);
    expect(tabsOf(hr, 'my-hr')).not.toContain('My Leave');
    expect(tabsOf(hr, 'my-hr')).toEqual(expect.arrayContaining(['Check-in', 'My Payslips']));
    expect(tabsOf(hr, 'attendance-leave')).toEqual(
      expect.arrayContaining(['Attendance', 'Leave Requests', 'Exceptions']),
    );
  });

  it('drops a whole product when the workspace is not entitled to it', () => {
    const salesOnly = buildNavigation({ ...everything, modules: ['SALES'] });
    expect(salesOnly.map((s) => s.key)).not.toContain('people');
    expect(tabsOf(salesOnly, 'reports')).not.toContain('HR');
    expect(tabsOf(salesOnly, 'settings')).not.toContain('HR Policies');
  });

  it('gives a platform service identity no personal areas', () => {
    const service = buildNavigation({ ...everything, serviceMode: true });
    for (const personal of ['my-workspace', 'inbox', 'my-hr', 'my-account'])
      expect(areas(service)).not.toContain(personal);
  });

  it('needs every permission a tab names, including a non-VIEW action', () => {
    const noEdit = buildNavigation({ ...everything, permitted: NAV_PERMISSIONS.filter((t) => t !== 'employee:EDIT') });
    expect(tabsOf(noEdit, 'settings')).not.toContain('HR Policies');
    const noTestimonials = buildNavigation({
      ...everything,
      permitted: NAV_PERMISSIONS.filter((t) => t !== 'testimonials'),
    });
    expect(tabsOf(noTestimonials, 'customers')).not.toContain('Testimonials');
  });
});

describe('which area and tab a URL belongs to', () => {
  const nav = buildNavigation(everything);
  it.each([
    ['/ws/sales/leads', 'leads / All Leads'],
    ['/ws/sales/leads?filter=mine', 'leads / My Leads'],
    ['/ws/sales/leads?filter=breached', 'leads / All Leads'],
    ['/ws/sales/leads/abc123', 'leads / All Leads'],
    ['/ws/sales/leadership', 'my-workspace / Business Overview'],
    ['/ws/sales/leadership?period=qtd', 'my-workspace / Business Overview'],
    ['/ws/sales/leadership?view=chasing', 'my-workspace / Team Work'],
    ['/ws/sales/leadership?view=pl&period=qtd', 'reports / Finance'],
    ['/ws/sales/communications/inbox', 'customers / Conversations'],
    ['/ws/sales/communications', 'settings / Channels'],
    ['/ws/sales/collections/recovery', 'collections / Recovery Cases'],
    ['/ws/sales/collections/cm123', 'collections / Overview'],
    ['/ws/sales/commissions?view=payouts', 'commissions / Payout Runs'],
    ['/ws/sales/commissions/slabs', 'commissions / Commission Plans'],
    ['/ws/sales', 'my-workspace / Sales Overview'],
    ['/ws/people', 'employees / Overview'],
    ['/ws/people/users', 'settings / Users'],
    ['/ws/people/security', 'my-account / Security'],
    ['/ws/sales/campaigns/c1/dialer', 'campaigns / Campaigns'],
  ])('%s → %s', (url, expected) => {
    expect(at(nav, url)).toBe(expected);
  });

  it('does not let a module root claim every page beneath it', () => {
    expect(at(nav, '/ws/sales/not-a-screen')).toBeNull();
  });
});

describe('moving between tabs of one screen', () => {
  const nav = buildNavigation(everything);
  const reports = nav.flatMap((s) => s.areas).find((a) => a.key === 'reports')!;
  const finance = reports.tabs.find((t) => t.label === 'Finance')!;
  const sales = reports.tabs.find((t) => t.label === 'Sales')!;

  it('keeps the viewer’s filters and replaces only the view', () => {
    const here = new URLSearchParams('view=compliance&period=qtd&rep=u1&page=3');
    expect(tabTarget(finance, reports, '/ws/sales/leadership', here)).toBe(
      '/ws/sales/leadership?period=qtd&rep=u1&view=pl',
    );
  });

  it('goes to the plain address when the tab is a different screen', () => {
    expect(tabTarget(sales, reports, '/ws/sales/leadership', new URLSearchParams('period=qtd'))).toBe(
      '/ws/sales/reports',
    );
  });
});

describe('every existing workspace screen has a place', () => {
  const root = join(__dirname, '..', '..', 'src', 'app', '(workspace)', '[workspaceSlug]');
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx') pages.push(relative(root, dir).split(sep).join('/'));
    }
  };
  walk(root);

  // admin/[section] serves these four sections; any other value is not found.
  const concrete = pages.flatMap((route) =>
    route === 'admin/[section]'
      ? ['admin/company', 'admin/modules', 'admin/subscription', 'admin/security']
      : [route.replace(/\[[^\]]+\]/g, 'x')],
  );

  it.each(concrete)('/%s', (route) => {
    const nav = buildNavigation(everything);
    expect(at(nav, `/${SLUG}/${route}`.replace(/\/$/, ''))).not.toBeNull();
  });
});

/**
 * The check above walks `page.tsx` files, so it cannot see a screen that is a
 * query parameter rather than a directory — and `/leadership` holds eight of
 * them behind `?view=`.
 *
 * `view=daily`, the daily activity board, shipped with a route, an API, a
 * component and an entry in the page's own TABS array, and no link anywhere in
 * the navigation. TABS is only ever read to validate the parameter; it is never
 * rendered. So the board existed, worked, and could be reached solely by typing
 * the URL — indistinguishable, to anyone looking for it, from a feature that was
 * never deployed.
 *
 * The keys are read from the page rather than repeated here, so a ninth view
 * added to that array fails this until it is given a way in.
 */
describe('every leadership view the page accepts is reachable from the navigation', () => {
  const page = readFileSync(
    join(__dirname, '..', '..', 'src', 'app', '(workspace)', '[workspaceSlug]', 'sales', 'leadership', 'page.tsx'),
    'utf8',
  );
  const block = /const TABS = \[([\s\S]*?)\] as const;/.exec(page);
  const views = [...(block?.[1] ?? '').matchAll(/\[\s*'[^']*'\s*,\s*'([^']*)'\s*\]/g)]
    .map((m) => m[1]!)
    .filter(Boolean); // '' is the overview, which is the bare /leadership tab

  it('finds the TABS array to read', () => {
    expect(views.length).toBeGreaterThan(0);
  });

  /**
   * Asserted against the hrefs the navigation actually offers, not via
   * `findActive`: that resolves `?view=daily` to the bare `/leadership` tab by
   * path alone, so it answers "yes, reachable" for a view with no link at all.
   * The first version of this test did exactly that and passed with the entry
   * deleted, which is worth more as a comment than as a test.
   */
  const offered = () =>
    buildNavigation(everything)
      .flatMap((section) => section.areas)
      .flatMap((area) => area.tabs)
      .map((tab) => tab.href);

  it.each(views)('?view=%s has a link of its own', (view) => {
    expect(offered().some((href) => href.includes(`/leadership?view=${view}`))).toBe(true);
  });
});

describe('every link the previous sidebar offered still has a place', () => {
  // The hrefs of the sidebar at cf07b3b, before work areas. Each must still land
  // on a work area and tab, so no existing screen lost its way in.
  const PREVIOUS = [
    'admin/audit',
    'admin/company',
    'admin/integrations',
    'admin/modules',
    'admin/roles',
    'admin/security',
    'admin/settings',
    'admin/subscription',
    'admin/users',
    'people',
    'people/attendance',
    'people/check-in',
    'people/compliance',
    'people/departments',
    'people/documents',
    'people/employees',
    'people/face-activity',
    'people/holidays',
    'people/leave',
    'people/lifecycle',
    'people/offboarding',
    'people/onboarding',
    'people/overtime',
    'people/payroll',
    'people/payslips',
    'people/performance',
    'people/reports',
    'people/requests',
    'people/roster',
    'people/settings',
    'people/shifts',
    'people/work-locations',
    'sales',
    'sales/accounts',
    'sales/activities',
    'sales/allocation',
    'sales/automation',
    'sales/calendar',
    'sales/call-audits',
    'sales/calls',
    'sales/campaigns',
    'sales/clients',
    'sales/clients?view=referrals',
    'sales/clients?view=testimonials',
    'sales/coaching',
    'sales/collections',
    'sales/commissions',
    'sales/commissions/slabs',
    'sales/communications',
    'sales/communications/inbox',
    'sales/contacts',
    'sales/dashboards',
    'sales/documents',
    'sales/engagement',
    'sales/engagement?view=awards',
    'sales/engagement?view=contests',
    'sales/events',
    'sales/field-sales',
    'sales/follow-ups',
    'sales/forms',
    'sales/landing-pages',
    'sales/leadership',
    'sales/leads',
    'sales/listings',
    'sales/opportunities',
    'sales/playbook',
    'sales/practice',
    'sales/products',
    'sales/projects',
    'sales/reports',
    'sales/requirements',
    'sales/service',
    'sales/site-visits',
    'sales/smart-views',
    'sales/social-leads',
    'sales/targets',
    'sales/tasks',
    'dashboard',
    'tasks',
    'notifications',
    'profile/security',
    'profile/role',
    'profile/appearance',
  ];
  const nav = buildNavigation(everything);
  it.each(PREVIOUS)('/%s', (href) => {
    expect(at(nav, `/${SLUG}/${href}`)).not.toBeNull();
  });
});
