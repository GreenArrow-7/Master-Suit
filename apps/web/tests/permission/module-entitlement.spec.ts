/**
 * P1-7 — module entitlement must gate product modules, and nothing else.
 *
 * `api/handler.ts` used to assert `spec.productModule ?? 'SALES'`, so a route
 * that simply forgot to declare one demanded the Sales entitlement. Worse, the
 * identity and roles routes declared `'HRMS'`, which meant a Sales-only
 * customer could not add a second user, reset a password, or change their own —
 * the platform was unsellable on the Sales plan.
 *
 * User administration, role administration and self-service belong to no
 * product module. These tests pin that.
 */
import { randomBytes } from 'node:crypto';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The module layouts read the session and the URL from the request headers, set per case.
const jar = vi.hoisted(() => ({ cookie: '', path: '/', search: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: jar.cookie, 'x-pathname': jar.path, 'x-search': jar.search }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { GET as listUsers } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { GET as listRoles } from '@/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route';
import { GET as selfStatus } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { POST as hrAction } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { GET as salesLeads } from '@/app/api/v1/workspaces/[workspaceSlug]/sales/leads/route';
import { GET as leadsList } from '@/app/api/v1/leads/route';
import { GET as opportunitiesList } from '@/app/api/v1/opportunities/route';
import { GET as receiptsList } from '@/app/api/v1/collections/receipts/route';
import { POST as createProposal } from '@/app/api/v1/proposals/route';
import { GET as eventsList } from '@/app/api/v1/events/route';
import SalesLayout from '@/app/(workspace)/[workspaceSlug]/sales/layout';
import RealtyLayout from '@/app/(workspace)/[workspaceSlug]/realty/layout';
import PeopleLayout from '@/app/(workspace)/[workspaceSlug]/people/layout';
import LeadEagleLayout from '@/app/(workspace)/[workspaceSlug]/lead-eagle/layout';
import CalendarPage from '@/app/(workspace)/[workspaceSlug]/sales/calendar/page';
import { createSessionToken } from '../helpers/session';
import { get, post } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');

interface Workspace {
  slug: string;
  id: string;
  cookie: string;
  plainCookie: string;
}

/**
 * A workspace with exactly the modules given, an admin holding every permission
 * used below, and a plain member holding none.
 */
async function makeWorkspace(
  label: string,
  modules: ('HRMS' | 'SALES' | 'REAL_ESTATE' | 'LEAD_EAGLE')[],
): Promise<Workspace> {
  const slug = `${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  for (const productModule of modules) {
    await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: productModule, state: 'ACTIVE' } });
  }

  const adminRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  const grants: Grants = [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
    ['roles', 'VIEW'],
    ['roles', 'MANAGE_CONFIGURATION'],
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['attendance', 'APPROVE'],
    ['leads', 'VIEW'],
    ['tasks', 'VIEW'],
    ['opportunities', 'VIEW'],
    ['collections', 'VIEW'],
    ['requirements', 'CREATE'],
    ['settings', 'MANAGE_CONFIGURATION'],
  ];
  await grantPermissions(tenant.id, adminRole.id, grants);

  // Holds nothing at all — used to prove selfService needs no permission.
  const plainRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `plain-${suffix}`, name: 'Plain', rank: 100, defaultScope: 'OWN' },
  });

  const admin = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: adminRole.id,
    email: `admin@${slug}.test`,
    fullName: 'Admin',
  });
  const plain = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: plainRole.id,
    email: `plain@${slug}.test`,
    fullName: 'Plain',
  });

  return {
    slug,
    id: tenant.id,
    cookie: await createSessionToken(tenant.id, admin.id),
    plainCookie: await createSessionToken(tenant.id, plain.id),
  };
}

let hrOnly: Workspace;
let salesOnly: Workspace;
let both: Workspace;
let realtyOnly: Workspace;
let leadEagleOnly: Workspace;

beforeAll(async () => {
  hrOnly = await makeWorkspace('ent-hr', ['HRMS']);
  salesOnly = await makeWorkspace('ent-sales', ['SALES']);
  both = await makeWorkspace('ent-both', ['HRMS', 'SALES']);
  realtyOnly = await makeWorkspace('ent-realty', ['REAL_ESTATE']);
  leadEagleOnly = await makeWorkspace('ent-eagle', ['LEAD_EAGLE']);
});

afterAll(async () => {
  for (const w of [hrOnly, salesOnly, both, realtyOnly, leadEagleOnly]) {
    if (w?.id) await prisma.tenant.delete({ where: { id: w.id } }).catch(() => {});
  }
});

const hrPath = (w: Workspace) => `/api/v1/workspaces/${w.slug}/hr/departments`;
const hrParams = (w: Workspace) => ({ workspaceSlug: w.slug, resource: 'departments' });
const salesPath = (w: Workspace) => `/api/v1/workspaces/${w.slug}/sales/leads`;

describe('product modules are gated by entitlement', () => {
  it('an HRMS-only workspace cannot reach Sales APIs', async () => {
    const res = await get(salesLeads, salesPath(hrOnly), hrOnly.cookie, { workspaceSlug: hrOnly.slug });
    expect(res.status).toBe(403);
  });

  it('a Sales-only workspace cannot reach HRMS APIs', async () => {
    const res = await get(hrRead, hrPath(salesOnly), salesOnly.cookie, hrParams(salesOnly));
    expect(res.status).toBe(403);
  });

  it('a workspace with both reaches both', async () => {
    const hr = await get(hrRead, hrPath(both), both.cookie, hrParams(both));
    const sales = await get(salesLeads, salesPath(both), both.cookie, { workspaceSlug: both.slug });
    expect(hr.status).toBe(200);
    expect(sales.status).toBe(200);
  });
});

describe('check-in setup is open to every workspace; the rest of HR is not', () => {
  const action = (w: Workspace, name: string, body: Record<string, unknown>) =>
    post(hrAction, `/api/v1/workspaces/${w.slug}/hr/actions/${name}`, body, w.cookie, {
      workspaceSlug: w.slug,
      action: name,
    });

  it('a Sales-only workspace reads its work locations', async () => {
    const res = await get(hrRead, `/api/v1/workspaces/${salesOnly.slug}/hr/work-locations`, salesOnly.cookie, {
      workspaceSlug: salesOnly.slug,
      resource: 'work-locations',
    });
    expect(res.status).toBe(200);
  });

  it('a Sales-only workspace sets the check-out rules, and only those', async () => {
    const res = await action(salesOnly, 'settings-update', { checkoutRequiresLeadWork: true, faceMatchThreshold: 0.5 });
    expect(res.status).toBe(200);
    const stored = await prisma.organizationSetting.findUnique({
      where: { tenantId: salesOnly.id },
      select: { hrPolicy: true },
    });
    expect(stored?.hrPolicy).toEqual({ checkoutRequiresLeadWork: true });
  });

  it('a Sales-only workspace raises and decides attendance requests, an early check-out among them', async () => {
    for (const name of ['exception-request', 'exception-decide', 'temporary-request', 'temporary-decide']) {
      // Past the module gate and the permission: refused for the empty body, never for HRMS.
      expect((await action(salesOnly, name, {})).status, name).toBe(422);
    }
  });

  it('a Sales-only workspace is still refused every other HR action', async () => {
    const res = await action(salesOnly, 'leave-apply', {});
    expect(res.status).toBe(403);
  });
});

describe('Real Estate reaches the registers it shares with Sales, and nothing else of Sales', () => {
  // The Real Estate screens are the Sales screens, and they write through these
  // APIs. When the APIs asserted Sales alone, a workspace that bought only Real
  // Estate saw every screen render and every action on it refused.
  it('a Real-Estate-only workspace reads the shared lead register', async () => {
    const res = await get(leadsList, '/api/v1/leads', realtyOnly.cookie);
    expect(res.status).toBe(200);
  });

  it('a Real-Estate-only workspace is refused a Sales-only register', async () => {
    // The admin holds `opportunities:VIEW`, so the refusal is the entitlement's.
    const res = await get(opportunitiesList, '/api/v1/opportunities', realtyOnly.cookie);
    expect(res.status).toBe(403);
  });

  it('an HRMS-only workspace is still refused the shared register', async () => {
    const res = await get(leadsList, '/api/v1/leads', hrOnly.cookie);
    expect(res.status).toBe(403);
  });
});

describe('Lead Eagle reaches lead work, and neither Sales-only nor money registers', () => {
  // The admin holds `opportunities:VIEW` and `collections:VIEW`, so each refusal
  // below is the entitlement's: Lead Eagle is the lead-management product.
  it('a Lead-Eagle-only workspace reads the shared lead register', async () => {
    expect((await get(leadsList, '/api/v1/leads', leadEagleOnly.cookie)).status).toBe(200);
  });

  it('a Lead-Eagle-only workspace is refused a Sales-only register', async () => {
    expect((await get(opportunitiesList, '/api/v1/opportunities', leadEagleOnly.cookie)).status).toBe(403);
  });

  it('a Lead-Eagle-only workspace is refused collections, which Real Estate reads', async () => {
    expect((await get(receiptsList, '/api/v1/collections/receipts', leadEagleOnly.cookie)).status).toBe(403);
    // Past the module gate for Real Estate: the bare request fails only on its missing filters.
    expect((await get(receiptsList, '/api/v1/collections/receipts', realtyOnly.cookie)).status).not.toBe(403);
  });

  it('a Lead-Eagle-only workspace is refused a shortlist, which Real Estate sends', async () => {
    // The admin holds `requirements:CREATE`; the entitlement gate runs before
    // the body is read, so a throwaway body is enough to tell the two apart.
    const body = { title: 'A few places', listingIds: ['not-a-listing'] };
    expect((await post(createProposal, '/api/v1/proposals', body, leadEagleOnly.cookie)).status).toBe(403);
    expect((await post(createProposal, '/api/v1/proposals', body, realtyOnly.cookie)).status).not.toBe(403);
  });
});

/**
 * A screen or route the workspace's plan does not include (M2-05). The module
 * layouts sent the screen to the dashboard without a word, and the API named
 * the last module it tried, so a Lead-Eagle-only workspace was told "Real
 * Estate is not enabled" for events, which Sales or Real Estate carry.
 */
describe('a screen or route outside the plan says which products carry it', () => {
  const open = (w: Workspace, url: string, cookie = w.cookie) => {
    const [path, search = ''] = url.split('?');
    jar.cookie = cookie;
    jar.path = `/${w.slug}${path}`;
    jar.search = search && `?${search}`;
    return { children: 'the screen', params: Promise.resolve({ workspaceSlug: w.slug }) };
  };
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    if (node && typeof node === 'object' && 'props' in node)
      return text((node as ReactElement<{ children?: unknown }>).props.children);
    return '';
  };
  const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const el = node as ReactElement<Record<string, unknown>>;
    return [el, ...elements(el.props.children)];
  };
  /** A layout's output with its own server component resolved. */
  const rendered = async (node: unknown) => {
    const el = node as ReactElement<Record<string, unknown>>;
    const render = el?.type as unknown as (props: unknown) => Promise<unknown>;
    return typeof render === 'function' ? await render(el.props) : node;
  };
  /** What a layout puts on screen. */
  const shown = async (node: unknown) => text(await rendered(node));
  /** Where a layout sends the viewer, or null when it shows something. */
  const sentTo = async (layout: Promise<unknown>) => {
    try {
      await rendered(await layout);
      return null;
    } catch (error) {
      const digest = String((error as { digest?: unknown }).digest ?? '');
      if (!digest.startsWith('NEXT_REDIRECT')) throw error;
      return digest.split(';')[2];
    }
  };

  it('Events in a Lead-Eagle-only workspace: a page naming Sales or Real Estate, not the dashboard', async () => {
    for (const path of ['/sales/events', '/sales/events/some-event', '/realty/events']) {
      const Layout = path.startsWith('/sales/') ? SalesLayout : RealtyLayout;
      const page = await shown(await Layout(open(leadEagleOnly, path)));
      // Real Estate's folder names Sales too, as the API does: either carries events.
      expect(page).toContain('Events is part of Sales or Real Estate.');
      expect(page).toContain('This workspace’s plan does not include it.');
      expect(page).toContain('Back to the dashboard');
      expect(page).toContain('platform provider');
    }
  });

  it('the page carries the path it was decided for, so a link followed beneath the layout is decided again', async () => {
    // Soft navigation does not run a shared layout again (TopBar's bell uses
    // router.push), so the page itself has to notice the URL moving under it.
    const page = await rendered(await SalesLayout(open(leadEagleOnly, '/sales/events')));
    expect(elements(page).some((el) => el.props.path === `/${leadEagleOnly.slug}/sales/events`)).toBe(true);
  });

  const at = (w: Workspace, path: string) => `/${w.slug}${path}`;

  it('the same screen under a product the plan has opens there, from whichever folder the link named', async () => {
    expect(await sentTo(SalesLayout(open(leadEagleOnly, '/sales/leads/42?tab=calls')))).toBe(
      at(leadEagleOnly, '/lead-eagle/leads/42?tab=calls'),
    );
    expect(await sentTo(RealtyLayout(open(leadEagleOnly, '/realty/leads/42')))).toBe(
      at(leadEagleOnly, '/lead-eagle/leads/42'),
    );
    expect(await sentTo(RealtyLayout(open(salesOnly, '/realty/events')))).toBe(at(salesOnly, '/sales/events'));
    expect(await sentTo(LeadEagleLayout(open(salesOnly, '/lead-eagle/leads')))).toBe(at(salesOnly, '/sales/leads'));
    expect(await sentTo(LeadEagleLayout(open(realtyOnly, '/lead-eagle/properties')))).toBe(
      at(realtyOnly, '/realty/properties'),
    );
  });

  it('People’s check-in, attendance and work locations, on every plan at the workspace root, go there', async () => {
    // Not "Check in is part of HR": the old check-in address is on home screens.
    expect(await sentTo(PeopleLayout(open(salesOnly, '/people/check-in')))).toBe(at(salesOnly, '/check-in'));
    expect(await sentTo(PeopleLayout(open(salesOnly, '/people/attendance')))).toBe(at(salesOnly, '/attendance'));
    expect(await sentTo(PeopleLayout(open(salesOnly, '/people/requests')))).toBe(at(salesOnly, '/attendance/requests'));
    expect(await sentTo(PeopleLayout(open(realtyOnly, '/people/work-locations')))).toBe(
      at(realtyOnly, '/admin/work-locations'),
    );
    expect(await sentTo(PeopleLayout(open(realtyOnly, '/people/employees/e1/face')))).toBe(
      at(realtyOnly, '/admin/work-locations/e1/face'),
    );
  });

  it('the website forms and landing pages open under whichever lead product the plan has (M6-06, M6-09)', async () => {
    for (const root of ['forms', 'landing-pages']) {
      const leadEagle = `/lead-eagle/${root}`;
      const realty = `/realty/${root}`;
      const sales = `/sales/${root}`;
      expect(await sentTo(LeadEagleLayout(open(salesOnly, leadEagle)))).toBe(at(salesOnly, sales));
      expect(await sentTo(RealtyLayout(open(salesOnly, realty)))).toBe(at(salesOnly, sales));
      expect(await sentTo(SalesLayout(open(realtyOnly, sales)))).toBe(at(realtyOnly, realty));
      expect(await sentTo(LeadEagleLayout(open(realtyOnly, leadEagle)))).toBe(at(realtyOnly, realty));
      expect(await sentTo(SalesLayout(open(leadEagleOnly, sales)))).toBe(at(leadEagleOnly, leadEagle));
      expect(await sentTo(RealtyLayout(open(leadEagleOnly, realty)))).toBe(at(leadEagleOnly, leadEagle));
      expect(await RealtyLayout(open(realtyOnly, realty))).toBe('the screen');
      expect(await LeadEagleLayout(open(leadEagleOnly, leadEagle))).toBe('the screen');
    }
    expect(await shown(await LeadEagleLayout(open(hrOnly, '/lead-eagle/forms')))).toContain(
      'Forms is part of Sales, Real Estate or Lead Eagle.',
    );
  });

  it('the calendar opens under whichever lead product the plan has (M4-22)', async () => {
    expect(await sentTo(SalesLayout(open(leadEagleOnly, '/sales/calendar?month=2026-12')))).toBe(
      at(leadEagleOnly, '/lead-eagle/calendar?month=2026-12'),
    );
    expect(await sentTo(SalesLayout(open(realtyOnly, '/sales/calendar')))).toBe(at(realtyOnly, '/realty/calendar'));
    expect(await sentTo(LeadEagleLayout(open(salesOnly, '/lead-eagle/calendar')))).toBe(
      at(salesOnly, '/sales/calendar'),
    );
    expect(await LeadEagleLayout(open(leadEagleOnly, '/lead-eagle/calendar'))).toBe('the screen');
    expect(await shown(await LeadEagleLayout(open(hrOnly, '/lead-eagle/calendar')))).toContain(
      'Calendar is part of Sales, Real Estate or Lead Eagle.',
    );
  });

  it('the calendar page admits every lead product, and refuses a workspace without one', async () => {
    for (const w of [leadEagleOnly, realtyOnly, salesOnly]) {
      open(w, '/sales/calendar');
      await expect(CalendarPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    }
    open(hrOnly, '/sales/calendar');
    await expect(CalendarPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ status: 403 });
  });

  it('Lead Eagle’s folder, in a workspace with no lead product, names every product that has leads', async () => {
    expect(await shown(await LeadEagleLayout(open(hrOnly, '/lead-eagle/leads')))).toContain(
      'Leads is part of Sales, Real Estate or Lead Eagle.',
    );
    expect(await shown(await LeadEagleLayout(open(salesOnly, '/lead-eagle/properties')))).toContain(
      'Properties is part of Real Estate or Lead Eagle.',
    );
  });

  it('the hint about changing the plan is for an administrator only', async () => {
    const page = await shown(await SalesLayout(open(leadEagleOnly, '/sales/events', leadEagleOnly.plainCookie)));
    expect(page).toContain('Events is part of Sales or Real Estate.');
    expect(page).not.toContain('platform provider');
  });

  it('every module layout says so: HR, Sales alone, and lead stages and sources, which any lead product carries', async () => {
    expect(await shown(await PeopleLayout(open(salesOnly, '/people/leave')))).toContain('Leave is part of HR.');
    expect(await shown(await SalesLayout(open(realtyOnly, '/sales/opportunities')))).toContain(
      'Opportunities is part of Sales.',
    );
    const { default: LeadStagesLayout } = await import('@/app/(workspace)/[workspaceSlug]/admin/lead-stages/layout');
    expect(await shown(await LeadStagesLayout(open(hrOnly, '/admin/lead-stages')))).toContain(
      'Lead stages is part of Sales, Real Estate or Lead Eagle.',
    );
    const { default: LeadSourcesLayout } = await import('@/app/(workspace)/[workspaceSlug]/admin/lead-sources/layout');
    expect(await shown(await LeadSourcesLayout(open(hrOnly, '/admin/lead-sources')))).toContain(
      'Lead sources is part of Sales, Real Estate or Lead Eagle.',
    );
    const { default: CustomFieldsLayout } =
      await import('@/app/(workspace)/[workspaceSlug]/admin/custom-fields/layout');
    expect(await shown(await CustomFieldsLayout(open(hrOnly, '/admin/custom-fields')))).toContain(
      'Custom fields is part of Sales, Real Estate or Lead Eagle.',
    );
    const { default: EmailTemplatesLayout } =
      await import('@/app/(workspace)/[workspaceSlug]/admin/email-templates/layout');
    expect(await shown(await EmailTemplatesLayout(open(hrOnly, '/admin/email-templates')))).toContain(
      'Email templates is part of Sales, Real Estate or Lead Eagle.',
    );
    expect(await EmailTemplatesLayout(open(leadEagleOnly, '/admin/email-templates'))).toBe('the screen');
  });

  it('a lead source’s deliveries and field map are for any lead product (M6-20, M6-21)', async () => {
    const { default: LeadSourcesLayout } = await import('@/app/(workspace)/[workspaceSlug]/admin/lead-sources/layout');
    expect(await shown(await LeadSourcesLayout(open(hrOnly, '/admin/lead-sources/bayut')))).toContain(
      'Lead sources is part of Sales, Real Estate or Lead Eagle.',
    );
    expect(await LeadSourcesLayout(open(leadEagleOnly, '/admin/lead-sources/bayut'))).toBe('the screen');
  });

  it('an entitled workspace gets its screen', async () => {
    expect(await SalesLayout(open(salesOnly, '/sales/events'))).toBe('the screen');
    expect(await LeadEagleLayout(open(leadEagleOnly, '/lead-eagle/leads'))).toBe('the screen');
    expect(await PeopleLayout(open(hrOnly, '/people/leave'))).toBe('the screen');
  });

  it('the API names every product that carries the route, or its one module', async () => {
    const events = await get(eventsList, '/api/v1/events', leadEagleOnly.cookie);
    expect(events.status).toBe(403);
    expect(events.body.detail).toBe('Sales or Real Estate is not enabled for this company.');
    const leads = await get(leadsList, '/api/v1/leads', hrOnly.cookie);
    expect(leads.status).toBe(403);
    expect(leads.body.detail).toBe('Sales, Real Estate or Lead Eagle is not enabled for this company.');
    const opportunities = await get(opportunitiesList, '/api/v1/opportunities', realtyOnly.cookie);
    expect(opportunities.body.detail).toBe('Sales is not enabled for this company.');
  });
});

describe('platform capabilities are not gated by a product module', () => {
  // The whole point of P1-7: these must work on every plan.
  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])('%s can list users', async (_label, workspace) => {
    const w = workspace();
    const res = await get(listUsers, `/api/v1/workspaces/${w.slug}/identity/accounts`, w.cookie, {
      workspaceSlug: w.slug,
      action: 'accounts',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])('%s can list roles', async (_label, workspace) => {
    const w = workspace();
    const res = await get(listRoles, `/api/v1/workspaces/${w.slug}/roles/roles`, w.cookie, {
      workspaceSlug: w.slug,
      action: 'roles',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])(
    '%s: a member holding no permission at all can still read their own password status',
    async (_label, workspace) => {
      const w = workspace();
      const res = await get(selfStatus, `/api/v1/workspaces/${w.slug}/identity/self/password-status`, w.plainCookie, {
        workspaceSlug: w.slug,
        action: 'password-status',
      });
      expect(res.status).toBe(200);
    },
  );
});

describe('a suspended workspace loses every module', () => {
  it('refuses a workspace whose status is not ACTIVE', async () => {
    await prisma.tenant.update({ where: { id: both.id }, data: { status: 'SUSPENDED' } });
    try {
      const hr = await get(hrRead, hrPath(both), both.cookie, hrParams(both));
      const sales = await get(salesLeads, salesPath(both), both.cookie, { workspaceSlug: both.slug });
      expect(hr.status).toBeGreaterThanOrEqual(400);
      expect(sales.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.tenant.update({ where: { id: both.id }, data: { status: 'ACTIVE' } });
    }
  });
});
