/**
 * Defects the owner's evidence passes found on the Lead Eagle screens
 * (changes/2026-10-13-lead-eagle-evidence-defects.md):
 *
 * - Calls printed its times on the server's clock; "Today's Calls" counted the
 *   server's day and completed calls only, so two missed calls that day read 0;
 *   an inbound call's Number was the workspace's own line, not the caller's (on
 *   the call's own page and a seller's day too), and a contact's number skipped
 *   the contact's field rules.
 * - A time zone typed in settings that Intl does not know broke every screen
 *   formatting a date with it.
 * - "Call with AI assistance" was offered to a role that may only view calls,
 *   and /calls/new (calls:CREATE) refuses it.
 * - A busy calendar day drew a dot per entry, a tall block on a phone.
 * - The phone's top bar named the Portal emails page by its URL key.
 *
 * The server runs on New York's clock here and the workspace on Dubai's, so
 * a screen that formats with the server's zone shows a different time and day.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const cookieJar = vi.hoisted(() => ({ value: '', path: '/' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': cookieJar.path }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));
// The client components render outside Next's router here.
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  usePathname: () => cookieJar.path,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { prisma } from '@/lib/db';
import CallsPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/page';
import CallDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/page';
import NewCallPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/new/page';
import LeadPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadDetail from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/LeadDetail';
import CalendarView from '@/app/(workspace)/[workspaceSlug]/sales/calendar/CalendarView';
import MetricCard from '@/components/ui/MetricCard';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import * as TopBar from '@/components/nav/TopBar';
import CallLink from '@/components/workspace/CallLink';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dailyCalls, dayBounds, todayKey } from '@/services/targets/dailyBoard';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

const suffix = randomBytes(4).toString('hex');
const ZONE = 'Asia/Dubai';
const serverZone = process.env.TZ;
let tenantId = '';
let leadId = '';
let badZoneTenantId = '';
const people: Record<'admin' | 'viewer', { id: string; cookie: string; roleId: string }> = {
  admin: { id: '', cookie: '', roleId: '' },
  viewer: { id: '', cookie: '', roleId: '' },
};
const calls: Record<string, string> = {};

type El = ReactElement<Record<string, unknown>>;
/** Every element in a server component's tree, without rendering it. */
const elements = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as El;
  return [el, ...Object.values(el.props).flatMap(elements)];
};
/** Every string and number in a tree, props included (a link's text, a cell's value). */
const texts = (node: unknown): string[] => {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === 'object' && 'props' in node) return Object.values((node as El).props).flatMap(texts);
  return [];
};

async function member(label: string, grants: Grants) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, grants, 'ORGANIZATION');
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@evidence.test`,
    fullName: `${label} ${suffix}`,
  });
  return { id: user.id, roleId: role.id, cookie: await createSessionToken(tenantId, user.id) };
}

/** The Calls page as `who` reads it: its figures, and each row's cells by column. */
async function callsPage(who: { cookie: string }) {
  cookieJar.value = who.cookie;
  cookieJar.path = `/ev-${suffix}/lead-eagle/calls`;
  const tree = elements(await CallsPage({ searchParams: Promise.resolve({}) }));
  const figures = Object.fromEntries(
    tree.filter((el) => el.type === MetricCard).map((el) => [el.props.label as string, el.props.value]),
  );
  const grid = tree.find((el) => el.type === ConfigurableGrid)!;
  const table = elements(await (grid.type as (props: unknown) => unknown)(grid.props));
  const rows = table
    .filter((el) => el.type === 'tr' && el.key)
    .map((tr) => ({
      id: String(tr.key),
      cells: Object.fromEntries(
        elements(tr.props.children)
          .filter((el) => el.type === 'td')
          .map((td) => [String(td.key), td]),
      ),
    }));
  return { figures, rows };
}

const call = (data: Record<string, unknown>) =>
  prisma.call
    .create({ data: { tenantId, callerId: people.admin.id, recipientNumber: '+971500000001', ...data } })
    .then((c) => c.id);

beforeAll(async () => {
  // New York's clock on the server, Dubai's in the workspace: never the same day boundary.
  process.env.TZ = 'America/New_York';
  const tenant = await prisma.tenant.create({
    data: {
      slug: `ev-${suffix}`,
      legalName: 'Evidence LLC',
      displayName: 'Evidence',
      status: 'ACTIVE',
      timezone: ZONE,
    },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  people.admin = await member('admin', [
    ['calls', 'VIEW'],
    ['calls', 'CREATE'],
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ['tasks', 'VIEW'],
  ]);
  // The evidence rig's Viewer: it reads calls and leads, and places nothing.
  people.viewer = await member('viewer', [
    ['calls', 'VIEW'],
    ['leads', 'VIEW'],
  ]);
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: 'new', name: 'New', position: 0, isDefault: true },
  });
  leadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `EV-${suffix}`,
        fullName: 'Evidence lead',
        stageId: stage.id,
        ownerId: people.admin.id,
        phone: '+971501234567',
        phoneNormalized: '+971501234567',
      },
    })
  ).id;

  const { from } = dayBounds(todayKey(ZONE), ZONE);
  const minute = 60_000;
  // Either side of the workspace's midnight.
  calls.lastNight = await call({ status: 'COMPLETED', outcome: 'CONNECTED', createdAt: new Date(+from - minute) });
  calls.earlyToday = await call({ status: 'COMPLETED', outcome: 'CONNECTED', createdAt: new Date(+from + minute) });
  calls.interested = await call({ status: 'COMPLETED', outcome: 'INTERESTED', createdAt: new Date() });
  // Rang and was not answered: a call made, as the daily board counts it.
  calls.missed = await call({
    leadId,
    direction: 'INBOUND',
    status: 'MISSED',
    outcome: 'NO_ANSWER',
    callerNumber: '+971501234567',
    recipientNumber: '+97144000000',
    createdAt: new Date(),
  });
  calls.failed = await call({ status: 'FAILED', createdAt: new Date() });
  // Missed, whatever outcome was put on it: a call made, never a connected one.
  calls.missedConnected = await call({ status: 'MISSED', outcome: 'CONNECTED', createdAt: new Date() });
  // Booked, not made.
  calls.scheduled = await call({ status: 'SCHEDULED', createdAt: new Date() });
  // 16:30 in Dubai; 08:30 in New York. A day long past, outside today's figures.
  calls.clock = await call({ status: 'COMPLETED', createdAt: new Date('2026-03-10T12:30:00Z') });
  // A contact rang in, on a day long past; the viewer's role masks contacts' phones.
  const contact = await prisma.contact.create({
    data: { tenantId, reference: `EC-${suffix}`, fullName: 'Evidence contact', phone: '+971509876543' },
  });
  await prisma.fieldPermission.create({
    data: {
      tenantId,
      roleId: people.viewer.roleId,
      objectType: 'CONTACT',
      fieldKey: 'phone',
      canView: false,
      maskStrategy: 'MASK_PARTIAL',
    },
  });
  calls.contactInbound = await call({
    contactId: contact.id,
    direction: 'INBOUND',
    status: 'COMPLETED',
    callerNumber: '+971509876543',
    recipientNumber: '+97144000000',
    createdAt: new Date('2026-03-09T10:00:00Z'),
  });
  // A zone typed as a city name, which Intl does not know.
  badZoneTenantId = (
    await prisma.tenant.create({
      data: {
        slug: `ev-zone-${suffix}`,
        legalName: 'Zone LLC',
        displayName: 'Zone',
        status: 'ACTIVE',
        timezone: 'Dubai',
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (serverZone === undefined) delete process.env.TZ;
  else process.env.TZ = serverZone;
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: badZoneTenantId } }).catch(() => {});
});

describe('Lead Eagle > Calls', () => {
  it('prints each call on the workspace’s clock, not the server’s', async () => {
    const { rows } = await callsPage(people.admin);
    const row = rows.find((r) => r.id === calls.clock)!;
    expect(texts(row.cells.createdAt!.props.children)).toContain('10 Mar, 16:30');
  });

  it('counts Today’s Calls over the workspace’s day: every call that rang, missed and failed too, not one only booked', async () => {
    const { figures } = await callsPage(people.admin);
    // earlyToday, interested, missed, failed, missedConnected; not lastNight
    // (yesterday in Dubai), not scheduled. Connected: earlyToday and interested.
    expect(figures["Today's Calls"]).toBe(5);
    expect(figures.Connected).toBe(2);
    expect(figures['Connect Rate']).toBe('40%');
  });

  it('numbers an inbound call by the caller, read as the lead’s phone reads, and dials the caller back', async () => {
    const admin = (await callsPage(people.admin)).rows.find((r) => r.id === calls.missed)!;
    expect(texts(admin.cells.recipientNumber!.props.children)).toEqual(['+971501234567']);
    expect(texts(admin.cells.call!.props.children)).toEqual(['+971501234567']);
    // Without the lead's sensitive fields, the caller's number is masked, never the workspace's line.
    const viewer = (await callsPage(people.viewer)).rows.find((r) => r.id === calls.missed)!;
    expect(texts(viewer.cells.recipientNumber!.props.children)).toEqual(['+971•••••••67']);
    // A masked number is not dialable: the cell has nothing to call.
    expect(elements(viewer.cells.call!.props.children).some((el) => el.type === CallLink)).toBe(false);
  });

  it('reads a contact’s number as the contact’s phone reads: masked by the role’s field rule', async () => {
    const admin = (await callsPage(people.admin)).rows.find((r) => r.id === calls.contactInbound)!;
    expect(texts(admin.cells.recipientNumber!.props.children)).toEqual(['+971509876543']);
    const viewer = (await callsPage(people.viewer)).rows.find((r) => r.id === calls.contactInbound)!;
    expect(texts(viewer.cells.recipientNumber!.props.children)).toEqual(['+971•••••••43']);
  });

  it('the call’s own page shows and dials an inbound call’s caller, not the workspace’s line', async () => {
    const page = async (who: { cookie: string }) => {
      cookieJar.value = who.cookie;
      cookieJar.path = `/ev-${suffix}/lead-eagle/calls/${calls.missed}`;
      return elements(await CallDetailPage({ params: Promise.resolve({ id: calls.missed! }) }));
    };
    const dialled = (tree: El[]) => tree.filter((el) => el.type === CallLink).map((el) => el.props.number);
    const admin = await page(people.admin);
    expect(dialled(admin)).toEqual(['+971501234567']);
    expect(texts(admin)).not.toContain('+97144000000');
    expect(dialled(await page(people.viewer))).toEqual(['+971•••••••67']);
  });

  it('a seller’s day lists an inbound call under the caller’s number', async () => {
    const ctx = buildCtx(buildActor({ id: people.admin.id, tenantId, grants: [['leads', 'VIEW_SENSITIVE_FIELDS']] }));
    const { calls: day } = await dailyCalls(ctx, people.admin.id);
    expect(day.find((c) => c.id === calls.missed)?.recipientNumber).toBe('+971501234567');
  });
});

describe('Call with AI assistance on the lead page', () => {
  async function detail(who: { cookie: string }) {
    cookieJar.value = who.cookie;
    cookieJar.path = `/ev-${suffix}/lead-eagle/leads/${leadId}`;
    const page = elements(await LeadPage({ params: Promise.resolve({ id: leadId }) }));
    const el = page.find((child) => child.type === LeadDetail)!;
    return { props: el.props, markup: renderToStaticMarkup(createElement(LeadDetail, el.props as never)) };
  }

  it('is offered where /calls/new opens (calls:CREATE), and not to a role that only views calls', async () => {
    const admin = await detail(people.admin);
    expect(admin.props.canCall).toBe(true);
    expect(admin.markup).toContain('Call with AI assistance');
    const viewer = await detail(people.viewer);
    expect(viewer.props.canCall).toBe(false);
    expect(viewer.markup).not.toContain('Call with AI assistance');
  });

  it('/calls/new refuses the view-only role, and the Calls list offers it no New Call', async () => {
    cookieJar.value = people.admin.cookie;
    await expect(NewCallPage()).resolves.toBeTruthy();
    cookieJar.value = people.viewer.cookie;
    // Next's forbidden() interrupt, a 403 page (outside Next it throws naming
    // itself): not a crash, an entitlement refusal or a sign-in redirect.
    await expect(NewCallPage()).rejects.toThrow(/`forbidden\(\)`/);
    const offered = async (who: { cookie: string }) => {
      cookieJar.value = who.cookie;
      return texts(await CallsPage({ searchParams: Promise.resolve({}) })).includes('New Call');
    };
    expect(await offered(people.admin)).toBe(true);
    expect(await offered(people.viewer)).toBe(false);
  });
});

describe('the calendar’s day', () => {
  it('draws at most three dots of a kind, then says how many more', () => {
    cookieJar.path = `/ev-${suffix}/lead-eagle/calendar`;
    const on = (kind: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${kind}-${i}`,
        date: '2026-12-05T08:00:00.000Z',
        day: '2026-12-05',
        label: `${kind} ${i}`,
        kind,
      }));
    const markup = renderToStaticMarkup(
      createElement(CalendarView, {
        items: [...on('task', 10), ...on('follow-up', 5), ...on('visit', 1)] as never,
        year: 2026,
        month: 11,
        today: '2026-12-01',
        timeZone: ZONE,
        prevHref: '/calendar?month=2026-11',
        nextHref: '/calendar?month=2027-01',
        todayHref: '/calendar',
      }),
    );
    // Three tasks, three follow-ups, the visit; nine more.
    expect(markup.match(/width:6px;height:6px/g)).toHaveLength(7);
    expect(markup).toContain('+9');
  });
});

describe('the phone’s top bar', () => {
  it('names a lead source’s page as its card does', () => {
    const pageTitle = (TopBar as unknown as { pageTitle: (path: string) => string }).pageTitle;
    expect(pageTitle(`/ev-${suffix}/admin/lead-sources/inbound_email`)).toBe('Portal emails');
    expect(pageTitle(`/ev-${suffix}/admin/lead-sources/google_ads`)).toBe('Google Ads lead forms');
    // Anything else is still read from the path.
    expect(pageTitle(`/ev-${suffix}/admin/lead-sources`)).toBe('Lead sources');
    expect(pageTitle(`/ev-${suffix}/lead-eagle/site-visits`)).toBe('Site visits');
  });
});

describe('the workspace’s time zone', () => {
  it('reads a zone Intl does not know as the default, and a real one as it is', async () => {
    expect(await workspaceTimezone(buildCtx(buildActor({ id: people.admin.id, tenantId: badZoneTenantId })))).toBe(
      'Asia/Dubai',
    );
    expect(await workspaceTimezone(buildCtx(buildActor({ id: people.admin.id, tenantId })))).toBe(ZONE);
  });
});
