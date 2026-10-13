import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// The page reads the session from the request's cookie.
const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import Pager from '@/components/workspace/Pager';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * The lead grid pages by keyset (M4-20): Next starts after the last row,
 * Previous ends before the first, each named in the URL by its id alone.
 * OFFSET walked every earlier row, and an agent's page 200 of a 100,000-lead
 * workspace took 150 to 400 ms in Postgres alone (changes/2026-10-13-lead-bulk-tag-delete-move.md).
 * Each sort walks the same 130 leads forward and back, ties on the sort value
 * included, each lead once and in the list's order; an OWN agent walks theirs.
 */
let fixture: Fixture;
let tenantId: string;
const TOTAL = 130;
const agent = { id: '', cookie: '' };

const ORDER: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: 'desc' }, { id: 'desc' }],
  created: [{ createdAt: 'desc' }, { id: 'desc' }],
  score: [{ score: 'desc' }, { id: 'desc' }],
  name: [{ fullName: 'asc' }, { id: 'asc' }],
};

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};

/** One page as the grid shows it to `cookie`, and where its Previous and Next links go. */
async function open(search: Record<string, string>, cookie = fixture.a.cookie) {
  cookieJar.value = cookie;
  const tree = elements(await LeadsPage({ searchParams: Promise.resolve(search) }));
  const rows = ((tree.find((el) => el.type === LeadGrid)?.props.rows ?? []) as { id: string }[]).map((r) => r.id);
  const pager = tree.find((el) => el.type === Pager)?.props as Parameters<typeof Pager>[0] | undefined;
  const links = pager ? elements(Pager(pager)).filter((el) => typeof el.props.href === 'string') : [];
  const link = (label: RegExp) => {
    const el = links.find((l) => label.test(String(l.props.children)));
    return el ? Object.fromEntries(new URL(String(el.props.href), 'http://x').searchParams) : null;
  };
  return { rows, prev: link(/Previous/), next: link(/Next/) };
}

/**
 * Every page from `first` through Next, then back through Previous. Each link
 * names its boundary lead by id alone: no name or score in a URL.
 */
async function walk(first: Record<string, string>, cookie?: string) {
  const pages: string[][] = [];
  let at: Record<string, string> | null = first;
  let last: Awaited<ReturnType<typeof open>> | null = null;
  while (at) {
    last = await open(at, cookie);
    pages.push(last.rows);
    if (last.next) expect(last.next.after, 'Next names the last row by its id').toBe(last.rows.at(-1));
    at = last.next;
    if (pages.length > 5) throw new Error('no end');
  }
  const back: string[][] = [];
  at = last!.prev;
  while (at) {
    expect(at.page === undefined || at.before, 'Previous ends before the first row').toBeTruthy();
    const page = await open(at, cookie);
    if (page.next) expect(page.next.after).toBe(page.rows.at(-1));
    // Page 1 is the list's start, named by no row.
    if (page.prev?.page) expect(page.prev.before, 'Previous names the first row by its id').toBe(page.rows[0]);
    back.unshift(page.rows);
    at = page.prev;
  }
  return { pages, back };
}

const ids = async (where: Prisma.LeadWhereInput, orderBy: Prisma.LeadOrderByWithRelationInput[]) =>
  (await prisma.lead.findMany({ where: { tenantId, ...where }, orderBy, select: { id: true } })).map((row) => row.id);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const role = await prisma.role.create({
    data: { tenantId, key: `pager-agent-${tenantId.slice(-6)}`, name: 'Pager agent', rank: 60, defaultScope: 'OWN' },
  });
  await grantPermissions(tenantId, role.id, [['leads', 'VIEW']], 'OWN');
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `pager-agent@${fixture.a.slug}.test`,
    fullName: 'Pager agent',
  });
  agent.id = user.id;
  agent.cookie = await createSessionToken(tenantId, user.id);
  const base = Date.parse('2026-09-01T08:00:00Z');
  await prisma.lead.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      tenantId,
      reference: `PG-${i}-${tenantId.slice(-6)}`,
      // Every 13th shares a name, every pair shares its last update, scores repeat by tens.
      fullName: i % 13 === 0 ? 'Pager tie' : `Pager ${String((i * 37) % TOTAL).padStart(3, '0')}`,
      stageId: fixture.a.stageId,
      // Two in three the agent's: an OWN list of two pages that is not every other row.
      ownerId: i % 3 === 0 ? fixture.a.userId : agent.id,
      score: (i * 7) % 10,
      createdAt: new Date(base - i * 60_000),
      updatedAt: new Date(base + Math.floor(i / 2) * 60_000),
    })),
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('the lead grid pages by keyset', () => {
  it.each(Object.keys(ORDER))('sorted by %s: Next and Previous walk every lead once, in order', async (sort) => {
    const expected = await ids({ fullName: { startsWith: 'Pager' } }, ORDER[sort]!);
    expect(expected).toHaveLength(TOTAL);

    const { pages, back } = await walk({ q: 'Pager', ...(sort === 'updated' ? {} : { sort }) });
    expect(pages.map((page) => page.length)).toEqual([50, 50, 30]);
    expect(pages.flat()).toEqual(expected);
    expect(back).toEqual(pages.slice(0, -1));
  });

  it('walks an OWN agent’s list the same way, with a date chip on the column it sorts by', async () => {
    const expected = await ids({ fullName: { startsWith: 'Pager' }, ownerId: agent.id }, ORDER.updated!);
    expect(expected).toHaveLength(86);
    // The chip bounds updatedAt, as the cursor does: both stand.
    const { pages, back } = await walk(
      { q: 'Pager', date: 'updated', from: '2026-08-31', to: '2026-09-02' },
      agent.cookie,
    );
    expect(pages.map((page) => page.length)).toEqual([50, 36]);
    expect(pages.flat()).toEqual(expected);
    expect(back).toEqual(pages.slice(0, -1));

    const byName = await ids({ fullName: { startsWith: 'Pager' }, ownerId: agent.id }, ORDER.name!);
    const named = await walk({ q: 'Pager', sort: 'name' }, agent.cookie);
    expect(named.pages.flat()).toEqual(byName);
  });

  it('still opens an old ?page=2 link, and ignores a cursor it cannot read or a lead not in the list', async () => {
    const expected = await ids({ fullName: { startsWith: 'Pager' } }, ORDER.updated!);
    expect((await open({ q: 'Pager', page: '2' })).rows).toEqual(expected.slice(50, 100));
    expect((await open({ q: 'Pager', page: '2', after: 'not-a-cursor' })).rows).toEqual(expected.slice(50, 100));
    // Another workspace's lead is no lead of this list: the link reads as a bare page.
    const foreign = fixture.b.leadIds[0]!;
    expect((await open({ q: 'Pager', page: '2', after: foreign })).rows).toEqual(expected.slice(50, 100));
  });
});
