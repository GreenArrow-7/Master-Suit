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
// The filter bars are client components: called directly, they read the address from here.
const nav = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(nav.query),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { catalogueFilters, catalogueWhere } from '@/lib/inventory/catalogue';
import { listingFilters, listingWhere } from '@/lib/inventory/listings';
import { mediaPrefix } from '@/lib/inventory/media';
import { deleteObjects, listObjects } from '@/lib/storage';
import { matchesForRequirement } from '@/services/inventory/demand';
import { GET as listPlans, POST as addPlan } from '@/app/api/v1/projects/[id]/payment-plans/route';
import { POST as uploadProjectMedia } from '@/app/api/v1/projects/[id]/media/upload/route';
import { POST as uploadListingMedia } from '@/app/api/v1/listings/[id]/media/upload/route';
import { POST as registerProjectMedia } from '@/app/api/v1/projects/[id]/media/route';
import { DELETE as deleteListingMedia, POST as registerListingMedia } from '@/app/api/v1/listings/[id]/media/route';
import { PUT as saveRequirement } from '@/app/api/v1/leads/[id]/requirement/route';
import { GET as projectMediaFile } from '@/app/api/v1/projects/[id]/media/[mediaId]/file/route';
import { GET as listingMediaFile } from '@/app/api/v1/listings/[id]/media/[mediaId]/file/route';
import { POST as createProject } from '@/app/api/v1/projects/route';
import { GET as facets } from '@/app/api/v1/projects/facets/route';
import { POST as addUnitPlan } from '@/app/api/v1/projects/[id]/plans/route';
import { POST as addUnits } from '@/app/api/v1/projects/[id]/units/route';
import { DELETE as deleteProjectView, POST as saveProjectView } from '@/app/api/v1/projects/views/route';
import { POST as saveListingView } from '@/app/api/v1/listings/views/route';
import { POST as createListing } from '@/app/api/v1/listings/route';
import { PATCH as patchListing } from '@/app/api/v1/listings/[id]/route';
import { POST as createMandate } from '@/app/api/v1/listings/[id]/mandate/route';
import { POST as createOwner } from '@/app/api/v1/owners/route';
import ProjectDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/projects/[id]/page';
import ProjectsPage from '@/app/(workspace)/[workspaceSlug]/sales/projects/page';
import ProjectFilters from '@/app/(workspace)/[workspaceSlug]/sales/projects/ProjectFilters';
import ListingsPage from '@/app/(workspace)/[workspaceSlug]/sales/listings/page';
import ListingFilters from '@/app/(workspace)/[workspaceSlug]/sales/listings/ListingFilters';
import ListingDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/listings/[id]/page';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { del, get, patch, post, put } from '../helpers/request';

/**
 * Projects and listings in a Lead-Eagle-only workspace (audit rows M11-01–04,
 * M11-07/08, M12-02/04/05/06/09, 18 Oct): payment plans, uploading photos and
 * brochures, a developer and community typed on the form, units entered from
 * the project page, the catalogue's next page, facet counts and saved views,
 * a listing's permit and status, a pocket listing that still matches, and the
 * developer units a lead's requirement matches on its own page. The move tool's
 * half (unit plans, payment plans) is in tests/platform/lead-eagle-move.spec.ts.
 */
const suffix = randomBytes(4).toString('hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

interface Workspace {
  id: string;
  admin: string;
  adminId: string;
  stageId: string;
}

let a: Workspace;
let b: Workspace;
/** Projects and listings to read, nothing to write. */
let viewer: string;
/** Listings at OWN scope: their own to edit, everyone else's to read. */
let agent: string;
let projectId: string;
let foreignProject: string;

const ADMIN: Grants = [
  ['projects', 'VIEW'],
  ['projects', 'CREATE'],
  ['projects', 'EDIT'],
  ['listings', 'VIEW'],
  ['listings', 'CREATE'],
  ['listings', 'EDIT'],
  ['listings', 'VIEW_SENSITIVE_FIELDS'],
  ['requirements', 'VIEW'],
  ['leads', 'VIEW'],
  ['leads', 'EDIT'],
];

async function workspace(label: string): Promise<Workspace> {
  const tenant = await prisma.tenant.create({
    data: { slug: `${label}-${suffix}`, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenant.id, role.id, ADMIN);
  const user = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `admin@${label}-${suffix}.test`,
    fullName: `${label} Admin`,
  });
  const stage = await prisma.leadStage.create({
    data: { tenantId: tenant.id, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  return { id: tenant.id, admin: await createSessionToken(tenant.id, user.id), adminId: user.id, stageId: stage.id };
}

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION' = 'ORGANIZATION') {
  const role = await prisma.role.create({ data: { tenantId: a.id, key: `${label}-${suffix}`, name: label, rank: 80 } });
  await grantPermissions(a.id, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId: a.id,
    roleId: role.id,
    email: `${label}-${suffix}@a.test`,
    fullName: label,
  });
  return createSessionToken(a.id, user.id);
}

const project = (tenantId: string, name: string, data: Record<string, unknown> = {}) =>
  prisma.project.create({
    data: { tenantId, name, code: `P-${randomBytes(4).toString('hex')}`, ...data },
    select: { id: true },
  });

async function upload(
  handler: typeof uploadProjectMedia,
  path: string,
  id: string,
  cookie: string,
  bytes: Buffer,
  fields: Record<string, string> = {},
  name = 'file.pdf',
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new File([new Uint8Array(bytes)], name));
  const res = await handler(
    new Request(`http://localhost${path}`, { method: 'POST', headers: { cookie }, body: form }),
    {
      params: Promise.resolve({ id }),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The first element in a rendered tree that passes `test`. */
function find(node: unknown, test: (el: any) => boolean, seen = new Set<unknown>()): any {
  if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  if ('props' in node && test(node)) return node;
  const next = Array.isArray(node)
    ? node
    : 'props' in node
      ? [(node as { props: unknown }).props]
      : Object.values(node);
  for (const child of next) {
    const hit = find(child, test, seen);
    if (hit) return hit;
  }
  return undefined;
}

/** What a page renders, as this viewer. */
async function render(cookie: string, tree: () => Promise<unknown>) {
  cookieJar.value = cookie;
  try {
    return await pageText(tree());
  } finally {
    cookieJar.value = a.admin;
  }
}

beforeAll(async () => {
  a = await workspace('le-pl-a');
  b = await workspace('le-pl-b');
  cookieJar.value = a.admin;
  viewer = await member('viewer', [
    ['projects', 'VIEW'],
    ['listings', 'VIEW'],
  ]);
  agent = await member(
    'agent',
    [
      ['listings', 'VIEW'],
      ['listings', 'EDIT'],
    ],
    'OWN',
  );
  projectId = (await project(a.id, 'Sidra Villas')).id;
  foreignProject = (await project(b.id, 'Elsewhere Gardens')).id;
});

afterAll(async () => {
  for (const w of [a, b]) {
    if (!w?.id) continue;
    const keys = (await listObjects(mediaPrefix(w.id)).catch(() => [])).map((o) => o.key);
    if (keys.length) await deleteObjects(keys).catch(() => {});
    await prisma.tenant.delete({ where: { id: w.id } }).catch(() => {});
  }
});

describe('payment plans (M11-02)', () => {
  const url = (id: string) => `/api/v1/projects/${id}/payment-plans`;

  it('a Lead-Eagle-only workspace records 20/80 post-handover and sees it on the project page', async () => {
    const res = await post(
      addPlan,
      url(projectId),
      { name: '20/80 post-handover', milestones: '20 On booking, 80% Post-handover' },
      a.admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const listed = await get(listPlans, url(projectId), viewer);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        name: '20/80 post-handover',
        milestones: [
          { label: 'On booking', percent: 20 },
          { label: 'Post-handover', percent: 80 },
        ],
      }),
    ]);

    const text = await render(viewer, () => ProjectDetailPage({ params: Promise.resolve({ id: projectId }) }));
    expect(text).toContain('20/80 post-handover');
    expect(text).toContain('20% On booking · 80% Post-handover');
  });

  it('refuses milestones that do not add up to 100, a name used twice, a reader, and another workspace', async () => {
    const short = await post(
      addPlan,
      url(projectId),
      { name: 'Short', milestones: '10 Booking, 80 Handover' },
      a.admin,
    );
    expect(short.status).toBe(422);
    expect(JSON.stringify(short.body)).toContain('90%');
    expect(
      (await post(addPlan, url(projectId), { name: '20/80 post-handover', milestones: '50 A, 50 B' }, a.admin)).status,
    ).toBe(409);
    expect((await post(addPlan, url(projectId), { name: 'Viewer', milestones: '100 Cash' }, viewer)).status).toBe(403);
    expect((await post(addPlan, url(foreignProject), { name: 'Theirs', milestones: '100 Cash' }, a.admin)).status).toBe(
      404,
    );
  });

  it('keeps a comma inside a label when the milestones are split by semicolons, and takes a 0% stage', async () => {
    const res = await post(
      addPlan,
      url(projectId),
      {
        name: '20/80 four years',
        milestones: '20 On booking; 0 During construction; 40 On handover; 40 Post-handover, 4 years',
      },
      a.admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.milestones).toEqual([
      { label: 'On booking', percent: 20 },
      { label: 'During construction', percent: 0 },
      { label: 'On handover', percent: 40 },
      { label: 'Post-handover, 4 years', percent: 40 },
    ]);
    const lines = await post(
      addPlan,
      url(projectId),
      { name: 'One per line', milestones: '30 On booking\n70 Post-handover, 2 years' },
      a.admin,
    );
    expect(lines.status, JSON.stringify(lines.body)).toBe(200);
    expect(lines.body.milestones).toEqual([
      { label: 'On booking', percent: 30 },
      { label: 'Post-handover, 2 years', percent: 70 },
    ]);
  });
});

describe('uploading photos and brochures (M11-03, M12-02)', () => {
  const projectPath = (id: string) => `/api/v1/projects/${id}/media/upload`;

  it('scans and stores a brochure on a project, and serves it back through the media route', async () => {
    const before = await prisma.projectMedia.count({ where: { tenantId: a.id, projectId } });
    const res = await upload(uploadProjectMedia, projectPath(projectId), projectId, a.admin, PDF, {
      kind: 'BROCHURE',
      title: 'Sidra brochure',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'BROCHURE', title: 'Sidra brochure', mimeType: 'application/pdf' });
    const row = await prisma.projectMedia.findFirstOrThrow({ where: { tenantId: a.id, id: res.body.id } });
    expect(row.storageKey!.startsWith(mediaPrefix(a.id))).toBe(true);
    expect(await prisma.projectMedia.count({ where: { tenantId: a.id, projectId } })).toBe(before + 1);

    const file = await projectMediaFile(
      new Request(`http://localhost/api/v1/projects/${projectId}/media/${row.id}/file`, {
        headers: { cookie: viewer },
      }),
      { params: Promise.resolve({ id: projectId, mediaId: row.id }) },
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);

    const text = await render(viewer, () => ProjectDetailPage({ params: Promise.resolve({ id: projectId }) }));
    expect(text).toContain('Sidra brochure');
  });

  it('refuses an infected file, a file that is no photo or PDF, a reader, and another workspace', async () => {
    const before = await prisma.projectMedia.count({ where: { tenantId: a.id, projectId } });
    const infected = Buffer.concat([PDF, Buffer.from(EICAR)]);
    const bad = await upload(uploadProjectMedia, projectPath(projectId), projectId, a.admin, infected, {
      kind: 'BROCHURE',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.detail).toContain('malware scan');
    const text = await upload(
      uploadProjectMedia,
      projectPath(projectId),
      projectId,
      a.admin,
      Buffer.from('plain'),
      {},
      'a.txt',
    );
    expect(text.status).toBe(422);
    // A PDF is not a photo.
    expect(
      (await upload(uploadProjectMedia, projectPath(projectId), projectId, a.admin, PDF, { kind: 'IMAGE' })).status,
    ).toBe(422);
    expect((await upload(uploadProjectMedia, projectPath(projectId), projectId, viewer, PDF)).status).toBe(403);
    expect(
      (
        await upload(uploadProjectMedia, projectPath(foreignProject), foreignProject, a.admin, PDF, {
          kind: 'BROCHURE',
        })
      ).status,
    ).toBe(404);
    expect(await prisma.projectMedia.count({ where: { tenantId: a.id, projectId } })).toBe(before);
  });

  it('registers a linked video or tour only, so no caller names a hosted file or its type', async () => {
    const register = (body: Record<string, unknown>) =>
      post(registerProjectMedia, `/api/v1/projects/${projectId}/media`, body, a.admin);
    expect((await register({ kind: 'BROCHURE', storageKey: `documents/t-${b.id}/booking-x/receipt.pdf` })).status).toBe(
      422,
    );
    // A PDF that is also a page: stored as a PDF, it must never be re-registered as HTML.
    const polyglot = Buffer.from('%PDF-1.4\n<script>document.title="owned"</script>\n%%EOF\n');
    const up = await upload(uploadProjectMedia, projectPath(projectId), projectId, a.admin, polyglot, {
      kind: 'BROCHURE',
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const { storageKey } = await prisma.projectMedia.findFirstOrThrow({ where: { tenantId: a.id, id: up.body.id } });
    expect((await register({ kind: 'BROCHURE', storageKey, mimeType: 'text/html' })).status).toBe(422);
    expect((await register({ kind: 'BROCHURE', storageKey })).status).toBe(422);
    const tour = await register({ kind: 'VR_TOUR', title: 'Tour', externalUrl: 'https://my.matterport.com/show/?m=x' });
    expect(tour.status, JSON.stringify(tour.body)).toBe(200);

    // A row stored before this rule with a type that runs script is served as a download, never as a page.
    const old = await prisma.projectMedia.create({
      data: { tenantId: a.id, projectId, kind: 'BROCHURE', storageKey, mimeType: 'text/html' },
    });
    const file = await projectMediaFile(
      new Request(`http://localhost/api/v1/projects/${projectId}/media/${old.id}/file`, {
        headers: { cookie: viewer },
      }),
      { params: Promise.resolve({ id: projectId, mediaId: old.id }) },
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/octet-stream');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment;/);
  });
});

describe('a developer, community and amenities typed on the project form (M11-01)', () => {
  it('creates each once, links the project to them, and the catalogue filters on them', async () => {
    const body = {
      name: 'Hills Park',
      code: `HP-${suffix}`,
      developerName: 'Emaar',
      community: 'Dubai Hills',
      city: 'Dubai',
      amenityNames: 'Swimming pool, Gym',
    };
    const first = await post(createProject, '/api/v1/projects', body, a.admin);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await post(
      createProject,
      '/api/v1/projects',
      { ...body, name: 'Hills Grove', code: `HG-${suffix}`, amenityNames: ['Gym'] },
      a.admin,
    );
    expect(second.status).toBe(200);
    // Typed another way, still the same developer and community.
    const third = await post(
      createProject,
      '/api/v1/projects',
      { name: 'Hills Crest', code: `HC-${suffix}`, developerName: 'EMAAR', community: 'dubai  hills', city: 'dubai' },
      a.admin,
    );
    expect(third.status, JSON.stringify(third.body)).toBe(200);

    const developers = await prisma.developer.findMany({
      where: { tenantId: a.id, name: { equals: 'emaar', mode: 'insensitive' } },
    });
    const communities = await prisma.micromarket.findMany({
      where: { tenantId: a.id, name: { startsWith: 'dubai', mode: 'insensitive' } },
    });
    expect(developers.map((d) => d.name)).toEqual(['Emaar']);
    expect(communities.map((c) => c.name)).toEqual(['Dubai Hills']);
    expect(
      (await prisma.amenity.findMany({ where: { tenantId: a.id }, orderBy: { key: 'asc' } })).map((x) => x.key),
    ).toEqual(['gym', 'swimming-pool']);

    const named = (filters: Record<string, string>) =>
      prisma.project
        .findMany({ where: catalogueWhere(a.id, catalogueFilters.parse(filters)), orderBy: { name: 'asc' } })
        .then((rows) => rows.map((r) => r.name));
    expect(await named({ developer: developers[0]!.id })).toEqual(['Hills Crest', 'Hills Grove', 'Hills Park']);
    expect(await named({ micromarket: communities[0]!.id })).toEqual(['Hills Crest', 'Hills Grove', 'Hills Park']);
    expect(await named({ amenity: 'swimming-pool' })).toEqual(['Hills Park']);

    // The facet counts the filter bar shows.
    const counted = await get(facets, '/api/v1/projects/facets', a.admin);
    expect(counted.body.developer).toEqual([{ value: developers[0]!.id, label: 'Emaar', count: 3 }]);
    // On the catalogue itself: the page hands its counts to the filter bar, which shows them.
    cookieJar.value = a.admin;
    const page = await ProjectsPage({ searchParams: Promise.resolve({}) });
    const bar = find(page, (el) => el.type === ProjectFilters);
    nav.query = '';
    expect(await pageText(ProjectFilters(bar.props))).toContain('Emaar (3)');
  });
});

describe('a tower entered from the project page (M11-04)', () => {
  it('takes the forms numbers as typed and updates the availability counts', async () => {
    const tower = (await project(a.id, 'Creek Tower')).id;
    const plan = await post(
      addUnitPlan,
      `/api/v1/projects/${tower}/plans`,
      { name: '2 bed Type A', unitType: '2BR', bedrooms: '2', carpetAreaSqft: '1100', price: '2000000' },
      a.admin,
    );
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const units = await post(
      addUnits,
      `/api/v1/projects/${tower}/units`,
      { unitPlanId: plan.body.plan.id, fromFloor: '1', toFloor: '2', unitsPerFloor: '2', price: '2000000' },
      a.admin,
    );
    expect(units.status, JSON.stringify(units.body)).toBe(200);
    expect(units.body).toMatchObject({ created: 4, availableUnits: 4, totalUnits: 4 });
    expect(await prisma.project.findFirstOrThrow({ where: { tenantId: a.id, id: tower } })).toMatchObject({
      availableUnits: 4,
      unitTypes: ['2BR'],
    });
  });
});

describe('the catalogue pages, and each person keeps views (M11-08, M12-05)', () => {
  it('reaches the 51st project on the next page', async () => {
    await prisma.project.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        tenantId: a.id,
        name: `Paged ${String(i).padStart(2, '0')}`,
        code: `PG-${suffix}-${i}`,
        updatedAt: new Date(Date.UTC(2020, 0, 1 + i)),
      })),
    });
    const first = await render(a.admin, () => ProjectsPage({ searchParams: Promise.resolve({ q: 'Paged' }) }));
    const second = await render(a.admin, () =>
      ProjectsPage({ searchParams: Promise.resolve({ q: 'Paged', page: '2' }) }),
    );
    // Newest first: the oldest is the 51st.
    expect(first).toContain('Paged 50');
    expect(first).not.toContain('Paged 00');
    expect(second).toContain('Paged 00');
    expect(second).not.toContain('Paged 50');
  });

  it('saves a view of the filters alone, which only its owner deletes', async () => {
    const saved = await post(
      saveProjectView,
      '/api/v1/projects/views',
      { name: 'Ready in the Hills', params: { possession: 'READY_TO_MOVE', page: '3', junk: 'x' } },
      viewer,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.href).toBe(`/projects?possession=READY_TO_MOVE&saved=${saved.body.id}`);
    const text = await render(viewer, () => ProjectsPage({ searchParams: Promise.resolve({}) }));
    expect(text).toContain('Ready in the Hills');
    // Not on anyone else's catalogue, and not theirs to delete.
    expect(await render(a.admin, () => ProjectsPage({ searchParams: Promise.resolve({}) }))).not.toContain(
      'Ready in the Hills',
    );
    const path = `/api/v1/projects/views?viewId=${saved.body.id}`;
    expect((await del(deleteProjectView, path, a.admin)).status).toBe(404);
    expect((await del(deleteProjectView, path, viewer)).status).toBe(200);

    const listing = await post(
      saveListingView,
      '/api/v1/listings/views',
      { name: 'Two to three beds', params: { bedroomsMin: '2', bedroomsMax: '3' } },
      viewer,
    );
    expect(listing.body.href).toBe(`/listings?bedroomsMin=2&bedroomsMax=3&saved=${listing.body.id}`);
  });

  it('reaches the 51st listing on the next page, and a saved listing view reopens narrowed', async () => {
    await prisma.listing.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        tenantId: a.id,
        reference: `BK-${suffix}-${i}`,
        title: `Book ${String(i).padStart(2, '0')}`,
        listingType: 'SALE' as const,
        price: 1_000_000,
        bedrooms: i % 2 ? 2 : 5,
        updatedAt: new Date(Date.UTC(2020, 0, 1 + i)),
      })),
    });
    const first = await render(a.admin, () => ListingsPage({ searchParams: Promise.resolve({ q: 'Book' }) }));
    const second = await render(a.admin, () =>
      ListingsPage({ searchParams: Promise.resolve({ q: 'Book', page: '2' }) }),
    );
    expect(first).toContain('Book 50');
    expect(first).not.toContain('Book 00');
    expect(second).toContain('Book 00');
    expect(second).not.toContain('Book 50');

    const view = await post(
      saveListingView,
      '/api/v1/listings/views',
      { name: 'Book two-beds', params: { q: 'Book', bedroomsMin: '2', bedroomsMax: '3' } },
      a.admin,
    );
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const opened = Object.fromEntries(new URL(view.body.href, 'http://localhost').searchParams);
    const narrowed = await render(a.admin, () => ListingsPage({ searchParams: Promise.resolve(opened) }));
    expect(narrowed).toContain('Book 49');
    expect(narrowed).not.toContain('Book 48');
  });

  it('a view opened from its chip refills the typed filters, so leaving one does not undo the view', () => {
    // The chip is a client-side navigation: the bar stays mounted, and an input
    // React keeps would still hold the old value. Its key follows the address.
    const input = (tree: unknown, label: string) => find(tree, (el) => el.props?.label === label).props.children;
    nav.query = '';
    const before = ListingFilters({ micromarkets: [] });
    nav.query = 'bedroomsMin=2&bedroomsMax=3&saved=v1';
    const after = ListingFilters({ micromarkets: [] });
    for (const [label, value] of [
      ['Beds from', '2'],
      ['Beds up to', '3'],
    ]) {
      expect(input(after, label!).props.defaultValue).toBe(value);
      expect(input(after, label!).key).not.toBe(input(before, label!).key);
    }
    const counts = { micromarket: {}, developer: {}, status: {}, possession: {} };
    nav.query = '';
    const plain = ProjectFilters({ micromarkets: [], developers: [], amenities: [], counts });
    nav.query = 'q=Hills&maxPrice=2000000&saved=v2';
    const viewed = ProjectFilters({ micromarkets: [], developers: [], amenities: [], counts });
    for (const label of ['Search', 'Budget up to']) {
      expect(input(viewed, label).key).not.toBe(input(plain, label).key);
    }
  });

  it('filters listings by beds up to and price from', () => {
    expect(
      listingWhere(a.id, listingFilters.parse({ bedroomsMin: '2', bedroomsMax: '3', minPrice: '1000' })),
    ).toMatchObject({ bedrooms: { gte: 2, lte: 3 }, AND: [{ price: { gte: 1000 } }] });
  });
});

describe('a listing’s permit, status, photo and a pocket listing (M12-02, M12-04, M12-09)', () => {
  let listingId: string;
  let ownerId: string;

  it('records the Trakheesi permit and a typed community on a new listing, and shows them', async () => {
    const owner = await post(createOwner, '/api/v1/owners', { fullName: 'Owner One', phone: '0501234567' }, a.admin);
    expect(owner.status).toBe(200);
    ownerId = owner.body.id;
    const res = await post(
      createListing,
      '/api/v1/listings',
      {
        title: 'Marina 2-bed',
        listingType: 'SALE',
        propertyOwnerId: ownerId,
        price: '1800000',
        bedrooms: '2',
        community: 'Dubai Marina',
        permitNumber: 'TRK-7781',
        permitExpiry: '2027-03-31',
      },
      a.admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    listingId = res.body.id;
    const row = await prisma.listing.findFirstOrThrow({
      where: { tenantId: a.id, id: listingId },
      include: { micromarket: true },
    });
    expect(row).toMatchObject({ permitNumber: 'TRK-7781', status: 'DRAFT' });
    expect(row.permitExpiry?.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(row.micromarket?.name).toBe('Dubai Marina');

    const changed = await patch(patchListing, `/api/v1/listings/${listingId}`, { permitNumber: 'TRK-9000' }, a.admin);
    expect(changed.status).toBe(200);
    expect(
      await render(viewer, () => ListingDetailPage({ params: Promise.resolve({ id: listingId, workspaceSlug: 'x' }) })),
    ).toContain('TRK-9000');
  });

  it('a mandated listing set active and never sent to a portal matches an open requirement', async () => {
    const starts = new Date(Date.now() - 86_400_000).toISOString();
    const ends = new Date(Date.now() + 90 * 86_400_000).toISOString();
    expect((await patch(patchListing, `/api/v1/listings/${listingId}`, { status: 'ACTIVE' }, a.admin)).status).toBe(
      422,
    );
    const mandate = await post(
      createMandate,
      `/api/v1/listings/${listingId}/mandate`,
      { ownerId, startsAt: starts, expiresAt: ends, activate: true },
      a.admin,
    );
    expect(mandate.status, JSON.stringify(mandate.body)).toBe(200);
    expect((await patch(patchListing, `/api/v1/listings/${listingId}`, { status: 'ACTIVE' }, a.admin)).status).toBe(
      200,
    );
    expect(await prisma.listingPublication.count({ where: { tenantId: a.id, listingId } })).toBe(0);

    const marina = await prisma.micromarket.findFirstOrThrow({ where: { tenantId: a.id, name: 'Dubai Marina' } });
    const lead = await prisma.lead.create({
      data: { tenantId: a.id, reference: `PK-${suffix}`, fullName: 'Pocket Buyer', stageId: a.stageId },
    });
    const requirement = await prisma.clientRequirement.create({
      data: { tenantId: a.id, leadId: lead.id, purpose: 'BUY', micromarketIds: [marina.id], budgetMax: 2_000_000 },
    });
    const found = await matchesForRequirement(a.id, requirement.id);
    expect(found!.matches.map((m) => m.id)).toContain(listingId);
  });

  it('takes a photo on the listing for its agent, and 404s an agent whose listing it is not', async () => {
    const path = `/api/v1/listings/${listingId}/media/upload`;
    const res = await upload(uploadListingMedia, path, listingId, a.admin, PNG, { kind: 'IMAGE' }, 'front.png');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png' });
    const text = await render(viewer, () =>
      ListingDetailPage({ params: Promise.resolve({ id: listingId, workspaceSlug: 'x' }) }),
    );
    expect(text).toContain(`/api/v1/listings/${listingId}/media/${res.body.id}/file`);
    // The admin's listing, outside an OWN-scope agent's reach.
    expect((await upload(uploadListingMedia, path, listingId, agent, PNG, { kind: 'IMAGE' }, 'x.png')).status).toBe(
      404,
    );
    const photo = await listingMediaFile(
      new Request(`http://localhost/api/v1/listings/${listingId}/media/${res.body.id}/file`, {
        headers: { cookie: viewer },
      }),
      { params: Promise.resolve({ id: listingId, mediaId: res.body.id }) },
    );
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('keeps the JSON media routes to the listings the caller may edit', async () => {
    const mediaPath = `/api/v1/listings/${listingId}/media`;
    const tour = { kind: 'VIDEO', externalUrl: 'https://www.youtube.com/watch?v=x' };
    expect((await post(registerListingMedia, mediaPath, tour, agent)).status).toBe(404);
    const photo = await prisma.listingMedia.findFirstOrThrow({ where: { tenantId: a.id, listingId, kind: 'IMAGE' } });
    expect((await del(deleteListingMedia, `${mediaPath}?mediaId=${photo.id}`, agent)).status).toBe(404);
    expect(await prisma.listingMedia.count({ where: { tenantId: a.id, id: photo.id } })).toBe(1);
    // Their own listing is theirs to add to.
    expect((await post(registerListingMedia, mediaPath, tour, a.admin)).status).toBe(200);
  });

  it('warns of an expired permit only once its last day has passed in the workspace time zone', async () => {
    // Eleven hours behind UTC: the workspace's today has always begun after midnight UTC of the same date.
    await prisma.tenant.update({ where: { id: b.id }, data: { timezone: 'Pacific/Pago_Pago' } });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Pago_Pago' }).format(new Date());
    const listed = async (expiry: Date) => {
      const row = await prisma.listing.create({
        data: {
          tenantId: b.id,
          reference: `PE-${randomBytes(4).toString('hex')}`,
          title: 'Permit check',
          listingType: 'SALE',
          price: 1_000_000,
          permitNumber: 'TRK-1',
          permitExpiry: expiry,
        },
      });
      return render(b.admin, () => ListingDetailPage({ params: Promise.resolve({ id: row.id, workspaceSlug: 'x' }) }));
    };
    const lastDay = new Date(`${today}T00:00:00Z`);
    expect(await listed(lastDay)).not.toContain('The advertising permit has expired.');
    expect(await listed(new Date(lastDay.getTime() - 86_400_000))).toContain('The advertising permit has expired.');
  });
});

describe('the units and listings a lead matches, on its own page (M12-06), and the lead grid by project (M11-07)', () => {
  it('lists the available units its requirement matches, and not held, pricier or smaller ones', async () => {
    const hills = await prisma.micromarket.create({
      data: { tenantId: a.id, name: `Arabian Ranches ${suffix}`, city: 'Dubai' },
    });
    const ranch = (await project(a.id, 'Ranches Rise', { micromarketId: hills.id })).id;
    const two = await prisma.unitPlan.create({
      data: { tenantId: a.id, projectId: ranch, name: '2 bed', unitType: '2BR', bedrooms: 2 },
    });
    const one = await prisma.unitPlan.create({
      data: { tenantId: a.id, projectId: ranch, name: '1 bed', unitType: '1BR', bedrooms: 1 },
    });
    const unit = (unitNumber: string, data: Record<string, unknown>) =>
      prisma.unitInventory.create({ data: { tenantId: a.id, projectId: ranch, unitNumber, ...data } });
    await unit('R-101', { unitPlanId: two.id, price: 2_000_000 });
    await unit('R-102', {
      unitPlanId: two.id,
      price: 2_100_000,
      status: 'HELD',
      heldUntil: new Date(Date.now() + 3_600_000),
    });
    await unit('R-103', { unitPlanId: two.id, price: 3_000_000 });
    await unit('R-104', { unitPlanId: one.id, price: 1_500_000 });
    // The same unit in another community.
    const elsewhere = await prisma.micromarket.create({
      data: { tenantId: a.id, name: `Jumeirah Golf ${suffix}`, city: 'Dubai' },
    });
    const golf = (await project(a.id, 'Golf Heights', { micromarketId: elsewhere.id })).id;
    await prisma.unitInventory.create({
      data: { tenantId: a.id, projectId: golf, unitNumber: 'G-1', price: 2_000_000 },
    });

    const lead = await prisma.lead.create({
      data: { tenantId: a.id, reference: `UM-${suffix}`, fullName: 'Unit Buyer', stageId: a.stageId },
    });
    // Saved as the lead page's composer saves it: the area typed, in any case.
    const saved = await put(
      saveRequirement,
      `/api/v1/leads/${lead.id}/requirement`,
      { purpose: 'BUY', bedroomsMin: 2, budgetMax: 2_500_000, locations: [`arabian ranches ${suffix}`, 'Nowhere'] },
      a.admin,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.micromarketIds).toEqual([hills.id]);
    await prisma.leadProject.create({ data: { tenantId: a.id, leadId: lead.id, projectId: ranch } });

    cookieJar.value = a.admin;
    const tree = (await LeadDetailPage({ params: Promise.resolve({ id: lead.id }) })) as {
      props: { children: ({ props?: Record<string, any> } | null)[] };
    };
    const shown = tree.props.children.find((child) => child?.props?.lead)!.props!.lead.matchingStock;
    expect(shown.units.map((u: { label: string }) => u.label)).toEqual(['Ranches Rise · R-101']);
    expect(shown.units[0]).toMatchObject({ projectId: ranch, price: 'AED 2,000,000', bedrooms: 2 });

    // The lead grid offers the project as a filter, and the filter keeps the lead.
    const grid = await render(a.admin, () => LeadsPage({ searchParams: Promise.resolve({ project: ranch }) }));
    expect(grid).toContain('Ranches Rise');
    expect(grid).toContain('Unit Buyer');
    expect(grid).not.toContain('Pocket Buyer');
  });
});
