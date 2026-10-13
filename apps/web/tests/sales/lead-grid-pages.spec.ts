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
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The lead grid pages by keyset (M4-20): Next starts after the last row's sort
 * value and id, Previous ends before the first row's, both carried in the URL.
 * OFFSET walked every earlier row, and an agent's page 200 of a 100,000-lead
 * workspace took 150 to 400 ms in Postgres alone (changes/2026-10-13-lead-bulk-tag-delete-move.md).
 * Each sort walks the same 130 leads forward and back, ties on the sort value
 * included, each lead once and in the list's order.
 */
let fixture: Fixture;
let tenantId: string;
const TOTAL = 130;

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

/** One page as the grid shows it, and where its Previous and Next links go. */
async function open(search: Record<string, string>) {
  cookieJar.value = fixture.a.cookie;
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

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const base = Date.parse('2026-09-01T08:00:00Z');
  await prisma.lead.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      tenantId,
      reference: `PG-${i}-${tenantId.slice(-6)}`,
      // Every 13th shares a name, every pair shares its last update, scores repeat by tens.
      fullName: i % 13 === 0 ? 'Pager tie' : `Pager ${String((i * 37) % TOTAL).padStart(3, '0')}`,
      stageId: fixture.a.stageId,
      ownerId: fixture.a.userId,
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
    const expected = (
      await prisma.lead.findMany({
        where: { tenantId, fullName: { startsWith: 'Pager' } },
        orderBy: ORDER[sort],
        select: { id: true },
      })
    ).map((row) => row.id);
    expect(expected).toHaveLength(TOTAL);

    const first: Record<string, string> = { q: 'Pager', ...(sort === 'updated' ? {} : { sort }) };
    const pages: string[][] = [];
    let at: Record<string, string> | null = first;
    let last: Awaited<ReturnType<typeof open>> | null = null;
    while (at) {
      last = await open(at);
      pages.push(last.rows);
      if (last.next) expect(last.next.after, 'Next starts after the last row').toBeTruthy();
      at = last.next;
      if (pages.length > 5) throw new Error('no end');
    }
    expect(pages.map((page) => page.length)).toEqual([50, 50, 30]);
    expect(pages.flat()).toEqual(expected);

    // And back from the last page, through Previous.
    const back: string[][] = [];
    at = last!.prev;
    while (at) {
      expect(at.page === undefined || at.before, 'Previous ends before the first row').toBeTruthy();
      const page = await open(at);
      back.unshift(page.rows);
      at = page.prev;
    }
    expect(back).toEqual(pages.slice(0, -1));
  });

  it('still opens an old ?page=2 link, and ignores a cursor it cannot read', async () => {
    const expected = (
      await prisma.lead.findMany({
        where: { tenantId, fullName: { startsWith: 'Pager' } },
        orderBy: ORDER.updated,
        select: { id: true },
      })
    ).map((row) => row.id);
    expect((await open({ q: 'Pager', page: '2' })).rows).toEqual(expected.slice(50, 100));
    expect((await open({ q: 'Pager', page: '2', after: 'not-a-cursor' })).rows).toEqual(expected.slice(50, 100));
  });
});
