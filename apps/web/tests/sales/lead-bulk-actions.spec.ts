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

// When set, the audit write with this metadata action fails: the case that
// holds Move to Data to one transaction. Every other write passes through.
const failing = vi.hoisted(() => ({ action: '' }));
vi.mock('@/lib/security/audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/security/audit')>();
  return {
    ...real,
    audit: (...args: Parameters<typeof real.audit>) => {
      const action = (args[1].metadata as { action?: string } | undefined)?.action;
      if (failing.action && action === failing.action) throw new Error('audit write failed');
      return real.audit(...args);
    },
  };
});

import { prisma } from '@/lib/db';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { DELETE as deleteLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as convertRecord } from '@/app/api/v1/cold-data/[id]/convert/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import SmartViewsPage from '@/app/(workspace)/[workspaceSlug]/sales/smart-views/page';
import FollowUpsPage from '@/app/(workspace)/[workspaceSlug]/sales/follow-ups/page';
import CalendarPage from '@/app/(workspace)/[workspaceSlug]/sales/calendar/page';
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
type Member = { id: string; roleId: string; cookie: string };
const rep = {} as Member;
const editor = {} as Member;
/** The Telecaller's leads permissions (provisioning.ts): no VIEW_SENSITIVE_FIELDS, so numbers read masked. */
const caller = {} as Member;
/** Reads every lead, numbers masked (the Viewer starter role). */
const viewer = {} as Member;
/** Creates leads, cannot edit them. */
const creator = {} as Member;
/** Reads every lead, deletes only its own. */
const cleaner = {} as Member;
const url = (id: string, tail = '') => `/api/v1/leads/${id}${tail}`;

/** A role and a person holding it; `more` adds grants at a second scope. */
async function member(
  label: string,
  grants: Grants,
  scope: 'OWN' | 'ORGANIZATION',
  more?: { grants: Grants; scope: 'OWN' | 'ORGANIZATION' },
): Promise<Member> {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${tenantId.slice(-6)}`, name: label, rank: 60, defaultScope: scope },
  });
  await grantPermissions(tenantId, role.id, grants, scope);
  if (more) await grantPermissions(tenantId, role.id, more.grants, more.scope);
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
/** The leads Smart Views lists under All Leads. */
async function smartViewRows(cookie: string) {
  cookieJar.value = cookie;
  const tree = elements(await SmartViewsPage({ searchParams: Promise.resolve({}) }));
  return ((tree.find((el) => el.type === LeadGrid)?.props.rows ?? []) as { id: string }[]).map((row) => row.id);
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
        ['smartviews', 'VIEW'],
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
  Object.assign(
    caller,
    await member(
      'bulk-caller',
      [
        ['leads', 'VIEW'],
        ['leads', 'CREATE'],
        ['leads', 'EDIT'],
      ],
      'OWN',
    ),
  );
  Object.assign(viewer, await member('bulk-viewer', [['leads', 'VIEW']], 'ORGANIZATION'));
  Object.assign(
    creator,
    await member(
      'bulk-creator',
      [
        ['leads', 'VIEW'],
        ['leads', 'CREATE'],
        ['leads', 'VIEW_SENSITIVE_FIELDS'],
      ],
      'ORGANIZATION',
    ),
  );
  Object.assign(
    cleaner,
    await member('bulk-cleaner', [['leads', 'VIEW']], 'ORGANIZATION', {
      grants: [['leads', 'DELETE']],
      scope: 'OWN',
    }),
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

  it('refuses a role whose tags field is read-only, so the bulk bar counts the lead as not tagged', async () => {
    await prisma.fieldPermission.create({
      data: { tenantId, roleId: editor.roleId, objectType: 'LEAD', fieldKey: 'tags', canView: true, canEdit: false },
    });
    const id = await lead({ tags: ['vip'] });
    const { updatedAt } = await read(id);
    const res = await patch(patchLead, url(id), { addTags: ['cold'] }, editor.cookie);
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Your role cannot change this lead’s tags.');
    // Untouched: not even moved to the top of the list.
    expect(await read(id)).toMatchObject({ tags: ['vip'], updatedAt });
  });

  it('adds every tag when several adds reach one lead at once', async () => {
    const id = await lead({ tags: ['vip'] });
    const tags = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const answers = await Promise.all(
      tags.map((tag) => patch(patchLead, url(id), { addTags: [tag] }, fixture.a.cookie)),
    );
    expect(answers.map((res) => res.status)).toEqual(tags.map(() => 200));
    expect([...(await read(id)).tags].sort()).toEqual(['vip', ...tags].sort());
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

  it('is reached at the delete’s scope, not the view’s: a lead the caller sees but may not delete answers 404', async () => {
    const restore = await restoreRoute();
    const id = await lead();
    expect(await listed(cleaner.cookie)).toContain(id);
    expect((await del(deleteLead, url(id), fixture.a.cookie)).status).toBe(200);
    const refused = await post(restore, url(id, '/restore'), {}, cleaner.cookie, { id });
    expect(refused.status).toBe(404);
    expect(await deletedAt(id)).not.toBeNull();

    const own = await lead({ ownerId: cleaner.id });
    expect((await del(deleteLead, url(own), cleaner.cookie)).status).toBe(200);
    expect((await post(restore, url(own, '/restore'), {}, cleaner.cookie, { id: own })).status).toBe(200);
  });

  it('refuses a lead whose number another lead took meanwhile, as adding it again would', async () => {
    const restore = await restoreRoute();
    const phone = `+97155${String(Date.now()).slice(-7)}`;
    const id = await lead({ phone, phoneNormalized: phone });
    expect((await del(deleteLead, url(id), fixture.a.cookie)).status).toBe(200);
    await lead({ phone, phoneNormalized: phone });
    const res = await post(restore, url(id, '/restore'), {}, fixture.a.cookie, { id });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/^A lead with this phone(Normalized)? was added since \(BULK-/);
    expect(await deletedAt(id)).not.toBeNull();
  });

  it('a delete, its restore and a Move to Data each leave one row on the lead, the delete at the instant it stored', async () => {
    const [restore, move] = [await restoreRoute(), await moveRoute()];
    const phone = `+97156${String(Date.now()).slice(-7)}`;
    const id = await lead({ phone, phoneNormalized: phone });
    /** The lead's rows for one action, read as the Audit Log reads them: by object and record. */
    const rows = async (event: string, action?: string) =>
      (await trail(id)).filter((row) => row.event === event && (row.metadata as { action?: string }).action === action);

    expect((await del(deleteLead, url(id), fixture.a.cookie)).status).toBe(200);
    const stored = (await deletedAt(id))!.toISOString();
    expect(await rows('RECORD_DELETED')).toEqual([
      expect.objectContaining({ objectType: 'lead', fieldKey: 'deletedAt', previousValue: null, newValue: stored }),
    ]);
    // One row for the delete: no second one naming the same field.
    expect((await trail(id)).filter((row) => row.fieldKey === 'deletedAt')).toHaveLength(1);

    expect((await post(restore, url(id, '/restore'), {}, fixture.a.cookie, { id })).status).toBe(200);
    expect(await rows('RECORD_RESTORED')).toEqual([
      expect.objectContaining({ objectType: 'lead', fieldKey: 'deletedAt', previousValue: stored, newValue: null }),
    ]);

    expect((await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id })).status).toBe(200);
    expect(await rows('RECORD_UPDATED', 'lead.moved_to_data')).toEqual([
      expect.objectContaining({ objectType: 'lead' }),
    ]);
    // Every row of the three names the lead the same way.
    expect(new Set((await trail(id)).map((row) => row.objectType))).toEqual(new Set(['lead']));
  });
});

describe('bulk Move to Data (M4-39)', () => {
  it('makes a cold record of the lead, on the owner’s list for the day, and takes the lead off every working list', async () => {
    const move = await moveRoute();
    // A zone whose date is not UTC's at this hour, so the batch shows which clock named it:
    // UTC+14 is a day ahead from 10:00 UTC, UTC-11 a day behind until 11:00.
    const timezone = new Date().getUTCHours() >= 11 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
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
    // Its open work: a follow-up due a minute ago and a task, both on the lists below until the move.
    const dueAt = new Date(Date.now() - 60_000);
    const followUp = await prisma.followUpTask.create({
      data: { tenantId, leadId: id, ownerId: rep.id, title: 'Chase Moved Buyer', dueAt },
    });
    const type = await prisma.taskType.create({ data: { tenantId, key: `call-${n}`, name: 'Call' } });
    const task = await prisma.task.create({
      data: { tenantId, typeId: type.id, leadId: id, ownerId: rep.id, title: 'Send Moved Buyer the brochure', dueAt },
    });
    await prisma.lead.update({ where: { tenantId, id }, data: { nextFollowUpAt: dueAt } });
    const followUpsText = async () => {
      cookieJar.value = rep.cookie;
      return pageText(FollowUpsPage({ searchParams: Promise.resolve({}) }));
    };
    const calendarText = async () => {
      cookieJar.value = fixture.a.cookie;
      return pageText(CalendarPage({ searchParams: Promise.resolve({}) }));
    };
    expect(await smartViewRows(rep.cookie)).toContain(id);
    expect(await followUpsText()).toContain('Chase Moved Buyer');
    expect(await calendarText()).toContain('Send Moved Buyer the brochure');

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

    expect(await read(id)).toMatchObject({ status: 'ARCHIVED', deletedAt: null, nextFollowUpAt: null });
    expect(await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, id: followUp.id } })).toMatchObject({
      status: 'CANCELLED',
    });
    expect(await prisma.task.findFirstOrThrow({ where: { tenantId, id: task.id } })).toMatchObject({
      status: 'CANCELLED',
    });
    const audited = await trail(id);
    expect(audited.find((entry) => entry.fieldKey === 'status')).toMatchObject({ newValue: 'ARCHIVED' });
    expect(
      audited.find((entry) => (entry.metadata as { action?: string }).action === 'lead.moved_to_data'),
    ).toMatchObject({
      event: 'RECORD_UPDATED',
      objectType: 'lead',
      metadata: { dataRecordId: record.id, batch, followUpsCancelled: [followUp.id], tasksCancelled: [task.id] },
    });

    // Gone from the working lists: the API's, the grid's, Smart Views', Follow-ups' and the calendar's…
    expect(await listed(fixture.a.cookie)).not.toContain(id);
    expect((await grid(fixture.a.cookie))?.rows.map((row) => row.id)).not.toContain(id);
    expect(await smartViewRows(rep.cookie)).not.toContain(id);
    expect(await followUpsText()).not.toContain('Chase Moved Buyer');
    expect(await calendarText()).not.toContain('Send Moved Buyer the brochure');
    // …and on the owner's Cold Data, under the day's list, every number as stored.
    cookieJar.value = rep.cookie;
    const cold = await pageText(ColdDataPage({ searchParams: Promise.resolve({ list: batch }) }));
    expect(cold).toContain('Moved Buyer');
    expect(cold).toContain(batch);
    expect(cold).toContain('+971502223344');
    // A role that reads lead numbers masked reads them masked there, the notes' too.
    cookieJar.value = viewer.cookie;
    const masked = await pageText(ColdDataPage({ searchParams: Promise.resolve({ list: batch }) }));
    expect(masked).toContain('Moved Buyer');
    expect(masked).not.toContain('+971502223344');
    expect(masked).not.toContain('111 2233');
    expect(masked).toMatch(/\+971•+44/);

    // Make lead on the moved contact reopens the lead it was, which is where the enquiry lands.
    const converted = await post(convertRecord, `/api/v1/cold-data/${record.id}/convert`, {}, rep.cookie, {
      id: record.id,
    });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    expect(converted.body).toMatchObject({ leadId: id, created: false });
    expect((await read(id)).status).toBeNull();
    expect(await listed(rep.cookie)).toContain(id);
    expect((await trail(id)).filter((entry) => entry.fieldKey === 'status').map((entry) => entry.newValue)).toEqual([
      'ARCHIVED',
      null,
    ]);
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
    const records = () => prisma.dataRecord.count({ where: { tenantId } });
    const before = await records();
    const id = await lead();
    for (const role of [editor, creator]) {
      const res = await post(move, url(id, '/move-to-data'), {}, role.cookie, { id });
      expect(res.status).toBe(403);
    }
    expect((await read(id)).status).toBeNull();
    expect(await records()).toBe(before);

    expect((await grid(editor.cookie))?.canMoveToData).toBe(false);
    expect((await grid(creator.cookie))?.canMoveToData).toBe(false);
    expect((await grid(rep.cookie))?.canMoveToData).toBe(true);
    expect((await grid(fixture.a.cookie))?.canMoveToData).toBe(true);
  });

  it('is refused where the move would show masked numbers in full: a Telecaller, or a lead a Telecaller owns', async () => {
    const move = await moveRoute();
    const records = () => prisma.dataRecord.count({ where: { tenantId } });
    const before = await records();
    const phone = `+97156${String(Date.now()).slice(-7)}`;
    const id = await lead({ ownerId: caller.id, phone, phoneNormalized: phone });

    // The Telecaller holds leads CREATE and EDIT, but reads lead numbers masked.
    const own = await post(move, url(id, '/move-to-data'), {}, caller.cookie, { id });
    expect(own.status).toBe(403);
    expect(own.body.detail).toBe('Your role cannot move leads to Cold Data.');
    expect((await grid(caller.cookie))?.canMoveToData).toBe(false);

    // An administrator moving it would make it the Telecaller's own cold record, read as stored.
    const theirs = await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id });
    expect(theirs.status).toBe(409);
    expect(theirs.body.detail).toMatch(/^Its owner reads lead numbers masked/);
    expect((await read(id)).status).toBeNull();
    expect(await records()).toBe(before);
  });

  it('moves a lead once: a closed-out lead (a replay, or a duplicate) answers 409 and keeps what it was', async () => {
    const move = await moveRoute();
    const id = await lead({ ownerId: rep.id });
    expect((await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id })).status).toBe(200);
    const again = await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id });
    expect(again.status).toBe(409);
    expect(again.body.detail).toBe('This lead is closed out: reopen it to move it to Cold Data.');
    const name = (await read(id)).fullName;
    expect(await prisma.dataRecord.count({ where: { tenantId, fullName: name } })).toBe(1);

    const original = await lead();
    const duplicate = await lead({ status: 'DUPLICATE', duplicateOfId: original });
    const refused = await post(move, url(duplicate, '/move-to-data'), {}, fixture.a.cookie, { id: duplicate });
    expect(refused.status).toBe(409);
    expect(await read(duplicate)).toMatchObject({ status: 'DUPLICATE', duplicateOfId: original });
  });

  it('is one transaction: a failure after the close-out leaves the lead, its work and Cold Data as they were', async () => {
    const move = await moveRoute();
    const records = () => prisma.dataRecord.count({ where: { tenantId } });
    const before = await records();
    const id = await lead({ ownerId: rep.id });
    const followUp = await prisma.followUpTask.create({
      data: { tenantId, leadId: id, ownerId: rep.id, title: 'Kept', dueAt: new Date(Date.now() + 3_600_000) },
    });
    failing.action = 'lead.moved_to_data';
    try {
      const res = await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id });
      expect(res.status).toBe(500);
    } finally {
      failing.action = '';
    }
    expect((await read(id)).status).toBeNull();
    expect((await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, id: followUp.id } })).status).toBe('OPEN');
    expect(await records()).toBe(before);
    expect((await trail(id)).filter((entry) => entry.fieldKey === 'status')).toEqual([]);
  });

  it('gives a lead with no main number its first other one, and an unassigned lead an unassigned record', async () => {
    const move = await moveRoute();
    const id = await lead({ ownerId: null });
    await prisma.leadPhone.createMany({
      data: [
        {
          tenantId,
          leadId: id,
          raw: '050 333 4455',
          normalized: '+971503334455',
          createdAt: new Date(Date.now() - 1000),
        },
        { tenantId, leadId: id, raw: '050 444 5566', normalized: '+971504445566', createdAt: new Date() },
      ],
    });
    const res = await post(move, url(id, '/move-to-data'), {}, fixture.a.cookie, { id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const record = await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id: res.body.dataRecordId } });
    expect(record).toMatchObject({ phone: '050 333 4455', phoneNormalized: '+971503334455', ownerId: null });
    expect(record.notes).toBe('Other numbers: +971504445566');
  });
});
