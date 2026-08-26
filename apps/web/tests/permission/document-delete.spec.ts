/**
 * Who may remove a lead document, and who may see one.
 *
 * Two defects this pins, both found while investigating a report that "leads
 * upload is not working" — uploading turned out to be fine:
 *
 *  1. **Nobody could delete.** `documents/[id]/` held only `download`, so a
 *     file, once attached, was permanent — including a wrong or sensitive
 *     upload. The endpoint now exists and is gated on `documents:DELETE`, which
 *     the seeded roles grant to the organisation administrator alone.
 *  2. **Everybody could read everything.** The documents list gated on
 *     `documents:VIEW` at any scope and then queried by tenant with no
 *     visibility filter, so a representative holding it at OWN read every
 *     document in the workspace.
 *
 * The distinction that matters and is easy to lose in a refactor: uploading
 * hangs off `leads:EDIT` while deleting hangs off `documents:DELETE`. Collapse
 * them and the representatives who attach files can also remove them.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del } from '../helpers/request';
import { DELETE as deleteDocument } from '@/app/api/v1/documents/[id]/route';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let adminCookie = '';
let repCookie = '';
let repUserId = '';
let adminUserId = '';
let leadId = '';

/** A document owned by `ownerId`, with no object behind it — nothing here downloads. */
async function makeDocument(ownerId: string, name: string) {
  return prisma.document.create({
    data: {
      tenantId,
      name,
      storageKey: `documents/t-${tenantId}/lead-${leadId}/${name}`,
      storageBucket: 'test',
      mimeType: 'text/plain',
      sizeBytes: 4,
      status: 'UPLOADED',
      scanState: 'CLEAN',
      leadId,
      ownerId,
      createdById: ownerId,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `docdel-${suffix}`, legalName: 'DocDel LLC', displayName: 'DocDel', planCode: 'free' },
  });
  tenantId = tenant.id;

  // Without this the route refuses everyone with "Sales is not enabled for this
  // company" — an entitlement failure that looks exactly like a permission one
  // in the status code, and would have let the representative's 403 below pass
  // for the wrong reason.
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const adminRole = await prisma.role.create({
    data: { tenantId, key: 'org_admin', name: 'Organization Administrator', rank: 10 },
  });
  const repRole = await prisma.role.create({
    data: { tenantId, key: 'sales_rep', name: 'Sales Representative', rank: 60 },
  });

  // The administrator holds delete; the representative deliberately does not.
  await grantPermissions(tenantId, adminRole.id, [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['documents', 'VIEW'],
    ['documents', 'DELETE'],
  ]);
  await grantPermissions(
    tenantId,
    repRole.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['documents', 'VIEW'],
    ],
    'OWN',
  );

  const admin = await createWorkspaceUser({
    tenantId,
    roleId: adminRole.id,
    email: `admin.docdel.${suffix}@test.local`,
    fullName: 'DocDel Admin',
  });
  const rep = await createWorkspaceUser({
    tenantId,
    roleId: repRole.id,
    email: `rep.docdel.${suffix}@test.local`,
    fullName: 'DocDel Rep',
  });
  adminUserId = admin.id;
  repUserId = rep.id;
  adminCookie = await createSessionToken(tenantId, admin.id);
  repCookie = await createSessionToken(tenantId, rep.id);

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: 'new', name: 'New', position: 1, isDefault: true },
  });
  const lead = await prisma.lead.create({
    // `reference` is required and normally minted by createLead; this spec needs
    // only a row to hang documents off.
    data: {
      tenantId,
      reference: `LD-${suffix}`,
      fullName: 'DocDel Lead',
      stageId: stage.id,
      ownerId: rep.id,
      source: 'MANUAL',
    },
    select: { id: true },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('deleting a lead document', () => {
  it('refuses a representative, who may upload but not remove', async () => {
    const doc = await makeDocument(repUserId, 'rep-owned.txt');
    const res = await del(deleteDocument, `/api/v1/documents/${doc.id}`, repCookie, { id: doc.id });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    // And it is still there — a refused delete must not half-apply.
    const still = await prisma.document.findFirst({ where: { tenantId, id: doc.id, deletedAt: null } });
    expect(still).not.toBeNull();
  });

  it('allows the organisation administrator, and soft-deletes rather than erases', async () => {
    const doc = await makeDocument(repUserId, 'admin-removes.txt');
    const res = await del(deleteDocument, `/api/v1/documents/${doc.id}`, adminCookie, { id: doc.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const gone = await prisma.document.findFirst({ where: { tenantId, id: doc.id, deletedAt: null } });
    expect(gone).toBeNull();

    // The row survives with its key, so the audit trail can still answer which
    // file was removed. `__includeDeleted` is how lib/db.ts exposes soft-deleted
    // rows to a caller that genuinely wants them.
    const row = (await prisma.document.findFirst({
      where: { tenantId, id: doc.id },
      __includeDeleted: true,
    } as never)) as { storageKey: string } | null;
    expect(row).not.toBeNull();
    expect(row!.storageKey).toContain(`lead-${leadId}`);
  });
});

describe('reading the documents list', () => {
  it('narrows a representative to their own and leaves the administrator everything', async () => {
    const mine = await makeDocument(repUserId, 'mine.txt');
    const theirs = await makeDocument(adminUserId, 'theirs.txt');

    const repCtx = buildCtx(
      buildActor({
        id: repUserId,
        tenantId,
        permissions: new Map([['documents:VIEW', 'OWN']]) as never,
      }),
    );
    const repScope = await visibilityWhere(repCtx, 'documents', 'VIEW');
    const repRows = await prisma.document.findMany({ where: repScope, select: { id: true } });
    const repIds = repRows.map((r) => r.id);
    expect(repIds).toContain(mine.id);
    // The regression: this used to return every document in the workspace.
    expect(repIds).not.toContain(theirs.id);

    const adminCtx = buildCtx(
      buildActor({
        id: adminUserId,
        tenantId,
        permissions: new Map([['documents:VIEW', 'ORGANIZATION']]) as never,
      }),
    );
    const adminScope = await visibilityWhere(adminCtx, 'documents', 'VIEW');
    const adminIds = (await prisma.document.findMany({ where: adminScope, select: { id: true } })).map((r) => r.id);
    expect(adminIds).toEqual(expect.arrayContaining([mine.id, theirs.id]));
  });
});
