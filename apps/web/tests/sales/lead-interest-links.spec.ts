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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { DELETE as unlink, POST as link } from '@/app/api/v1/leads/[id]/interests/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import ProjectDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/projects/[id]/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { del, post } from '../helpers/request';

/**
 * Interest links (Lead Eagle audit row M4-06, 13 Oct): a lead names the
 * projects and listings it asked about, from a picker on its page that offers
 * only what the caller can see; the project page lists the leads interested in
 * it that the viewer may see. The move tool's links are in
 * tests/platform/lead-eagle-move.spec.ts.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** Leads at OWN, projects but not listings. */
let agent: string;
let agentLeadId: string;
let marina: string;
let creek: string;
let gone: string;
let foreignProject: string;
let listingId: string;
let foreignListing: string;

const url = (leadId: string) => `/api/v1/leads/${leadId}/interests`;
const project = (tenant: string, name: string, deletedAt: Date | null = null) =>
  prisma.project.create({
    data: { tenantId: tenant, name, code: `P-${randomBytes(4).toString('hex')}`, deletedAt },
    select: { id: true },
  });
const listing = (tenant: string, title: string) =>
  prisma.listing.create({
    data: {
      tenantId: tenant,
      reference: `LS-${randomBytes(4).toString('hex')}`,
      title,
      listingType: 'SALE',
      price: 1_000_000,
    },
    select: { id: true },
  });
/** A session for a new member of workspace A whose role holds `grants` at ORGANIZATION. */
const member = async (name: string, grants: Grants) => {
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `${name}-${suffix}`, name, rank: 80 } });
  await grantPermissions(tenantId, role.id, grants);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${name}-${suffix}@a.test`,
    fullName: name,
  });
  return createSessionToken(tenantId, user.id);
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId, [
    ['projects', 'VIEW'],
    ['listings', 'VIEW'],
  ]);
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 80 } });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['projects', 'VIEW'],
    ],
    'OWN',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent-${suffix}@a.test`,
    fullName: 'Agent',
  });
  agent = await createSessionToken(tenantId, user.id);
  agentLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `AG-${suffix}`,
        fullName: 'Agent Own Lead',
        stageId: fixture.a.stageId,
        ownerId: user.id,
      },
    })
  ).id;

  marina = (await project(tenantId, 'Marina Heights')).id;
  creek = (await project(tenantId, 'Creek Vista')).id;
  gone = (await project(tenantId, 'Withdrawn Tower', new Date())).id;
  foreignProject = (await project(fixture.b.tenantId, 'Elsewhere Gardens')).id;
  listingId = (await listing(tenantId, 'Two-bed in Marina Heights')).id;
  foreignListing = (await listing(fixture.b.tenantId, 'Elsewhere listing')).id;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('a lead names the projects and listings it asked about (M4-06)', () => {
  it('links a project and a listing once each, audited', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const first = await post(link, url(leadId), { projectId: marina }, admin);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await post(link, url(leadId), { projectId: marina }, admin)).status).toBe(200);
    expect((await post(link, url(leadId), { listingId }, admin)).status).toBe(200);

    expect(await prisma.leadProject.findMany({ where: { tenantId, leadId } })).toEqual([
      expect.objectContaining({ projectId: marina, createdById: fixture.a.userId }),
    ]);
    expect(await prisma.leadListing.findMany({ where: { tenantId, leadId } })).toEqual([
      expect.objectContaining({ listingId }),
    ]);
    const rows = await prisma.auditLog.findMany({ where: { tenantId, recordId: leadId, objectType: 'lead' } });
    expect(rows.map((r) => (r.metadata as { action?: string }).action)).toEqual(
      expect.arrayContaining(['lead.interest_added']),
    );
  });

  it('names one thing at a time, and only what the workspace has and the caller can see', async () => {
    const leadId = fixture.a.leadIds[1]!;
    expect((await post(link, url(leadId), {}, admin)).status).toBe(422);
    expect((await post(link, url(leadId), { projectId: marina, listingId }, admin)).status).toBe(422);
    expect((await post(link, url(leadId), { projectId: gone }, admin)).status).toBe(404);
    expect((await post(link, url(leadId), { projectId: foreignProject }, admin)).status).toBe(404);
    expect((await post(link, url(leadId), { listingId: foreignListing }, admin)).status).toBe(404);
    // The agent may see projects but not listings.
    expect((await post(link, url(agentLeadId), { listingId }, agent)).status).toBe(404);
    expect(await prisma.leadProject.count({ where: { tenantId, leadId } })).toBe(0);
    expect(await prisma.leadListing.count({ where: { tenantId, leadId: { in: [leadId, agentLeadId] } } })).toBe(0);
  });

  it("follows the lead's scope: another's lead answers 404", async () => {
    expect((await post(link, url(fixture.a.leadIds[1]!), { projectId: creek }, agent)).status).toBe(404);
    expect((await post(link, url(fixture.a.leadIds[1]!), { projectId: creek }, fixture.b.cookie)).status).toBe(404);
    expect((await post(link, url(agentLeadId), { projectId: creek }, agent)).status).toBe(200);
    expect((await del(unlink, `${url(fixture.a.leadIds[0]!)}?projectId=${marina}`, agent)).status).toBe(404);
  });

  it('removes a link', async () => {
    const leadId = fixture.a.leadIds[0]!;
    expect((await del(unlink, `${url(leadId)}?projectId=${marina}`, admin)).status).toBe(200);
    expect((await del(unlink, `${url(leadId)}?listingId=${listingId}`, admin)).status).toBe(200);
    expect(await prisma.leadProject.count({ where: { tenantId, leadId } })).toBe(0);
    expect(await prisma.leadListing.count({ where: { tenantId, leadId } })).toBe(0);
    await post(link, url(leadId), { projectId: marina }, admin);
    await post(link, url(leadId), { listingId }, admin);
  });

  it("the lead page shows its links and offers only the caller's projects and listings", async () => {
    cookieJar.value = admin;
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: fixture.a.leadIds[0]! }) }));
    expect(text).toContain('Marina Heights');
    expect(text).toContain('Two-bed in Marina Heights');
    expect(text).toContain('Creek Vista');
    expect(text).not.toContain('Withdrawn Tower');
    expect(text).not.toContain('Elsewhere Gardens');
    expect(text).not.toContain('Elsewhere listing');

    // Without listings:VIEW the picker offers no listing, and a listing linked to the lead is not named either.
    expect((await post(link, url(agentLeadId), { listingId }, admin)).status).toBe(200);
    cookieJar.value = agent;
    const own = await pageText(LeadDetailPage({ params: Promise.resolve({ id: agentLeadId }) }));
    expect(own).toContain('Creek Vista');
    expect(own).not.toContain('Two-bed in Marina Heights');
    await del(unlink, `${url(agentLeadId)}?listingId=${listingId}`, admin);
  });

  it('changing the links needs leads:EDIT; a role that only views the lead is refused', async () => {
    const viewer = await member('viewer', [
      ['leads', 'VIEW'],
      ['projects', 'VIEW'],
      ['listings', 'VIEW'],
    ]);
    const leadId = fixture.a.leadIds[0]!;
    expect((await post(link, url(leadId), { projectId: creek }, viewer)).status).toBe(403);
    expect((await del(unlink, `${url(leadId)}?projectId=${marina}`, viewer)).status).toBe(403);
    expect(await prisma.leadProject.count({ where: { tenantId, leadId, projectId: creek } })).toBe(0);
    expect(await prisma.leadProject.count({ where: { tenantId, leadId, projectId: marina } })).toBe(1);
  });
});

describe('the project page lists the leads interested in it (M4-06)', () => {
  it('not to a role that may see projects but not leads', async () => {
    cookieJar.value = await member('projects-only', [['projects', 'VIEW']]);
    const text = await pageText(ProjectDetailPage({ params: Promise.resolve({ id: marina }) }));
    expect(text).toContain('Marina Heights');
    expect(text).not.toContain('Interested leads');
    expect(text).not.toContain('manath Lead 0');
  });

  it('says so when it shows only the latest 50', async () => {
    const busy = (await project(tenantId, 'Busy Tower')).id;
    const suffix = randomBytes(3).toString('hex');
    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `busy${suffix}${String(i).padStart(3, '0')}`,
      tenantId,
      reference: `BUSY-${suffix}-${i}`,
      fullName: `Busy Lead ${i}`,
      stageId: fixture.a.stageId,
    }));
    await prisma.lead.createMany({ data: many });
    await prisma.leadProject.createMany({ data: many.map((l) => ({ tenantId, leadId: l.id, projectId: busy })) });

    cookieJar.value = admin;
    const text = await pageText(ProjectDetailPage({ params: Promise.resolve({ id: busy }) }));
    expect(text).toContain('Showing the 50 most recently updated');
    expect(new Set(text.match(/Busy Lead \d+/g)).size).toBe(50);
    const few = await pageText(ProjectDetailPage({ params: Promise.resolve({ id: marina }) }));
    expect(few).not.toContain('Showing the 50 most recently updated');
  });

  it('only those the viewer may see', async () => {
    await post(link, url(agentLeadId), { projectId: marina }, agent);

    cookieJar.value = admin;
    const all = await pageText(ProjectDetailPage({ params: Promise.resolve({ id: marina }) }));
    expect(all).toContain('Interested leads');
    expect(all).toContain('manath Lead 0');
    expect(all).toContain('Agent Own Lead');

    cookieJar.value = agent;
    const own = await pageText(ProjectDetailPage({ params: Promise.resolve({ id: marina }) }));
    expect(own).toContain('Agent Own Lead');
    expect(own).not.toContain('manath Lead 0');
  });
});
