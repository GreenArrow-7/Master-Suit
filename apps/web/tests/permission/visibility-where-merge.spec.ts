/**
 * The visibility clause must survive everything that is merged next to it.
 *
 * Every CRM list route builds its Prisma `where` by spreading four fragments
 * into one object literal:
 *
 *   { ...scopeWhere, ...compileFilterTree(...), ...search, ...cursorWhere(cursor) }
 *
 * Three of those four can carry a top-level `OR`, and in an object literal the
 * last `OR` wins — the earlier ones are not merged, they are *discarded*.
 * `visibilityWhere` puts the ownership restriction in exactly that key:
 *
 *   { tenantId, OR: [ { ownerId: { in: [...] } }, { ownerId: null } ] }
 *
 * so a request carrying a cursor, or a filter whose root node is an OR, threw
 * the ownership restriction away and left `tenantId` as the only limit. RLS
 * still held the tenant boundary — but inside a workspace, a rep with OWN scope
 * saw every colleague's records. Page two of the grid was enough to do it; no
 * crafted request was needed.
 *
 * These are the regression tests for that. They deliberately paginate with
 * `limit=1`, because the bug lives in the second request, not the first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { get } from '../helpers/request';

let h: Hierarchy;
beforeAll(async () => {
  h = await seedHierarchy();
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

/**
 * Walks every page, one row at a time, and returns the owners seen.
 *
 * Page-at-a-time is the point: reading the whole list in one request never
 * produces a cursor, which is precisely why this went unnoticed. The page cap
 * is a guard against a broken cursor looping forever, not a limit on the data.
 */
async function ownersAcrossPages(cookie: string, query = ''): Promise<Set<string>> {
  const owners = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const url = `/api/v1/leads?limit=1${query}${cursor ? `&cursor=${cursor}` : ''}`;
    const res = await get(listLeads, url, cookie);
    expect(res.status).toBe(200);
    for (const lead of res.body.data) owners.add(lead.ownerId);
    cursor = res.body.nextCursor;
    if (!cursor) return owners;
  }
  throw new Error('pagination did not terminate');
}

/** `{"op":"OR","children":[…]}` as the route expects it: base64url of JSON. */
const filterParam = (tree: unknown) => `&filter=${Buffer.from(JSON.stringify(tree)).toString('base64url')}`;

describe('the visibility clause survives pagination', () => {
  it('OWN — a rep paging through the grid still sees only their own lead', async () => {
    expect([...(await ownersAcrossPages(h.repA1.cookie))]).toEqual([h.repA1.id]);
  });

  it('TEAM — a manager paging through the grid does not pick up another branch', async () => {
    const owners = await ownersAcrossPages(h.teamManagerA.cookie);
    expect(owners).toContain(h.repA1.id);
    expect(owners).toContain(h.repSubTeam.id);
    // The whole point: these two were reachable from page two.
    expect(owners).not.toContain(h.repB1.id);
    expect(owners).not.toContain(h.repOtherRegion.id);
  });

  it('a director still pages through the whole workspace', async () => {
    // The fix must not narrow anyone: ORGANIZATION scope has no ownership
    // clause to preserve, and paging must still reach every row.
    const owners = await ownersAcrossPages(h.director.cookie);
    expect(owners).toContain(h.repA1.id);
    expect(owners).toContain(h.repB1.id);
    expect(owners).toContain(h.repOtherRegion.id);
  });
});

describe('the visibility clause survives a filter', () => {
  // Matches every seeded lead (each is named `<member> lead`) and, crucially,
  // has an `OR` at its root — which is the shape that used to overwrite the
  // visibility clause.
  const everyLead = { op: 'OR', children: [{ field: 'fullName', cmp: 'contains', value: 'lead' }] };

  it('OWN — a root-level OR filter does not widen what a rep can see', async () => {
    const owners = await ownersAcrossPages(h.repA1.cookie, filterParam(everyLead));
    expect([...owners]).toEqual([h.repA1.id]);
  });

  it('TEAM — a root-level OR filter does not reach another branch', async () => {
    const owners = await ownersAcrossPages(h.teamManagerA.cookie, filterParam(everyLead));
    expect(owners).not.toContain(h.repB1.id);
    expect(owners).not.toContain(h.repOtherRegion.id);
  });

  it('a filter still filters — it is ANDed with visibility, not ignored', async () => {
    // Guards the other direction: a fix that merged by dropping the filter
    // would pass every test above and silently return unfiltered data.
    const noLead = { op: 'AND', children: [{ field: 'fullName', cmp: 'eq', value: '__no-such-lead__' }] };
    expect([...(await ownersAcrossPages(h.director.cookie, filterParam(noLead)))]).toEqual([]);
  });

  it('a filter and a cursor together keep both restrictions', async () => {
    const owners = await ownersAcrossPages(h.teamManagerA.cookie, filterParam(everyLead));
    expect(owners.size).toBeGreaterThan(1); // more than one page was walked
    expect(owners).not.toContain(h.repB1.id);
  });
});
