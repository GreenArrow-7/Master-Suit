/**
 * Saved views and filter chips on the lead grid (M4-19), for every lead module.
 *
 * The chips combine: stage + owner + source (the catalogue, a source taking its
 * sub-sources with it) + a created or updated date range read on the
 * workspace's clock, beside the named filters and the search, in the URL. The
 * list, the board and the CSV export answer them from one query
 * (`leadListQuery`), inside the caller's lead scope. A saved view is a
 * person's own: its name, those filters, its columns and its sort. Nobody else
 * sees it or deletes it (404), and saving and deleting one is audited.
 * Acceptance (audit row): an agent saves "My overdue Bayut leads" and reopens it.
 */
import { randomBytes } from 'node:crypto';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/db';
import { POST as saveView } from '@/app/api/v1/leads/views/route';
import { DELETE as deleteView } from '@/app/api/v1/leads/views/[id]/route';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid, { type LeadRow } from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import LeadFilters from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadFilters';
import LeadViews from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadViews';
import { ensureLeadSources } from '@/services/leads/leadSources';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const people: Record<'admin' | 'agent' | 'other', { id: string; cookie: string }> = {
  admin: { id: '', cookie: '' },
  agent: { id: '', cookie: '' },
  other: { id: '', cookie: '' },
};
const stages: Record<'fresh' | 'meeting', string> = { fresh: '', meeting: '' };
const sources: Record<'bayut' | 'website' | 'marina', string> = { bayut: '', website: '', marina: '' };
const leads: Record<string, string> = {};

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@views.test`,
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

async function page(cookie: string, params: Record<string, string>) {
  cookieJar.value = cookie;
  const tree = elements(await LeadsPage({ searchParams: Promise.resolve(params) }));
  const props = (type: unknown) => tree.find((el) => el.type === type)?.props;
  return {
    rows: ((props(LeadGrid)?.rows as LeadRow[] | undefined) ?? []).map((row) => row.id),
    grid: props(LeadGrid),
    filters: props(LeadFilters),
    views: props(LeadViews),
  };
}
const names = (ids: string[]) =>
  ids.map((id) => Object.entries(leads).find(([, value]) => value === id)?.[0] ?? id).sort();

/** A module-relative `/leads?…` link as the page's searchParams. */
const paramsOf = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `views-${suffix}`,
      legalName: 'Views LLC',
      displayName: 'Views',
      status: 'ACTIVE',
      timezone: 'Asia/Dubai',
    },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const work: Grants = [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'EXPORT'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
  ];
  people.admin = await member('admin', [...work, ['leads', 'ASSIGN']], 'ORGANIZATION');
  people.agent = await member('agent', work, 'OWN');
  people.other = await member('other', work, 'OWN');

  stages.fresh = (
    await prisma.leadStage.create({ data: { tenantId, key: 'new', name: 'New', position: 0, isDefault: true } })
  ).id;
  stages.meeting = (
    await prisma.leadStage.create({ data: { tenantId, key: 'meeting', name: 'Meeting', position: 1 } })
  ).id;
  await ensureLeadSources(prisma, tenantId);
  const key = async (k: string) => (await prisma.leadSource.findFirstOrThrow({ where: { tenantId, key: k } })).id;
  sources.bayut = await key('bayut');
  sources.website = await key('website');
  sources.marina = (
    await prisma.leadSource.create({
      data: { tenantId, key: 'website_marina', name: 'Marina', parentId: sources.website },
    })
  ).id;

  const lead = async (name: string, data: Record<string, unknown>) => {
    leads[name] = (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `VW-${randomBytes(4).toString('hex')}`,
          fullName: `${name} ${suffix}`,
          stageId: stages.meeting,
          ownerId: people.agent.id,
          sourceId: sources.bayut,
          // 01:00 on 2 October in Dubai, still 1 October in UTC.
          createdAt: new Date('2026-10-01T21:00:00Z'),
          ...data,
        } as never,
      })
    ).id;
  };
  await lead('match', { score: 40 });
  await lead('lateFirst', { createdAt: new Date('2026-10-01T19:00:00Z'), score: 90 }); // 23:00 on 1 October in Dubai
  await lead('newStage', { stageId: stages.fresh });
  await lead('otherOwner', { ownerId: people.other.id });
  await lead('marina', { sourceId: sources.marina });
  await lead('website', { sourceId: sources.website, score: 70 });
  await lead('unassigned', { ownerId: null });

  // Overdue follow-ups the agent owes: one Bayut lead, one Website lead.
  for (const name of ['match', 'website']) {
    await prisma.followUpTask.create({
      data: {
        tenantId,
        leadId: leads[name],
        ownerId: people.agent.id,
        title: 'Call back',
        dueAt: new Date(Date.now() - 86_400_000),
      },
    });
  }
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the filter chips combine, in the URL, inside the lead scope', () => {
  it('stage + owner + source + created date answer together', async () => {
    const { rows } = await page(people.admin.cookie, {
      stage: stages.meeting,
      owner: people.agent.id,
      source: sources.bayut,
      date: 'created',
      from: '2026-10-02',
      to: '2026-10-02',
    });
    expect(names(rows)).toEqual(['match']);
  });

  it('the date range is the workspace’s day, not UTC’s', async () => {
    const { rows } = await page(people.admin.cookie, { from: '2026-10-01', to: '2026-10-01' });
    expect(names(rows)).toEqual(['lateFirst']);
  });

  it('the updated date is its own choice', async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await page(people.admin.cookie, { date: 'updated', from: future })).rows).toEqual([]);
    expect((await page(people.admin.cookie, { date: 'created', to: '2026-09-30' })).rows).toEqual([]);
  });

  it('a source takes its sub-sources with it; a sub-source is only itself', async () => {
    expect(names((await page(people.admin.cookie, { source: sources.website })).rows)).toEqual(['marina', 'website']);
    expect(names((await page(people.admin.cookie, { source: sources.marina })).rows)).toEqual(['marina']);
  });

  it('owner "none" is the unassigned leads', async () => {
    expect(names((await page(people.admin.cookie, { owner: 'none' })).rows)).toEqual(['unassigned']);
  });

  it('a chip never reaches past the scope: an agent filtering on a colleague sees nothing', async () => {
    expect((await page(people.agent.cookie, { owner: people.other.id })).rows).toEqual([]);
    expect(names((await page(people.agent.cookie, { stage: stages.fresh })).rows)).toEqual(['newStage']);
  });

  it('the chips are offered from the workspace’s stages and catalogue, and the people in scope', async () => {
    const { filters } = await page(people.agent.cookie, {});
    expect((filters!.stages as { id: string }[]).map((stage) => stage.id)).toEqual([stages.fresh, stages.meeting]);
    expect((filters!.sources as { id: string }[]).map((source) => source.id)).toEqual(
      expect.arrayContaining([sources.bayut, sources.website, sources.marina]),
    );
    // An agent at OWN scope filters on themselves, or on nobody.
    expect((filters!.owners as { id: string }[]).map((owner) => owner.id)).toEqual([people.agent.id]);
    const admin = await page(people.admin.cookie, { stage: stages.meeting });
    expect((admin.filters!.owners as { id: string }[]).map((owner) => owner.id)).toEqual(
      expect.arrayContaining([people.agent.id, people.other.id]),
    );
    expect(admin.filters!.params).toEqual({ stage: stages.meeting });
  });

  it('the CSV export answers the same chips', async () => {
    const query = new URLSearchParams({ stage: stages.meeting, owner: people.agent.id, from: '2026-10-02' });
    const res = await exportLeads(
      new Request(`http://localhost/api/v1/leads/export?${query}`, { headers: { cookie: people.admin.cookie } }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    for (const name of ['match', 'marina', 'website']) expect(csv).toContain(`${name} ${suffix}`);
    for (const name of ['lateFirst', 'newStage', 'otherOwner']) expect(csv).not.toContain(`${name} ${suffix}`);
  });
});

describe('a saved view is a person’s own', () => {
  let viewId = '';

  it('an agent saves "My overdue Bayut leads" with its columns and sort, and reopens it', async () => {
    const saved = await post(
      saveView,
      '/api/v1/leads/views',
      {
        name: 'My overdue Bayut leads',
        params: { filter: 'overdue', source: sources.bayut, sort: 'score', page: '3', saved: 'x' },
        columns: ['stage', 'nextFollowUpAt', 'not-a-column'],
      },
      people.agent.cookie,
    );
    expect(saved.status).toBe(200);
    viewId = saved.body.id;
    const row = await prisma.smartView.findFirstOrThrow({ where: { tenantId, id: viewId } });
    expect(row).toMatchObject({ ownerId: people.agent.id, visibility: 'PERSONAL', objectType: 'LEAD_LIST' });

    const { views } = await page(people.agent.cookie, {});
    const offered = (views!.views as { id: string; name: string; href: string }[]).find((view) => view.id === viewId)!;
    expect(offered.name).toBe('My overdue Bayut leads');
    const params = paramsOf(offered.href);
    expect(params).toEqual({
      filter: 'overdue',
      source: sources.bayut,
      sort: 'score',
      cols: 'stage,nextFollowUpAt',
      saved: viewId,
    });

    const reopened = await page(people.agent.cookie, params);
    expect(names(reopened.rows)).toEqual(['match']);
    expect((reopened.grid!.columns as { key: string }[]).map((column) => column.key)).toEqual([
      'reference',
      'fullName',
      'stage',
      'nextFollowUpAt',
    ]);
    expect(reopened.views!.activeId).toBe(viewId);
  });

  it('the sort is the server’s, and the grid starts from it', async () => {
    const byScore = await page(people.admin.cookie, { sort: 'score', source: sources.bayut, stage: stages.meeting });
    expect(names(byScore.rows.slice(0, 2))).toEqual(['lateFirst', 'match'].sort());
    expect(byScore.rows[0]).toBe(leads.lateFirst);
    expect(byScore.grid!.sort).toEqual({ key: 'score', dir: 'desc' });
    expect((await page(people.admin.cookie, { sort: 'created' })).grid!.sort).toBeNull();
  });

  it('nobody else sees it, opens it as theirs, or deletes it', async () => {
    const theirs = await page(people.admin.cookie, {});
    expect((theirs.views!.views as { id: string }[]).map((view) => view.id)).not.toContain(viewId);
    expect((await page(people.admin.cookie, { saved: viewId })).views!.activeId).toBeNull();
    expect((await del(deleteView, `/api/v1/leads/views/${viewId}`, people.admin.cookie, { id: viewId })).status).toBe(
      404,
    );
    expect(await prisma.smartView.count({ where: { tenantId, id: viewId } })).toBe(1);
  });

  it('its owner deletes it, and both writes are audited', async () => {
    expect((await del(deleteView, `/api/v1/leads/views/${viewId}`, people.agent.cookie, { id: viewId })).status).toBe(
      200,
    );
    expect(await prisma.smartView.count({ where: { tenantId, id: viewId } })).toBe(0);
    const { views } = await page(people.agent.cookie, {});
    expect((views!.views as { id: string }[]).map((view) => view.id)).not.toContain(viewId);
    const trail = await prisma.auditLog.findMany({
      where: { tenantId, recordId: viewId },
      select: { event: true, actorUserId: true },
    });
    expect(trail.map((entry) => entry.event).sort()).toEqual(['RECORD_CREATED', 'RECORD_DELETED']);
    expect(trail.every((entry) => entry.actorUserId === people.agent.id)).toBe(true);
  });

  it('a view needs a name', async () => {
    const res = await post(saveView, '/api/v1/leads/views', { name: ' ', params: {} }, people.agent.cookie);
    expect(res.status).toBe(422);
  });

  it('a view may show the workspace’s custom fields as columns (M4-13)', async () => {
    await prisma.leadCustomFieldDefinition.create({
      data: { tenantId, key: 'budget', label: 'Budget', type: 'TEXT' },
    });
    const saved = await post(
      saveView,
      '/api/v1/leads/views',
      { name: 'Budgets', params: {}, columns: ['cf:budget', 'cf:not_a_field'] },
      people.agent.cookie,
    );
    expect(saved.status).toBe(200);
    const reopened = await page(people.agent.cookie, paramsOf(saved.body.href));
    expect((reopened.grid!.columns as { key: string }[]).map((column) => column.key)).toEqual([
      'reference',
      'fullName',
      'cf:budget',
    ]);
  });
});
