/**
 * The lead search (OWN-01.2): a phone typed in any format finds the lead by
 * its main number or by any of its other numbers (LeadPhone), normalised
 * the way the lead's numbers were stored (`normalizePhone`, +971 by default);
 * name, email and reference find it too. One search for the lead list, the
 * v1 list API, the CSV export and the assistant (`leadSearch`), so the four
 * cannot answer one query differently. A role that sees numbers masked finds a
 * lead by a whole number only and still reads it masked; nobody finds a lead
 * outside their scope. Cmd+K's "Search leads" goes to that list in every lead
 * module (tests/unit/workspace-nav.spec.ts).
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
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid, { type LeadRow } from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
// Seven random digits, so the numbers are this run's own.
const tail = String(Number.parseInt(randomBytes(3).toString('hex'), 16) % 10_000_000).padStart(7, '0');
const OTHER = `+97150${tail}`; // the second lead's other number, normalised
const MAIN = `+97155${tail}`; // the first lead's main number, normalised
const local = (n: string) => `0${n.slice(4, 6)} ${n.slice(6, 9)} ${n.slice(9)}`; // "050 123 4567"

let tenantId = '';
const cookies: Record<'admin' | 'masked' | 'rep', string> = { admin: '', masked: '', rep: '' };
const ids: Record<'main' | 'other' | 'repOwn', string> = { main: '', other: '', repOwn: '' };

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION' = 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@search.test`,
    fullName: label,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};

/** The rows the lead list draws for `q`. */
async function listed(cookie: string, q: string): Promise<LeadRow[]> {
  cookieJar.value = cookie;
  const tree = await LeadsPage({ searchParams: Promise.resolve({ q }) });
  return (elements(tree).find((el) => el.type === LeadGrid)?.props.rows as LeadRow[] | undefined) ?? [];
}
const found = async (cookie: string, q: string) => (await listed(cookie, q)).map((row) => row.id);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `search-${suffix}`, legalName: 'Search LLC', displayName: 'Search', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  // Lead Eagle alone: the product the search is for.
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const reads: Grants = [
    ['leads', 'VIEW'],
    ['leads', 'EXPORT'],
  ];
  const admin = await member('admin', [...reads, ['leads', 'VIEW_SENSITIVE_FIELDS']]);
  const masked = await member('masked', reads);
  const rep = await member('rep', [...reads, ['leads', 'VIEW_SENSITIVE_FIELDS']], 'OWN');
  cookies.admin = admin.cookie;
  cookies.masked = masked.cookie;
  cookies.rep = rep.cookie;
  // The grid shows the phone only where the workspace chose it.
  await prisma.organizationSetting.create({ data: { tenantId, gridColumns: { LEAD: ['phone', 'email'] } } });

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = (data: Record<string, unknown>) =>
    prisma.lead.create({
      data: { tenantId, reference: `SR-${randomBytes(4).toString('hex')}`, stageId: stage.id, ...data } as never,
    });
  // Its main number typed with dashes; stored as typed, normalised beside it.
  ids.main = (
    await lead({
      fullName: `Main Number ${suffix}`,
      phone: local(MAIN).replaceAll(' ', '-'),
      phoneNormalized: MAIN,
      email: `main.${suffix}@example.com`,
      ownerId: admin.id,
    })
  ).id;
  // Reached only through one of its other numbers.
  ids.other = (
    await lead({
      fullName: `Other Number ${suffix}`,
      phone: '+971 4 000 0000',
      phoneNormalized: '+97140000000',
      ownerId: admin.id,
    })
  ).id;
  await prisma.leadPhone.create({
    data: { tenantId, leadId: ids.other, raw: local(OTHER), normalized: OTHER, label: 'Mobile' },
  });
  ids.repOwn = (await lead({ fullName: `Rep Own ${suffix}`, ownerId: rep.id })).id;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('a phone in any format finds the lead by any of its numbers', () => {
  it.each([
    local(OTHER), // 050 123 4567
    OTHER, // +971501234567
    `+971 ${OTHER.slice(4, 6)} ${OTHER.slice(6, 9)} ${OTHER.slice(9)}`,
    `00${OTHER.slice(1)}`, // 00971…
    OTHER.slice(4), // 501234567
    `(0${OTHER.slice(4, 6)}) ${OTHER.slice(6)}`,
  ])('%s finds the lead stored with it as another number', async (typed) => {
    expect(await found(cookies.admin, typed)).toEqual([ids.other]);
  });

  it('a main number stored as typed (dashes) is found in another format', async () => {
    expect(await found(cookies.admin, MAIN)).toEqual([ids.main]);
    expect(await found(cookies.admin, local(MAIN))).toEqual([ids.main]);
  });

  it('name, email and reference still find it', async () => {
    const { reference } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: ids.main } });
    expect(await found(cookies.admin, `Main Number ${suffix}`)).toEqual([ids.main]);
    expect(await found(cookies.admin, `main.${suffix}@example.com`)).toEqual([ids.main]);
    expect(await found(cookies.admin, reference)).toEqual([ids.main]);
  });
});

describe('the same search behind the list API and the export', () => {
  it('GET /api/v1/leads?q= finds the lead by its other number', async () => {
    const res = await get(listLeads, `/api/v1/leads?q=${encodeURIComponent(local(OTHER))}`, cookies.admin);
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([ids.other]);
  });

  it('the CSV export of the same query holds it, and nothing else', async () => {
    const res = await exportLeads(
      new Request(`http://localhost/api/v1/leads/export?q=${encodeURIComponent(local(OTHER))}`, {
        headers: { cookie: cookies.admin },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain(`Other Number ${suffix}`);
    expect(csv).not.toContain(`Main Number ${suffix}`);
  });
});

describe('masked numbers and scope', () => {
  it('a role that sees numbers masked finds the lead by a whole number, and reads it masked', async () => {
    const rows = await listed(cookies.masked, local(OTHER));
    expect(rows.map((row) => row.id)).toEqual([ids.other]);
    expect(rows[0]!.phone).toContain('•');
    const mainRows = await listed(cookies.masked, MAIN);
    expect(mainRows.map((row) => row.id)).toEqual([ids.main]);
    expect(mainRows[0]!.phone).not.toContain(MAIN.slice(4, 9));
  });

  it('a masked role never finds a lead by a fragment of a number', async () => {
    expect(await found(cookies.masked, OTHER.slice(-4))).toEqual([]);
    expect(await found(cookies.masked, OTHER.slice(-7))).toEqual([]);
  });

  it('nobody finds a lead outside their scope by its number', async () => {
    expect(await found(cookies.rep, local(OTHER))).toEqual([]);
    expect(await found(cookies.rep, MAIN)).toEqual([]);
    expect(await found(cookies.rep, `Rep Own ${suffix}`)).toEqual([ids.repOwn]);
  });
});
