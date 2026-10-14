/**
 * The calendar in every lead module (M4-22): Sales' calendar page admits Real
 * Estate and Lead Eagle (re-exported under /realty/calendar and
 * /lead-eagle/calendar), and draws tasks, follow-ups and site visits inside the
 * caller's scope, events only where the plan has them (Sales or Real Estate),
 * on the workspace's clock: the month and each item's day are the workspace's,
 * not the server's.
 */
import { randomBytes } from 'node:crypto';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const cookieJar = vi.hoisted(() => ({ value: '', path: '/' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': cookieJar.path }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import CalendarPage from '@/app/(workspace)/[workspaceSlug]/sales/calendar/page';
import CalendarView from '@/app/(workspace)/[workspaceSlug]/sales/calendar/CalendarView';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const people: Record<'admin' | 'agent' | 'tasker', { id: string; cookie: string }> = {
  admin: { id: '', cookie: '' },
  agent: { id: '', cookie: '' },
  tasker: { id: '', cookie: '' },
};
const ids: Record<string, string> = {};

interface Item {
  id: string;
  kind: string;
  label: string;
  href?: string;
  day: string;
}

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@calendar.test`,
    fullName: `${label} ${suffix}`,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};

async function page(cookie: string, month: string) {
  cookieJar.value = cookie;
  return elements(await CalendarPage({ searchParams: Promise.resolve({ month }) }));
}
async function drawn(cookie: string, month: string): Promise<Item[]> {
  return (await page(cookie, month)).find((el) => el.type === CalendarView)!.props.items as Item[];
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `calendar-${suffix}`,
      legalName: 'Calendar LLC',
      displayName: 'Calendar',
      status: 'ACTIVE',
      timezone: 'Asia/Dubai',
    },
  });
  tenantId = tenant.id;
  // Lead Eagle alone: no events in the plan.
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const grants: Grants = [
    ['tasks', 'VIEW'],
    ['leads', 'VIEW'],
    ['visits', 'VIEW'],
    ['events', 'VIEW'],
    ['contacts', 'VIEW'],
  ];
  people.admin = await member('admin', grants, 'ORGANIZATION');
  people.agent = await member('agent', grants, 'OWN');
  // Tasks at every scope, and no grant on leads.
  people.tasker = await member('tasker', [['tasks', 'VIEW']], 'ORGANIZATION');

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: 'new', name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: {
      tenantId,
      reference: `CL-${suffix}`,
      fullName: 'Calendar lead',
      stageId: stage.id,
      ownerId: people.agent.id,
    },
  });
  const project = await prisma.project.create({ data: { tenantId, name: `Marina ${suffix}`, code: `CL-${suffix}` } });
  const type = await prisma.taskType.create({ data: { tenantId, key: `call-${suffix}`, name: 'Call' } });

  for (const [who, owner] of [
    ['agent', people.agent.id],
    ['admin', people.admin.id],
  ] as const) {
    // 01:00 on 1 December in Dubai: 30 November on a UTC server.
    ids[`task-${who}`] = (
      await prisma.task.create({
        data: {
          tenantId,
          typeId: type.id,
          ownerId: owner,
          leadId: lead.id,
          title: 'Call',
          dueAt: new Date('2026-11-30T21:00:00Z'),
        },
      })
    ).id;
    ids[`fup-${who}`] = (
      await prisma.followUpTask.create({
        data: { tenantId, ownerId: owner, leadId: lead.id, title: 'Chase', dueAt: new Date('2026-12-10T08:00:00Z') },
      })
    ).id;
    ids[`visit-${who}`] = (
      await prisma.siteVisit.create({
        data: {
          tenantId,
          ownerId: owner,
          leadId: lead.id,
          projectId: project.id,
          scheduledAt: new Date('2026-12-12T12:30:00Z'),
        },
      })
    ).id;
  }
  ids.lead = lead.id;
  ids['fup-tasker'] = (
    await prisma.followUpTask.create({
      data: {
        tenantId,
        ownerId: people.tasker.id,
        leadId: lead.id,
        title: 'Chase',
        dueAt: new Date('2026-12-11T08:00:00Z'),
      },
    })
  ).id;
  // Visits that will not happen, and a meeting with the client (no project).
  for (const status of ['CANCELLED', 'REJECTED'] as const) {
    ids[`visit-${status}`] = (
      await prisma.siteVisit.create({
        data: {
          tenantId,
          ownerId: people.admin.id,
          leadId: lead.id,
          projectId: project.id,
          status,
          decidedById: people.admin.id,
          scheduledAt: new Date('2026-12-13T12:30:00Z'),
        },
      })
    ).id;
  }
  ids.meeting = (
    await prisma.siteVisit.create({
      data: {
        tenantId,
        kind: 'CLIENT_MEETING',
        ownerId: people.admin.id,
        leadId: lead.id,
        address: 'Café on the Marina',
        scheduledAt: new Date('2026-12-14T08:00:00Z'),
      },
    })
  ).id;
  // Real Estate takes a client who is a contact, not a lead.
  const contact = await prisma.contact.create({
    data: { tenantId, reference: `CC-${suffix}`, fullName: 'Calendar contact', ownerId: people.admin.id },
  });
  ids['visit-contact'] = (
    await prisma.siteVisit.create({
      data: {
        tenantId,
        ownerId: people.admin.id,
        contactId: contact.id,
        projectId: project.id,
        scheduledAt: new Date('2026-12-16T08:00:00Z'),
      },
    })
  ).id;
  ids.event = (
    await prisma.event.create({
      data: {
        tenantId,
        title: 'Launch',
        startAt: new Date('2026-12-15T10:00:00Z'),
        endAt: new Date('2026-12-15T12:00:00Z'),
        hostId: people.admin.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the calendar in a Lead-Eagle-only workspace', () => {
  it('opens, and draws tasks, follow-ups and site visits; no events, which the plan lacks', async () => {
    const items = await drawn(people.admin.cookie, '2026-12');
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const who of ['agent', 'admin']) {
      expect(byId.get(`task-${ids[`task-${who}`]}`)?.kind).toBe('task');
      expect(byId.get(`fup-${ids[`fup-${who}`]}`)?.kind).toBe('follow-up');
      expect(byId.get(`visit-${ids[`visit-${who}`]}`)).toMatchObject({
        kind: 'visit',
        href: `/site-visits/${ids[`visit-${who}`]}`,
      });
    }
    expect(items.some((item) => item.kind === 'event')).toBe(false);
  });

  it('a follow-up opens the list it is on: Mine for your own, the team’s list for a colleague’s', async () => {
    const items = await drawn(people.admin.cookie, '2026-12');
    expect(items.find((item) => item.id === `fup-${ids['fup-admin']}`)?.href).toBe('/follow-ups?view=mine');
    expect(items.find((item) => item.id === `fup-${ids['fup-agent']}`)?.href).toBe('/follow-ups');
  });

  it('keeps to the caller’s scope', async () => {
    const shown = (await drawn(people.agent.cookie, '2026-12')).map((item) => item.id);
    for (const kind of ['task', 'fup', 'visit']) {
      expect(shown).toContain(`${kind}-${ids[`${kind}-agent`]}`);
      expect(shown).not.toContain(`${kind}-${ids[`${kind}-admin`]}`);
    }
  });

  it('reads the month and the day on the workspace’s clock', async () => {
    const december = await drawn(people.admin.cookie, '2026-12');
    expect(december.find((item) => item.id === `task-${ids['task-agent']}`)?.day).toBe('2026-12-01');
    expect(december.find((item) => item.id === `visit-${ids['visit-agent']}`)?.day).toBe('2026-12-12');
    const november = (await drawn(people.admin.cookie, '2026-11')).map((item) => item.id);
    expect(november).not.toContain(`task-${ids['task-agent']}`);
  });

  it('leaves off visits that will not happen, and calls a meeting a meeting', async () => {
    const items = await drawn(people.admin.cookie, '2026-12');
    const shown = items.map((item) => item.id);
    expect(shown).not.toContain(`visit-${ids['visit-CANCELLED']}`);
    expect(shown).not.toContain(`visit-${ids['visit-REJECTED']}`);
    // Each names its lead: two visits to one project are told apart.
    expect(items.find((item) => item.id === `visit-${ids.meeting}`)?.label).toBe('Meeting · Calendar lead');
    expect(items.find((item) => item.id === `visit-${ids['visit-admin']}`)?.label).toBe(
      `Site visit · Marina ${suffix} · Calendar lead`,
    );
  });

  /** A reader of every visit, with `leads` as given and an optional rule on the lead's name. */
  async function visitReader(label: string, leads: 'ORGANIZATION' | 'OWN' | null, nameRule?: string | null) {
    const role = await prisma.role.create({
      data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
    });
    await grantPermissions(
      tenantId,
      role.id,
      [
        ['tasks', 'VIEW'],
        ['visits', 'VIEW'],
      ],
      'ORGANIZATION',
    );
    if (leads) await grantPermissions(tenantId, role.id, [['leads', 'VIEW']], leads);
    if (nameRule !== undefined) {
      await prisma.fieldPermission.create({
        data: {
          tenantId,
          roleId: role.id,
          objectType: 'LEAD',
          fieldKey: 'fullName',
          canView: false,
          maskStrategy: nameRule,
        },
      });
    }
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `${label}-${suffix}@calendar.test`,
      fullName: `${label} ${suffix}`,
    });
    const items = await drawn(await createSessionToken(tenantId, user.id), '2026-12');
    return items.find((item) => item.id === `visit-${ids['visit-admin']}`)?.label;
  }

  it('names a visit’s lead as the lead list reads the name: masked or left out where a rule says so', async () => {
    expect(await visitReader('masked', 'ORGANIZATION', 'MASK_ALL')).toBe(`Site visit · Marina ${suffix} · •••••••••`);
    expect(await visitReader('hidden', 'ORGANIZATION', null)).toBe(`Site visit · Marina ${suffix}`);
  });

  it('names only a lead the reader’s lead scope reaches', async () => {
    // The visit is the admin's; the lead is the agent's, outside an OWN scope.
    expect(await visitReader('own-leads', 'OWN')).toBe(`Site visit · Marina ${suffix}`);
    expect(await visitReader('no-leads', null)).toBe(`Site visit · Marina ${suffix}`);
  });

  it('names a contact’s visit by the contact, for a reader of contacts', async () => {
    const label = (items: Item[]) => items.find((item) => item.id === `visit-${ids['visit-contact']}`)?.label;
    expect(label(await drawn(people.admin.cookie, '2026-12'))).toBe(`Site visit · Marina ${suffix} · Calendar contact`);
  });

  it('without leads:VIEW, the follow-ups are the caller’s own', async () => {
    const shown = (await drawn(people.tasker.cookie, '2026-12')).filter((item) => item.kind === 'follow-up');
    expect(shown.map((item) => item.id)).toEqual([`fup-${ids['fup-tasker']}`]);
  });

  it('a month past the cap draws the first 300 of a kind, by date, and says so', async () => {
    // Inserted latest first, so a read without an order returns the wrong end of the month.
    await prisma.followUpTask.createMany({
      data: Array.from({ length: 301 }, (_, i) => ({
        tenantId,
        ownerId: people.admin.id,
        leadId: ids.lead!,
        title: `Bulk ${300 - i}`,
        dueAt: new Date(Date.UTC(2027, 0, 2, 0, 300 - i)),
      })),
    });
    const tree = await page(people.admin.cookie, '2027-01');
    const labels = (tree.find((el) => el.type === CalendarView)!.props.items as Item[])
      .filter((item) => item.kind === 'follow-up')
      .map((item) => item.label);
    expect(labels).toHaveLength(300);
    expect(labels).toContain('Bulk 0');
    expect(labels).not.toContain('Bulk 300');
    const text = (el: ReactElement<Record<string, unknown>>) => [el.props.children].flat().join('');
    expect(tree.some((el) => text(el).includes('first 300'))).toBe(true);
    expect((await page(people.admin.cookie, '2026-12')).some((el) => text(el).includes('first 300'))).toBe(false);
  });

  it('events show where the plan has them, and not under Lead Eagle, which has no Events screen', async () => {
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'REAL_ESTATE', state: 'ACTIVE' } });
    await invalidateEntitlements(tenantId);
    try {
      cookieJar.path = `/calendar-${suffix}/realty/calendar`;
      expect(
        (await drawn(people.admin.cookie, '2026-12')).find((item) => item.id === `event-${ids.event}`),
      ).toMatchObject({ kind: 'event', href: `/events/${ids.event}` });
      cookieJar.path = `/calendar-${suffix}/lead-eagle/calendar`;
      expect((await drawn(people.admin.cookie, '2026-12')).some((item) => item.kind === 'event')).toBe(false);
    } finally {
      cookieJar.path = '/';
      await prisma.moduleEntitlement.deleteMany({ where: { tenantId, module: 'REAL_ESTATE' } });
      await invalidateEntitlements(tenantId);
    }
  });
});
