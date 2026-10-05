/**
 * The shared CSV export, `GET /api/v1/exports/{resource}`.
 *
 * EXPORT, not VIEW, decides who may take a list out of the building, and the
 * keyset walk has to return every row exactly once when the list is longer than
 * one page — the second page only arrives by following the cursor.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { GET as exportResource } from '@/app/api/v1/exports/[resource]/route';

const suffix = randomBytes(4).toString('hex');
/** One more than the route's page size. */
const ROWS = 501;

let tenantId = '';
let exporterCookie = '';
let viewerCookie = '';

const download = (cookie: string) =>
  exportResource(new Request('http://localhost/api/v1/exports/contacts', { headers: { cookie } }), {
    params: Promise.resolve({ resource: 'contacts' }),
  });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `export-${suffix}`, legalName: 'Export LLC', displayName: 'Export', planCode: 'free' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const exporterRole = await prisma.role.create({ data: { tenantId, key: 'exporter', name: 'Exporter', rank: 10 } });
  const viewerRole = await prisma.role.create({ data: { tenantId, key: 'viewer', name: 'Viewer', rank: 60 } });
  await grantPermissions(tenantId, exporterRole.id, [
    ['contacts', 'VIEW'],
    ['contacts', 'EXPORT'],
  ]);
  await grantPermissions(tenantId, viewerRole.id, [['contacts', 'VIEW']]);

  const exporter = await createWorkspaceUser({
    tenantId,
    roleId: exporterRole.id,
    email: `exporter.${suffix}@test.local`,
    fullName: 'Exporter',
  });
  const viewer = await createWorkspaceUser({
    tenantId,
    roleId: viewerRole.id,
    email: `viewer.${suffix}@test.local`,
    fullName: 'Viewer',
  });
  exporterCookie = await createSessionToken(tenantId, exporter.id);
  viewerCookie = await createSessionToken(tenantId, viewer.id);

  await prisma.contact.createMany({
    data: Array.from({ length: ROWS }, (_, i) => ({
      tenantId,
      reference: `CT-${String(i).padStart(6, '0')}`,
      fullName: `Contact ${i}`,
    })),
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('the contacts export', () => {
  it('refuses a role that may view contacts but not export them', async () => {
    expect((await download(viewerCookie)).status).toBe(403);
  });

  it('streams every row once, across pages, under one header', async () => {
    const res = await download(exporterCookie);
    expect(res.status).toBe(200);

    const [header, ...rows] = (await res.text()).trim().split('\r\n');
    expect(header).toContain('"Reference"');
    expect(rows).toHaveLength(ROWS);
    expect(new Set(rows.map((row) => row.split(',')[0])).size).toBe(ROWS);
  });
});
