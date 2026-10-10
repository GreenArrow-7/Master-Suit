import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DELETE as deleteLead, GET as getLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as closeOut } from '@/app/api/v1/leads/[id]/close-out/route';
import { DELETE as removePhone, POST as addPhone } from '@/app/api/v1/leads/[id]/phones/route';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';

/**
 * A lead's own by-id routes under the lead's rule. GET already answered 404 for
 * a lead outside the caller's scope; the writes beside it (PATCH, DELETE,
 * close-out, phones) answered 403, which told the caller the id was real. All
 * of them now answer exactly as a lead that does not exist, and a close-out's
 * `duplicateOfId` may name only a lead the caller may see.
 */
let h: Hierarchy;
let secondOwnLeadId: string;
let theirPhoneId: string;
const MISSING = `c${'0'.repeat(24)}`;

/** Every by-id route, as the OWN-scope rep `as` sends it. */
const BY_ID = [
  { name: 'GET', send: (id: string, as: string) => get(getLead, `/api/v1/leads/${id}`, as) },
  {
    name: 'PATCH',
    send: (id: string, as: string) => patch(patchLead, `/api/v1/leads/${id}`, { fullName: 'Taken' }, as),
  },
  { name: 'DELETE', send: (id: string, as: string) => del(deleteLead, `/api/v1/leads/${id}`, as) },
  {
    name: 'close-out',
    send: (id: string, as: string) => post(closeOut, `/api/v1/leads/${id}/close-out`, { status: 'ARCHIVED' }, as),
  },
  {
    name: 'adding a phone',
    send: (id: string, as: string) => post(addPhone, `/api/v1/leads/${id}/phones`, { phone: '+971500000002' }, as),
  },
  {
    name: 'removing a phone',
    send: (id: string, as: string) => del(removePhone, `/api/v1/leads/${id}/phones?phoneId=${theirPhoneId}`, as),
  },
];

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: h.repA1.leadId } });
  secondOwnLeadId = (
    await prisma.lead.create({
      data: { tenantId, reference: 'REPA1-SECOND', fullName: 'repA1 second lead', stageId, ownerId: h.repA1.id },
    })
  ).id;
  theirPhoneId = (
    await prisma.leadPhone.create({
      data: { tenantId, leadId: h.repA2.leadId, raw: '0509990001', normalized: '+971509990001' },
    })
  ).id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe.each(BY_ID)('$name', ({ send }) => {
  it('answers a teammate’s lead exactly as a lead that does not exist', async () => {
    const theirs = await send(h.repA2.leadId, h.repA1.cookie);
    const missing = await send(MISSING, h.repA1.cookie);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
  });
});

describe('the refusals', () => {
  it('left the teammate’s lead as it was', async () => {
    const where = { tenantId: h.tenantId, id: h.repA2.leadId };
    const lead = await prisma.lead.findFirstOrThrow({
      where,
      select: { fullName: true, deletedAt: true, status: true },
    });
    expect(lead).toEqual({ fullName: 'repA2 lead', deletedAt: null, status: null });
    expect(await prisma.leadPhone.count({ where: { tenantId: h.tenantId, leadId: h.repA2.leadId } })).toBe(1);
  });
});

describe('the caller’s own lead', () => {
  it('takes every route', async () => {
    const { leadId, cookie } = h.repA1;
    expect((await get(getLead, `/api/v1/leads/${leadId}`, cookie)).status).toBe(200);
    expect((await patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Mine' }, cookie)).status).toBe(200);
    const phone = await post(addPhone, `/api/v1/leads/${leadId}/phones`, { phone: '+971500000003' }, cookie);
    expect(phone.status, JSON.stringify(phone.body)).toBe(200);
    const removed = await del(removePhone, `/api/v1/leads/${leadId}/phones?phoneId=${phone.body.id}`, cookie);
    expect(removed.status).toBe(200);
    const closeOutAs = (status: string) => post(closeOut, `/api/v1/leads/${leadId}/close-out`, { status }, cookie);
    expect((await closeOutAs('ARCHIVED')).status).toBe(200);
    expect((await closeOutAs('OPEN')).status).toBe(200);
  });
});

describe('a team manager', () => {
  it('edits the team’s leads, descendant team included, and not another team’s', async () => {
    const edit = (leadId: string) =>
      patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Coached' }, h.teamManagerA.cookie);
    expect((await edit(h.repA1.leadId)).status).toBe(200);
    expect((await edit(h.repSubTeam.leadId)).status).toBe(200);
    const other = await edit(h.repB1.leadId);
    expect(other.status).toBe(404);
    expect(other.body.detail).toBe('Lead not found.');
    expect((await del(deleteLead, `/api/v1/leads/${h.repB1.leadId}`, h.teamManagerA.cookie)).status).toBe(404);
  });
});

describe('the director', () => {
  it('reaches a lead in another region', async () => {
    const { leadId } = h.repOtherRegion;
    expect((await get(getLead, `/api/v1/leads/${leadId}`, h.director.cookie)).status).toBe(200);
    expect((await patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Seen' }, h.director.cookie)).status).toBe(
      200,
    );
  });
});

describe('closing out as a duplicate', () => {
  it('names only a lead the caller may see as the original', async () => {
    const { leadId, cookie } = h.repA1;
    const dup = (duplicateOfId: string) =>
      post(closeOut, `/api/v1/leads/${leadId}/close-out`, { status: 'DUPLICATE', duplicateOfId }, cookie);
    const theirs = await dup(h.repA2.leadId);
    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBe('Lead not found.');
    const row = await prisma.lead.findFirstOrThrow({
      where: { tenantId: h.tenantId, id: leadId },
      select: { status: true, duplicateOfId: true },
    });
    expect(row).toEqual({ status: null, duplicateOfId: null });

    const own = await dup(secondOwnLeadId);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.duplicateOfId).toBe(secondOwnLeadId);
  });
});

describe('deleting', () => {
  it('takes the caller’s own lead', async () => {
    expect((await del(deleteLead, `/api/v1/leads/${h.repA1.leadId}`, h.repA1.cookie)).status).toBe(200);
  });
});
