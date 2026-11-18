import { describe, expect, it } from 'vitest';
import { buildNavigation, NAV_PERMISSIONS, findActive, type NavInput, type NavSection } from '@/lib/nav/workspaceNav';

/**
 * One visible sales section for a workspace that owns Sales CRM and Real Estate.
 *
 * Such a workspace saw two sections over one set of rows, and two sidebar
 * entries both reading "Leads" — `/sales/leads` and `/realty/leads`, the same
 * leads. Sales CRM is now the single visible sales section and Real Estate
 * stands down beside it.
 *
 * What these tests are really guarding is the part that could go wrong: that
 * standing a section down does not take a destination, an entitlement or a
 * bookmark with it.
 */

const SLUG = 'ws';
const nav = (modules: string[], permitted: string[] = NAV_PERMISSIONS): NavSection[] =>
  buildNavigation({ slug: SLUG, modules, permitted, peopleOversight: true } as NavInput);

const rowLabels = (s: NavSection[]) => s.flatMap((x) => x.areas.map((a) => a.label));
const sectionKeys = (s: NavSection[]) => s.map((x) => x.key);
const reachable = (s: NavSection[]) =>
  new Set(s.flatMap((x) => x.areas.flatMap((a) => a.tabs.flatMap((t) => [t.href, ...(t.aliases ?? [])]))));

/** Every destination the navigation offers, as a comparable set. */
const destinations = (modules: string[]) => reachable(nav(modules));

describe('Sales CRM is the single visible sales section', () => {
  it('drops the Real Estate section when Sales CRM is present', () => {
    expect(sectionKeys(nav(['SALES', 'REAL_ESTATE']))).not.toContain('realty');
    expect(sectionKeys(nav(['SALES']))).not.toContain('realty');
  });

  it('leaves no two sidebar rows sharing a label', () => {
    // The symptom the change exists to remove: two rows both reading "Leads",
    // and for an administrator two more both reading "Lead Sources".
    const labels = rowLabels(nav(['SALES', 'REAL_ESTATE']));
    expect(labels.length).toBe(new Set(labels).size);
  });

  it('keeps the Real Estate section for a workspace without Sales CRM', () => {
    // A Real-Estate-only customer must not have to buy Sales CRM to reach the
    // tools they already pay for.
    expect(sectionKeys(nav(['REAL_ESTATE']))).toContain('realty');
    expect(sectionKeys(nav(['REAL_ESTATE', 'HRMS']))).toContain('realty');
  });

  it('leaves Lead Eagle alone', () => {
    expect(sectionKeys(nav(['LEAD_EAGLE']))).toContain('lead-eagle');
    // Unchanged rule: Lead Eagle already stands down beside either other product.
    expect(sectionKeys(nav(['LEAD_EAGLE', 'SALES']))).not.toContain('lead-eagle');
    expect(sectionKeys(nav(['LEAD_EAGLE', 'REAL_ESTATE']))).not.toContain('lead-eagle');
  });
});

describe('no destination is lost', () => {
  it('still offers every route a Sales + Real Estate workspace could reach before', () => {
    // The union of what each product offers alone is what the pair must still
    // offer together. This is the assertion that makes the suppression safe:
    // it fails the moment a Real Estate screen loses its last way in.
    const together = destinations(['SALES', 'REAL_ESTATE']);
    for (const href of [...destinations(['SALES']), ...destinations(['REAL_ESTATE'])]) {
      expect(together, `${href} fell out of the navigation`).toContain(href);
    }
  });

  it('rehomes the three screens Real Estate owns outright', () => {
    // These are not re-exports of a Sales page, so nothing else would carry
    // them: the brokerage board, the unit register, the off-plan filter.
    const together = destinations(['SALES', 'REAL_ESTATE']);
    expect(together).toContain(`/${SLUG}/realty/dashboard`);
    expect(together).toContain(`/${SLUG}/realty/properties`);
    expect(together).toContain(`/${SLUG}/realty/projects?possession=UNDER_CONSTRUCTION,NEW_LAUNCH`);
  });

  it('keeps the lead-eagle aliases the Real Estate section used to carry', () => {
    // A workspace owning all three: Lead Eagle's section stands down, Real
    // Estate's now does too, so the Sales tabs must claim those paths or an old
    // bookmark lights no row at all.
    const all = destinations(['SALES', 'REAL_ESTATE', 'LEAD_EAGLE']);
    for (const path of ['leads', 'follow-ups', 'calls', 'site-visits', 'reports', 'dashboard', 'properties']) {
      expect(all, `lead-eagle/${path} lost its row`).toContain(`/${SLUG}/lead-eagle/${path}`);
    }
  });
});

describe('an old bookmark still lights the right row', () => {
  const sections = nav(['SALES', 'REAL_ESTATE']);
  const rowFor = (url: string) => {
    const [path, query] = url.split('?');
    return findActive(sections, path!, new URLSearchParams(query ?? ''))?.area.label ?? null;
  };

  it.each([
    ['/ws/realty/leads', 'Leads'],
    ['/ws/realty/follow-ups', 'Activities'],
    ['/ws/realty/calls', 'Calls & Coaching'],
    ['/ws/realty/site-visits', 'Activities'],
    ['/ws/realty/requirements', 'Property Inventory'],
    ['/ws/realty/forms', 'Lead Sources'],
    ['/ws/realty/properties', 'Property Inventory'],
    ['/ws/realty/dashboard', 'My Workspace'],
  ])('%s resolves to a sidebar row', (url, label) => {
    expect(rowFor(url)).toBe(label);
  });
});

describe('navigation grants nothing', () => {
  it('hides a rehomed tab from a workspace without the Real Estate entitlement', () => {
    // Moving a menu item must not unlock a paid feature. The rehomed tabs keep
    // `module: R`, so a Sales-only workspace never sees them.
    const salesOnly = destinations(['SALES']);
    expect(salesOnly).not.toContain(`/${SLUG}/realty/properties`);
    expect(salesOnly).not.toContain(`/${SLUG}/realty/dashboard`);
  });

  it('hides a rehomed tab from a workspace without Sales CRM', () => {
    // And `andModule: S` keeps them out of a Real-Estate-only workspace's Sales
    // sections, where there is no Sales CRM to file them under.
    const realtyOnly = nav(['REAL_ESTATE']);
    expect(sectionKeys(realtyOnly)).not.toContain('properties');
    expect(rowLabels(realtyOnly)).not.toContain('Property Inventory');
  });

  it('refuses a rehomed tab to a role without its permission', () => {
    const withoutProjects = NAV_PERMISSIONS.filter((p) => !p.startsWith('projects'));
    const s = buildNavigation({
      slug: SLUG,
      modules: ['SALES', 'REAL_ESTATE'],
      permitted: withoutProjects,
      peopleOversight: true,
    } as NavInput);
    expect(reachable(s)).not.toContain(`/${SLUG}/realty/properties`);
  });
});

describe('a Sales-only workspace is untouched', () => {
  it('offers exactly the rows and sections it did before', () => {
    // Stated explicitly because it is the promise most easily broken by accident.
    const s = nav(['SALES']);
    expect(sectionKeys(s)).toEqual([
      'home',
      'crm',
      'properties',
      'marketing',
      'finance',
      'insights',
      'administration',
      'account',
    ]);
    expect(rowLabels(s)).toEqual([
      'My Workspace',
      'Inbox',
      'Leads',
      'Customers',
      'Opportunities',
      'Activities',
      'Calls & Coaching',
      'Daily Activity',
      'Property Inventory',
      'Campaigns',
      'Lead Sources',
      'Collections',
      'Commissions & Payouts',
      'Reports',
      'Settings',
      'My Account',
    ]);
  });
});
