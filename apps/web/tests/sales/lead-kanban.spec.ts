/**
 * The lead board (M4-21): the leads list as columns, one per stage of the
 * workspace's pipeline in its order, the exits (lost, junk) grouped after the
 * ladder, over the same scoped query as the list (`leadListQuery`): the same
 * leads for the same chips, search and named filter. Each column shows a page
 * of its leads with its whole count and a link to the rest. A card moves by
 * drag or by its Move menu through `PATCH /api/v1/leads/{id}`, the lead page's
 * path; a stage that asks for a reason or books a visit or meeting opens the
 * mini-form first (`asksBeforeMove`), and the server refuses the move without
 * it (changes/2026-10-12-lead-eagle-pipeline-stages.md).
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
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid, { type LeadRow } from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import LeadBoard, { type BoardColumn } from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadBoard';
import { asksBeforeMove } from '@/components/workspace/StageReason';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { patch } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const people: Record<'admin' | 'agent', { id: string; cookie: string }> = {
  admin: { id: '', cookie: '' },
  agent: { id: '', cookie: '' },
};
const stage: Record<'fresh' | 'meeting' | 'booked' | 'dropped' | 'junk', string> = {
  fresh: '',
  meeting: '',
  booked: '',
  dropped: '',
  junk: '',
};

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@board.test`,
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

async function render(cookie: string, params: Record<string, string>) {
  cookieJar.value = cookie;
  return elements(await LeadsPage({ searchParams: Promise.resolve(params) }));
}
async function board(cookie: string, params: Record<string, string> = {}) {
  const tree = await render(cookie, { ...params, layout: 'board' });
  return tree.find((el) => el.type === LeadBoard)?.props.columns as BoardColumn[] | undefined;
}
async function list(cookie: string, params: Record<string, string> = {}) {
  const tree = await render(cookie, params);
  return ((tree.find((el) => el.type === LeadGrid)?.props.rows as LeadRow[] | undefined) ?? []).map((row) => row.id);
}
const onBoard = (columns: BoardColumn[] | undefined) => (columns ?? []).flatMap((c) => c.rows.map((row) => row.id));

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `board-${suffix}`, legalName: 'Board LLC', displayName: 'Board', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const work: Grants = [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
  ];
  people.admin = await member('admin', work, 'ORGANIZATION');
  people.agent = await member('agent', work, 'OWN');

  // An exit sits between the ladder's stages by position; the board still groups it last.
  const make = (key: string, position: number, extra: Record<string, unknown> = {}) =>
    prisma.leadStage
      .create({ data: { tenantId, key, name: key[0]!.toUpperCase() + key.slice(1), position, ...extra } as never })
      .then((row) => row.id);
  stage.fresh = await make('new', 0, { isDefault: true });
  stage.dropped = await make('dropped', 1, { category: 'TERMINAL_NEGATIVE', requiresReason: true });
  stage.meeting = await make('meeting', 2, { requiredFields: ['meetingAt'] });
  stage.booked = await make('booked', 3, { category: 'CONVERSION' });
  stage.junk = await make('junk', 4, { category: 'TERMINAL_JUNK' });

  const lead = (fullName: string, stageId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
    prisma.lead.create({
      data: {
        tenantId,
        reference: `KB-${randomBytes(4).toString('hex')}`,
        fullName: `${fullName} ${suffix}`,
        stageId,
        ownerId,
        ...extra,
      } as never,
    });
  // More New leads than a column shows.
  for (let i = 0; i < 27; i++) await lead(`Fresh ${i}`, stage.fresh, people.agent.id);
  await lead('Meeting', stage.meeting, people.agent.id, { score: 80 });
  await lead('Booked', stage.booked, people.admin.id);
  await lead('Dropped', stage.dropped, people.agent.id, { stageReason: 'Budget' });
  // Closed out: off every working list, the board included.
  await lead('Archived', stage.fresh, people.agent.id, { status: 'ARCHIVED' });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the board is the list, by stage', () => {
  it('has a column per stage in the pipeline’s order, the exits grouped after the ladder', async () => {
    const columns = (await board(people.admin.cookie))!;
    expect(columns.map((column) => column.stage.id)).toEqual([
      stage.fresh,
      stage.meeting,
      stage.booked,
      stage.dropped,
      stage.junk,
    ]);
    expect(columns.map((column) => column.exit)).toEqual([false, false, false, true, true]);
  });

  it('shows a page of each column with its whole count, and a link to the rest', async () => {
    const fresh = (await board(people.admin.cookie))!.find((column) => column.stage.id === stage.fresh)!;
    expect(fresh.count).toBe(27);
    expect(fresh.rows.length).toBeLessThan(27);
    expect(fresh.moreHref).toBe(`/leads?stage=${stage.fresh}`);
    const junk = (await board(people.admin.cookie))!.find((column) => column.stage.id === stage.junk)!;
    expect([junk.count, junk.rows, junk.moreHref]).toEqual([0, [], null]);
  });

  it.each([
    ['everything', {}],
    ['a search', { q: 'Meeting' }],
    ['a named filter', { filter: 'high_score' }],
    ['a chip', { stage: stage.dropped }],
  ])('draws the leads the list does for %s', async (_label, params: Record<string, string>) => {
    const listed = await list(people.admin.cookie, params);
    const columns = (await board(people.admin.cookie, params))!;
    expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(listed.length);
    // Every card is a listed lead; a column past its page counts the rest.
    expect(onBoard(columns).every((id) => listed.includes(id))).toBe(true);
  });

  it('keeps to the caller’s scope', async () => {
    const columns = (await board(people.agent.cookie))!;
    const booked = columns.find((column) => column.stage.id === stage.booked)!;
    expect(booked.count).toBe(0);
    expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(29);
  });

  it('carries the board’s query on the switch back to the list', async () => {
    const tree = await render(people.admin.cookie, { layout: 'board', q: 'Meeting' });
    const hrefs = tree.map((el) => el.props.href).filter((href): href is string => typeof href === 'string');
    expect(hrefs).toContain('/leads?q=Meeting');
    expect(hrefs).toContain('/leads?q=Meeting&layout=board');
  });
});

describe('a move from the board needs what the stage asks for', () => {
  it('hands each column what its stage asks, so a drop there opens the mini-form', async () => {
    const columns = (await board(people.admin.cookie))!;
    const asks = Object.fromEntries(columns.map((column) => [column.stage.id, asksBeforeMove(column.stage)]));
    expect(asks).toEqual({
      [stage.fresh]: false,
      [stage.meeting]: true,
      [stage.booked]: false,
      [stage.dropped]: true,
      [stage.junk]: false,
    });
  });

  it('the server refuses a drop without the mini-form’s fields, and takes it with them', async () => {
    const leadId = (await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName: `Fresh 0 ${suffix}` } })).id;
    const move = (body: Record<string, unknown>) =>
      patch(patchLead, `/api/v1/leads/${leadId}`, body, people.admin.cookie);
    expect((await move({ stageId: stage.meeting })).status).toBe(422);
    expect((await move({ stageId: stage.dropped })).status).toBe(422);
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId } })).stageId).toBe(stage.fresh);
    expect((await move({ stageId: stage.dropped, stageReason: 'Bought elsewhere' })).status).toBe(200);
    expect((await move({ stageId: stage.booked })).status).toBe(200);
  });

  it('a column outside the caller’s scope is not a way in: the move answers 404', async () => {
    const theirs = (await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName: `Booked ${suffix}` } })).id;
    const res = await patch(patchLead, `/api/v1/leads/${theirs}`, { stageId: stage.fresh }, people.agent.cookie);
    expect(res.status).toBe(404);
  });
});
