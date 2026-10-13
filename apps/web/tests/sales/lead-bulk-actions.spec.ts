import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// The pages read the session from the request's cookie, set per case.
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

import { prisma } from '@/lib/db';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { DELETE as deleteLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import ColdDataPage from '@/app/(workspace)/[workspaceSlug]/sales/cold-data/page';
import { todayKey } from '@/services/targets/dailyBoard';
import { pageText } from '../helpers/render';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

/**
 * The lead grid's bulk bar (Lead Eagle audit, 11 Oct): Add tag (M4-35), Delete
 * with a 10-second Undo that restores each lead (M4-36), and Move to Data
 * (M4-39). The bar sends one request per selected lead, so each case here is
 * that request: the lead is re-checked in the caller's scope on the server (a
 * lead outside it answers 404, as a missing one, and nothing changes), and
 * every change is audited on the lead.
 *
 * The two new routes are imported per case, so each case fails on its own
 * where they do not exist.
 */
const restoreRoute = async () => (await import('@/app/api/v1/leads/[id]/restore/route')).POST;
const moveRoute = async () => (await import('@/app/api/v1/leads/[id]/move-to-data/route')).POST;

let fixture: Fixture;
let tenantId: string;
let stageId: string;
const rep = { id: '', cookie: '' };
const editor = { id: '', cookie: '' };
const url = (id: string, tail = '') => `/api/v1/leads/${id}${tail}`;

async function member(label: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${tenantId.slice(-6)}`, name: label, rank: 60, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}@${fixture.a.slug}.test`,
    fullName: `${label} ${fixture.a.slug}`,
  });
  return { id: user.id, roleId: role.id, cookie: await createSessionToken(tenantId, user.id) };
}

let n = 0;
const lead = (data: Record<string, unknown> = {}) =>
  prisma.lead
    .create({
      data: {
        tenantId,
        reference: `BULK-${++n}-${tenantId.slice(-6)}`,
        fullName: `Bulk lead ${n}`,
        stageId,
        ownerId: fixture.a.userId,
        ...data,
      },
    })
    .then((row) => row.id);
const read = (id: string, owner = tenantId) => prisma.lead.findFirstOrThrow({ where: { tenantId: owner, id } });
/** Reads leave deleted rows out unless asked (lib/db.ts): null when the lead is not deleted. */
const deletedAt = async (id: string, owner = tenantId) =>
  (await prisma.lead.findFirst({ where: { tenantId: owner, id, deletedAt: { not: null } } }))?.deletedAt ?? null;
const trail = (id: string) =>
  prisma.auditLog.findMany({ where: { tenantId, recordId: id }, orderBy: { occurredAt: 'asc' } });
const listed = async (cookie: string) =>
  ((await get(listLeads, '/api/v1/leads?limit=200', cookie)).body.data as { id: string }[]).map((row) => row.id);

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
async function grid(cookie: string) {
  cookieJar.value = cookie;
  const tree = elements(await LeadsPage({ searchParams: Promise.resolve({}) }));
  return tree.find((el) => el.type === LeadGrid)?.props as
    { rows: { id: string }[]; canMoveToData?: boolean; canDelete?: boolean } | undefined;
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  stageId = fixture.a.stageId;
  Object.assign(
    rep,
    await member(
      'bulk-rep',
      [
        ['leads', 'VIEW'],
        ['leads', 'CREATE'],
        ['leads', 'EDIT'],
        ['leads', 'DELETE'],
        ['leads', 'VIEW_SENSITIVE_FIELDS'],
      ],
      'OWN',
    ),
  );
  Object.assign(
    editor,
    await member(
      'bulk-editor',
      [
        ['leads', 'VIEW'],
        ['leads', 'EDIT'],
        ['leads', 'VIEW_SENSITIVE_FIELDS'],
      ],
      'ORGANIZATION',
    ),
  );
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('bulk Add tag (M4-35)', () => {
  it('adds the tags to each lead and keeps the ones it had, audited per lead', async () => {
    const tagged = await lead({ tags: ['vip'] });
    const bare = await lead();

    for (const id of [tagged, bare]) {
      const res = await patch(patchLead, url(id), { addTags: ['investor', 'vip'] }, fixture.a.cookie);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }

    expect((await read(tagged)).tags).toEqual(['vip', 'investor']);
    expect((await read(bare)).tags).toEqual(['investor', 'vip']);
    const row = (await trail(tagged)).find((entry) => entry.fieldKey === 'tags');
    expect(row).toMatchObject({
      event: 'RECORD_UPDATED',
      objectType: 'lead',
      actorUserId: fixture.a.userId,
      previousValue: ['vip'],
      newValue: ['vip', 'investor'],
    });
  });

  it('answers 404 for a lead outside the caller’s scope or workspace, and tags nothing', async () => {
    const others = await lead({ tags: ['vip'] });
    const refused = await patch(patchLead, url(others), { addTags: ['cold'] }, rep.cookie);
    expect(refused.status).toBe(404);
    expect(refused.body.detail).toBe('Lead not found.');
    expect((await read(others)).tags).toEqual(['vip']);

    const foreign = fixture.b.leadIds[0]!;
    expect((await patch(patchLead, url(foreign), { addTags: ['cold'] }, fixture.a.cookie)).status).toBe(404);
    expect((await read(foreign, fixture.b.tenantId)).tags).toEqual([]);

    const own = await lead({ ownerId: rep.id });
    expect((await patch(patchLead, url(own), { addTags: ['cold'] }, rep.cookie)).status).toBe(200);
    expect((await read(own)).tags).toEqual(['cold']);
  });

  it('refuses a tag past the lead’s 20, naming the lead’s limit, and changes nothing', async () => {
    const full = Array.from({ length: 19 }, (_, i) => `t${i}`);
    const id = await lead({ tags: full });
    const res = await patch(patchLead, url(id), { addTags: ['t1', 'new-a', 'new-b'] }, fixture.a.cookie);
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('A lead holds at most 20 tags.');
    expect((await read(id)).tags).toEqual(full);
    // One more fits, and one it already has adds nothing.
    expect((await patch(patchLead, url(id), { addTags: ['t1', 'new-a'] }, fixture.a.cookie)).status).toBe(200);
    expect((await read(id)).tags).toEqual([...full, 'new-a']);
  });

  it('leaves the tags alone for a role whose tags field is read-only, as it does a typed list', async () => {
    const { roleId } = await prisma.user.findFirstOrThrow({ where: { tenantId, id: editor.id } });
    await prisma.fieldPermission.create({
      data: { tenantId, roleId, objectType: 'LEAD', fieldKey: 'tags', canView: true, canEdit: false },
    });
    const id = await lead({ tags: ['vip'] });
    expect((await patch(patchLead, url(id), { addTags: ['cold'] }, editor.cookie)).status).toBe(200);
    expect((await read(id)).tags).toEqual(['vip']);
  });
});

describe('bulk delete and its Undo (M4-36)', () => {
  it('restores a deleted lead to the list; the audit log names both events on the lead', async () => {
    const restore = await restoreRoute();
    const id = await lead();
    expect((await del(deleteLead, url(id), fixture.a.cookie)).status).toBe(200);
    expect(await listed(fixture.a.cookie)).not.toContain(id);

    const res = await post(restore, url(id, '/restore'), {}, fixture.a.cookie, { id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, restored: true });
    expect(await deletedAt(id)).toBeNull();
    expect(await listed(fixture.a.cookie)).toContain(id);

    const events = (await trail(id)).map((entry) => entry.event);
    expect(events).toEqual(expect.arrayContaining(['RECORD_DELETED', 'RECORD_RESTORED']));
    expect((await trail(id)).find((entry) => entry.event === 'RECORD_RESTORED')).toMatchObject({
      objectType: 'lead',
      actorUserId: fixture.a.userId,
      fieldKey: 'deletedAt',
      // When it was deleted, as a date (the audit writer stored a Date as {}).
      previousValue: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      newValue: null,
    });
  });

  it('answers 404 for a lead not deleted, another workspace’s, or one outside the caller’s delete scope', async () => {
    const restore = await restoreRoute();
    const live = await lead();
    expect((await post(restore, url(live, '/restore'), {}, fixture.a.cookie, { id: live })).status).toBe(404);

    const foreign = fixture.b.leadIds[1]!;
    await prisma.lead.update({ where: { tenantId: fixture.b.tenantId, id: foreign }, data: { deletedAt: new Date() } });
    const across = await post(restore, url(foreign, '/restore'), {}, fixture.a.cookie, { id: foreign });
    expect(across.status).toBe(404);
    expect(await deletedAt(foreign, fixture.b.tenantId)).not.toBeNull();

    const others = await lead();
    expect((await del(deleteLead, url(others), fixture.a.cookie)).status).toBe(200);
    const refused = await post(restore, url(others, '/restore'), {}, rep.cookie, { id: others });
    expect(refused.status).toBe(404);
    expect(refused.body.detail).toBe('Lead not found.');
    expect(await deletedAt(others)).not.toBeNull();

    // The rep's own: deleted and restored by the rep.
    const own = await lead({ ownerId: rep.id });
    expect((await del(deleteLead, url(own), rep.cookie)).status).toBe(200);
    expect((await post(restore, url(own, '/restore'), {}, rep.cookie, { id: own })).status).toBe(200);
    expect(await deletedAt(own)).toBeNull();
  });

  it('needs the delete permission, as the delete did', async () => {
    const restore = await restoreRoute();
    const id = await lead();
    expect((await del(deleteLead, url(id), fixture.a.cookie)).status).toBe(200);
    expect((await post(restore, url(id, '/restore'), {}, editor.cookie, { id })).status).toBe(403);
    expect(await deletedAt(id)).not.toBeNull();
  });
});

describe('bulk Move to Data (M4-39)', () => {
  it('makes a cold record of the lead, on the owner’s list for the day, and closes the lead out', async () => {
    const move = await moveRoute();
    // A zone whose date is not UTC's at this hour, so the batch shows which clock named it.
    const timezone = new Date().getUTCHours() >= 12 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone } });
    const id = await lead({
      fullName: 'Moved Buyer',
      phone: '+971 50 111 2233',
      phoneNormalized: '+971501112233',
      email: 'moved@example.test',
      company: 'Moved LLC',
      notes: 'Called twice.',
      ownerId: rep.id,
    });
    await prisma.leadPhone.create({
      data: { tenantId, leadId: id, raw: '050 222 3344', normalized: '+971502223344', label: 'Office' },
    });

    const res = await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const batch = `From pipeline ${todayKey(timezone)}`;
    expect(batch).not.toBe(`From pipeline ${new Date().toISOString().slice(0, 10)}`);
    expect(res.body).toMatchObject({ id, batch });

    const record = await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id: res.body.dataRecordId } });
    expect(record).toMatchObject({
      fullName: 'Moved Buyer',
      phone: '+971 50 111 2233',
      phoneNormalized: '+971501112233',
      email: 'moved@example.test',
      company: 'Moved LLC',
      status: 'NOT_CONTACTED',
      batch,
      ownerId: rep.id,
      createdById: fixture.a.userId,
      convertedLeadId: null,
    });
    expect(record.notes).toContain('Called twice.');
    expect(record.notes).toContain('+971502223344');

    expect(await read(id)).toMatchObject({ status: 'ARCHIVED', deletedAt: null });
    const audited = await trail(id);
    expect(audited.find((entry) => entry.fieldKey === 'status')).toMatchObject({ newValue: 'ARCHIVED' });
    expect(
      audited.find((entry) => (entry.metadata as { action?: string }).action === 'lead.moved_to_data'),
    ).toMatchObject({
      event: 'RECORD_UPDATED',
      objectType: 'lead',
      metadata: { dataRecordId: record.id, batch },
    });

    // Gone from the working lists, the API's and the grid's alike…
    expect(await listed(fixture.a.cookie)).not.toContain(id);
    expect((await grid(fixture.a.cookie))?.rows.map((row) => row.id)).not.toContain(id);
    // …and on the owner's Cold Data, under the day's list.
    cookieJar.value = rep.cookie;
    const cold = await pageText(ColdDataPage({ searchParams: Promise.resolve({ list: batch }) }));
    expect(cold).toContain('Moved Buyer');
    expect(cold).toContain(batch);
  });

  it('answers 404 for a lead outside the caller’s scope or workspace, and writes nothing', async () => {
    const move = await moveRoute();
    const before = await prisma.dataRecord.count({ where: { tenantId } });
    const others = await lead();
    const refused = await post(move, url(others, '/move-to-data'), {}, rep.cookie, { id: others });
    expect(refused.status).toBe(404);
    expect(refused.body.detail).toBe('Lead not found.');
    expect((await read(others)).status).toBeNull();

    const foreign = fixture.b.leadIds[2]!;
    expect((await post(move, url(foreign, '/move-to-data'), {}, fixture.a.cookie, { id: foreign })).status).toBe(404);
    expect((await read(foreign, fixture.b.tenantId)).status).toBeNull();
    expect(await prisma.dataRecord.count({ where: { tenantId } })).toBe(before);
    expect(await prisma.dataRecord.count({ where: { tenantId: fixture.b.tenantId } })).toBe(0);
  });

  it('needs leads CREATE (a cold record) and EDIT (the close-out); the grid offers it only then', async () => {
    const move = await moveRoute();
    const id = await lead();
    const res = await post(move, url(id, '/move-to-data'), {}, editor.cookie, { id });
    expect(res.status).toBe(403);
    expect((await read(id)).status).toBeNull();
    expect(await prisma.dataRecord.count({ where: { tenantId, fullName: (await read(id)).fullName } })).toBe(0);

    expect((await grid(editor.cookie))?.canMoveToData).toBe(false);
    expect((await grid(rep.cookie))?.canMoveToData).toBe(true);
    expect((await grid(fixture.a.cookie))?.canMoveToData).toBe(true);
  });
});
