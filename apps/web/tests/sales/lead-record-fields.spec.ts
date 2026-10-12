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

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listSources, PATCH as editSource, POST as addSource } from '@/app/api/v1/lead-sources/route';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { GET as getLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { runReport } from '@/services/leadership/reports';
import { DEFAULT_LEAD_SOURCES } from '@/services/leads/leadSources';
import { GRID_COLUMNS } from '@/lib/grid/columns';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid, { leadCell, type LeadRow } from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, patch, post } from '../helpers/request';

/**
 * Lead Eagle audit rows M4-03 (sources, sub-sources, campaign), M4-07
 * (nationality), M4-09 (secondary owner), M4-10 (tags on the screens) and
 * M4-51 (duplicate check on edit), 12 Oct. M4-02 (the main number's WhatsApp
 * flag) and the edit check across a lead's numbers are in
 * lead-source-intake.spec.ts, beside the intake that sets them.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** A second active member of workspace A, to be named as a secondary owner. */
let colleagueId: string;
/** Reads the catalogue and edits leads, without `settings:MANAGE_CONFIGURATION` or `leads:ASSIGN`. */
let reader: string;

const app = path.join(__dirname, '..', '..', 'src', 'app', '(workspace)', '[workspaceSlug]', 'sales', 'leads');

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId, [
    ['settings', 'VIEW'],
    ['settings', 'MANAGE_CONFIGURATION'],
    ['reports', 'VIEW'],
  ]);
  // Workspace B's administrator reads its own catalogue, to show A's is not in it.
  const b = await prisma.user.findFirstOrThrow({
    where: { tenantId: fixture.b.tenantId, id: fixture.b.userId },
    select: { roleId: true },
  });
  await grantPermissions(fixture.b.tenantId, b.roleId, [['settings', 'VIEW']]);
  const suffix = randomBytes(4).toString('hex');
  colleagueId = (
    await createWorkspaceUser({ tenantId, roleId, email: `colleague-${suffix}@a.test`, fullName: 'Colleague' })
  ).id;
  const readerRole = await prisma.role.create({
    data: { tenantId, key: `reader-${suffix}`, name: 'Reader', rank: 70 },
  });
  await grantPermissions(tenantId, readerRole.id, [
    ['settings', 'VIEW'],
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
  ]);
  const readerUser = await createWorkspaceUser({
    tenantId,
    roleId: readerRole.id,
    email: `reader-${suffix}@a.test`,
    fullName: 'Reader',
  });
  reader = await createSessionToken(tenantId, readerUser.id);
});

afterAll(async () => {
  await fixture.cleanup();
});

type Source = { id: string; key: string; name: string; parentId: string | null; isActive: boolean };
const sources = async (as = admin) => {
  const res = await get(listSources, '/api/v1/lead-sources', as);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Source[];
};

describe('sources and sub-sources (M4-03)', () => {
  it('the catalogue is seeded on first use with the ten defaults, once', async () => {
    const first = await sources();
    expect(first.filter((s) => !s.parentId).map((s) => s.key)).toEqual(DEFAULT_LEAD_SOURCES.map(([key]) => key));
    expect(first.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Property Finder', 'Bayut', 'Dubizzle', 'Google Ads', 'Walk-in', 'Cold data']),
    );
    await sources();
    expect(await prisma.leadSource.count({ where: { tenantId } })).toBe(DEFAULT_LEAD_SOURCES.length);
  });

  it('an administrator adds a sub-source, renames it, deactivates it, and cannot add it twice', async () => {
    const website = (await sources()).find((s) => s.key === 'website')!;
    const added = await post(
      addSource,
      '/api/v1/lead-sources',
      { name: 'Marina campaign', parentId: website.id },
      admin,
    );
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body).toMatchObject({ key: 'website_marina_campaign', parentId: website.id, isActive: true });
    const url = `/api/v1/lead-sources?id=${added.body.id}`;
    expect((await patch(editSource, url, { name: 'Marina launch' }, admin)).body).toMatchObject({
      name: 'Marina launch',
    });
    expect((await patch(editSource, url, { isActive: false }, admin)).body).toMatchObject({ isActive: false });
    expect((await sources()).find((s) => s.id === added.body.id)).toMatchObject({
      name: 'Marina launch',
      isActive: false,
    });
    const again = await post(
      addSource,
      '/api/v1/lead-sources',
      { name: 'Marina campaign', parentId: website.id },
      admin,
    );
    expect(again.status).toBe(409);
    // Audited like every configuration write.
    expect(await prisma.auditLog.count({ where: { tenantId, objectType: 'settings', recordId: added.body.id } })).toBe(
      3,
    );
  });

  it('a source or sub-source named in any script gets a key of its own', async () => {
    const website = (await sources()).find((s) => s.key === 'website')!;
    const add = (name: string, parentId?: string) =>
      post(addSource, '/api/v1/lead-sources', { name, ...(parentId && { parentId }) }, admin);
    const arabic = await add('بيوت', website.id);
    expect(arabic.status, JSON.stringify(arabic.body)).toBe(200);
    expect(arabic.body).toMatchObject({ key: 'website_بيوت', name: 'بيوت', parentId: website.id });
    const top = await add('معرض دبي');
    expect(top.status, JSON.stringify(top.body)).toBe(200);
    expect(top.body.key).toBe('معرض_دبي');
    // No letters or digits at all: never the parent's own key.
    const dash = await add('—', website.id);
    expect(dash.status, JSON.stringify(dash.body)).toBe(200);
    expect(dash.body.key).toMatch(/^website_[0-9a-f]{8}$/);
  });

  it('a role without settings:MANAGE_CONFIGURATION reads the catalogue and cannot change it', async () => {
    expect((await sources(reader)).length).toBeGreaterThan(0);
    expect((await post(addSource, '/api/v1/lead-sources', { name: 'Expo' }, reader)).status).toBe(403);
    const other = await get(listSources, '/api/v1/lead-sources', fixture.b.cookie);
    expect(other.status).toBe(200);
    expect(other.body.map((s: Source) => s.id)).not.toContain((await sources())[0]!.id);
  });

  it('a lead takes a catalogue entry, a campaign, a nationality and tags on create and on edit', async () => {
    const list = await sources();
    const website = list.find((s) => s.key === 'website')!;
    const child = list.find((s) => s.parentId === website.id)!;
    const created = await post(
      createLead,
      '/api/v1/leads',
      {
        fullName: 'Fields lead',
        phone: '+971509100001',
        sourceId: child.id,
        campaignName: 'Spring 2026',
        nationality: 'Emirati',
        tags: ['vip', 'investor'],
      },
      admin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({
      sourceId: child.id,
      campaignName: 'Spring 2026',
      nationality: 'Emirati',
      tags: ['vip', 'investor'],
    });
    const url = `/api/v1/leads/${created.body.id}`;
    const edited = await patch(
      patchLead,
      url,
      { sourceId: website.id, nationality: 'Indian', campaignName: null, tags: ['vip'] },
      admin,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      sourceId: website.id,
      nationality: 'Indian',
      campaignName: null,
      tags: ['vip'],
    });
    expect((await get(getLead, url, admin)).body).toMatchObject({ nationality: 'Indian', sourceId: website.id });

    // Another workspace's entry is not found, like a missing id.
    const theirs = (await get(listSources, '/api/v1/lead-sources', fixture.b.cookie)).body[0] as Source;
    expect((await patch(patchLead, url, { sourceId: theirs.id }, admin)).status).toBe(404);
    expect((await post(createLead, '/api/v1/leads', { fullName: 'Theirs', sourceId: theirs.id }, admin)).status).toBe(
      404,
    );
  });

  it('the source report names the catalogue entry where a lead has one', async () => {
    const list = await sources();
    const marina = list.find((s) => s.name === 'Marina launch')!;
    const sub = await post(createLead, '/api/v1/leads', { fullName: 'Sub-source lead', sourceId: marina.id }, admin);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const ctx = buildCtx(buildActor({ id: fixture.a.userId, tenantId, grants: [['reports', 'VIEW']] }));
    const now = new Date();
    const range = { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 86_400_000) };
    const report = await runReport(ctx, 'source-to-booking', range);
    const bySource = Object.fromEntries(report.rows.map((r) => [r.source, r]));
    expect(bySource.Website).toMatchObject({ leads: 1 });
    expect(bySource['Website / Marina launch']).toMatchObject({ leads: 1 });
    // The fixture's own leads carry no entry and keep their enum label.
    expect(bySource.Manual).toMatchObject({ leads: fixture.a.leadCount });
    const analysis = await runReport(ctx, 'source-analysis', range);
    expect(analysis.rows.map((r) => r.source)).toEqual(
      expect.arrayContaining(['Website', 'Website / Marina launch', 'manual']),
    );
  });
});

describe('a secondary owner (M4-09)', () => {
  it('is stored, audited, must be assignable, and needs ASSIGN to name', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const url = `/api/v1/leads/${leadId}`;
    const set = await patch(patchLead, url, { secondaryOwnerId: colleagueId }, admin);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.secondaryOwnerId).toBe(colleagueId);
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, recordId: leadId, fieldKey: 'secondaryOwnerId' } }),
    ).toMatchObject({ newValue: colleagueId });
    const stranger = await patch(patchLead, url, { secondaryOwnerId: fixture.b.userId }, admin);
    expect(stranger.status).toBe(404);
    expect(stranger.body.detail).toBe('User not found.');
    expect((await patch(patchLead, url, { secondaryOwnerId: null }, admin)).body.secondaryOwnerId).toBeNull();
    // Without ASSIGN the field is ignored, as ownerId is.
    const ignored = await patch(patchLead, url, { secondaryOwnerId: colleagueId }, reader);
    expect(ignored.status, JSON.stringify(ignored.body)).toBe(200);
    expect(ignored.body.secondaryOwnerId).toBeNull();
  });
});

/** Every element a server component hands back, depth first. */
const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};

describe('tags on the screens (M4-10)', () => {
  it('the lead grid offers a Tags column and draws each tag', async () => {
    expect(GRID_COLUMNS.LEAD.map((column) => column.key)).toContain('tags');
    const leadId = fixture.a.leadIds[1]!;
    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { tags: ['vip', 'investor'] } });
    cookieJar.value = admin;
    const tree = await LeadsPage({ searchParams: Promise.resolve({}) });
    const rows = elements(tree).find((el) => el.type === LeadGrid)?.props.rows as LeadRow[];
    const row = rows.find((r) => r.id === leadId)!;
    expect(row.tags).toEqual(['vip', 'investor']);
    const drawn = renderToStaticMarkup(createElement(Fragment, null, leadCell('tags', row, '')));
    expect(drawn).toContain('vip');
    expect(drawn).toContain('investor');
    expect(renderToStaticMarkup(createElement(Fragment, null, leadCell('tags', { ...row, tags: [] }, '')))).toBe('—');
  });

  it('the lead form and the Overview offer a tags input', () => {
    expect(readFileSync(path.join(app, 'new', 'LeadForm.tsx'), 'utf8')).toContain('name="tags"');
    expect(readFileSync(path.join(app, '[id]', 'LeadDetail.tsx'), 'utf8')).toContain(
      'aria-label="Tags, comma-separated"',
    );
  });
});

describe('duplicate check on edit (M4-51)', () => {
  it('changing a phone or email to another lead’s value answers 409 as create does', async () => {
    const [first, second] = fixture.a.leadIds as [string, string];
    const email = `taken.${randomBytes(3).toString('hex')}@example.test`;
    await prisma.lead.update({
      where: { tenantId, id: first },
      data: { email, phone: '050 920 0001', phoneNormalized: '+971509200001' },
    });
    await prisma.leadPhone.create({
      data: { tenantId, leadId: first, raw: '050 920 0002', normalized: '+971509200002' },
    });
    const { reference } = await prisma.lead.findFirstOrThrow({
      where: { tenantId, id: first },
      select: { reference: true },
    });
    const url = `/api/v1/leads/${second}`;

    const byPhone = await patch(patchLead, url, { phone: '+971 50 920 0001' }, admin);
    expect(byPhone.status).toBe(409);
    expect(byPhone.body.detail).toBe(`A lead with this phoneNormalized already exists (${reference}).`);
    const onCreate = await post(createLead, '/api/v1/leads', { fullName: 'Dup', phone: '0509200001' }, admin);
    expect(onCreate.status).toBe(409);
    expect(Object.keys(byPhone.body).sort()).toEqual(Object.keys(onCreate.body).sort());
    expect(byPhone.body.detail).toBe(onCreate.body.detail);

    expect((await patch(patchLead, url, { phone: '0509200002' }, admin)).status).toBe(409);
    const byEmail = await patch(patchLead, url, { email: email.toUpperCase() }, admin);
    expect(byEmail.status).toBe(409);
    expect(byEmail.body.detail).toBe(`A lead with this email already exists (${reference}).`);
    expect(await prisma.lead.findFirstOrThrow({ where: { tenantId, id: second } })).toMatchObject({
      phoneNormalized: null,
      email: null,
    });

    // Its own value, a fresh value, and an unrelated field all pass.
    expect((await patch(patchLead, url, { phone: '0509200009', company: 'Acme' }, admin)).status).toBe(200);
    expect((await patch(patchLead, url, { phone: '+971509200009' }, admin)).status).toBe(200);
    expect((await patch(patchLead, url, { company: 'Acme 2' }, admin)).status).toBe(200);
  });
});
