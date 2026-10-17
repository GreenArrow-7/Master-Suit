import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as queue from '@/lib/queue';
import { POST as assign } from '@/app/api/v1/leads/assign/route';
import { POST as createLeadRoute } from '@/app/api/v1/leads/route';
import { POST as convertEnquiry } from '@/app/api/v1/social-leads/[id]/convert/route';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * Bulk assignment under the caller's ASSIGN scope. The route moved every id it
 * was given with a workspace check only, so a team manager (ASSIGN at TEAM)
 * could reassign any lead in the workspace by id — and an id that did not
 * exist 500ed on the history row's foreign key.
 */
let h: Hierarchy;
const MISSING = `c${'0'.repeat(24)}`;
const send = (leadIds: string[], as: string) =>
  post(assign, '/api/v1/leads/assign', { leadIds, ownerId: h.repA1.id }, as);
const ownerOf = async (id: string) =>
  (await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id }, select: { ownerId: true } })).ownerId;

beforeAll(async () => {
  h = await seedHierarchy();
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe('bulk assignment', () => {
  it('skips a lead outside the team manager’s scope and writes no history for it', async () => {
    const res = await send([h.repB1.leadId], h.teamManagerA.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ assigned: 0 });
    expect(await ownerOf(h.repB1.leadId)).toBe(h.repB1.id);
    const history = await prisma.leadAssignmentHistory.count({
      where: { tenantId: h.tenantId, leadId: h.repB1.leadId },
    });
    expect(history).toBe(0);
  });

  it('moves the team’s lead and ignores an id that does not exist', async () => {
    const res = await send([h.repA2.leadId, MISSING], h.teamManagerA.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ assigned: 1 });
    expect(await ownerOf(h.repA2.leadId)).toBe(h.repA1.id);
    const history = await prisma.leadAssignmentHistory.findMany({
      where: { tenantId: h.tenantId, leadId: h.repA2.leadId },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ toOwnerId: h.repA1.id, reason: 'bulk_assignment' });
    // Audit M17-05, M17-07: the new owner and the previous one each hear of it, once.
    const told = await prisma.notification.findMany({
      where: { tenantId: h.tenantId, recordId: h.repA2.leadId, kind: 'lead.assigned' },
      select: { userId: true, priority: true, readAt: true },
    });
    expect(told).toHaveLength(2);
    expect(told).toEqual(
      expect.arrayContaining([
        { userId: h.repA1.id, priority: 'HIGH', readAt: null },
        { userId: h.repA2.id, priority: 'MEDIUM', readAt: null },
      ]),
    );
  });

  // Audit M17-05: one push for the batch, counting only the leads that changed hands.
  it('rings the new owner once, for the leads that were not already theirs', async () => {
    const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.leadId } });
    const pool = await Promise.all(
      ['RING-1', 'RING-2'].map((reference) =>
        prisma.lead.create({ data: { tenantId: h.tenantId, reference, fullName: reference, stageId } }),
      ),
    );
    const spy = vi.spyOn(queue, 'enqueue').mockResolvedValue(null as never);
    try {
      const res = await send([h.repA1.leadId, ...pool.map((lead) => lead.id)], h.teamManagerA.cookie);
      expect(res.body).toEqual({ assigned: 2 });
      const pushes = spy.mock.calls.filter(([, job]) => job === 'record-push').map(([, , data]) => data);
      expect(pushes).toEqual([
        expect.objectContaining({
          userIds: [h.repA1.id],
          title: '2 leads were assigned to you',
          objectType: 'leads_mine',
          recordId: null,
        }),
      ]);
    } finally {
      spy.mockRestore();
    }
    // Already theirs: no hand-over recorded, no bell row.
    const unmoved = { tenantId: h.tenantId, leadId: h.repA1.leadId };
    expect(await prisma.leadAssignmentHistory.count({ where: unmoved })).toBe(0);
    expect(
      await prisma.notification.count({
        where: { tenantId: h.tenantId, recordId: h.repA1.leadId, kind: 'lead.assigned' },
      }),
    ).toBe(0);
  });

  it('moves an unassigned lead for a manager who may claim it', async () => {
    const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.leadId } });
    const pool = await prisma.lead.create({
      data: { tenantId: h.tenantId, reference: 'POOL-1', fullName: 'Pool lead', stageId },
    });
    expect((await send([pool.id], h.teamManagerA.cookie)).body).toEqual({ assigned: 1 });
    expect(await ownerOf(pool.id)).toBe(h.repA1.id);
  });

  it('answers an owner who is not in the workspace with 404, not a server error', async () => {
    const body = { leadIds: [h.repA1.leadId], ownerId: MISSING };
    expect((await post(assign, '/api/v1/leads/assign', body, h.teamManagerA.cookie)).status).toBe(404);
  });

  it('lets the director move a lead in another region', async () => {
    const res = await send([h.repOtherRegion.leadId], h.director.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ assigned: 1 });
  });

  it('refuses a rep without ASSIGN', async () => {
    expect((await send([h.repA1.leadId], h.repA1.cookie)).status).toBe(403);
  });

  // A suspended account signs nobody in: a lead handed to one sits where no
  // colleague at OWN scope sees it and the Allocation queue does not list it.
  it('refuses to hand leads to a suspended account', async () => {
    await prisma.user.update({ where: { tenantId: h.tenantId, id: h.repB1.id }, data: { status: 'SUSPENDED' } });
    try {
      const res = await post(
        assign,
        '/api/v1/leads/assign',
        { leadIds: [h.repSubTeam.leadId], ownerId: h.repB1.id },
        h.director.cookie,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await ownerOf(h.repSubTeam.leadId)).toBe(h.repSubTeam.id);
    } finally {
      await prisma.user.update({ where: { tenantId: h.tenantId, id: h.repB1.id }, data: { status: 'ACTIVE' } });
    }
  });

  // The platform console suspends the membership and leaves the workspace User
  // ACTIVE; that person cannot sign in either.
  it('refuses an owner whose workspace access is suspended', async () => {
    const membership = { tenantId: h.tenantId, salesUserId: h.repB1.id };
    await prisma.workspaceMembership.updateMany({ where: membership, data: { status: 'SUSPENDED' } });
    try {
      const res = await post(
        assign,
        '/api/v1/leads/assign',
        { leadIds: [h.repSubTeam.leadId], ownerId: h.repB1.id },
        h.director.cookie,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await ownerOf(h.repSubTeam.leadId)).toBe(h.repSubTeam.id);
    } finally {
      await prisma.workspaceMembership.updateMany({ where: membership, data: { status: 'ACTIVE' } });
    }
  });
});

describe('a lead created for a colleague (audit M17-05)', () => {
  it('tells them it is theirs, in the bell and on the phone', async () => {
    const res = await post(
      createLeadRoute,
      '/api/v1/leads',
      { fullName: 'Made for a colleague', ownerId: h.repA1.id, onDuplicate: 'WARN' },
      h.teamManagerA.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const told = await prisma.notification.findFirstOrThrow({
      where: { tenantId: h.tenantId, userId: h.repA1.id, recordId: res.body.id, kind: 'lead.assigned' },
    });
    expect(told).toMatchObject({ priority: 'HIGH', readAt: null });
    expect(told.channels).toContain('push');
  });

  it('tells the owner of a social enquiry a manager converts, and dates the hand-over', async () => {
    const enquiry = await prisma.socialComment.create({
      data: {
        tenantId: h.tenantId,
        provider: 'instagram',
        providerCommentId: `ring-${Date.now()}`,
        authorName: 'commenter',
        commentText: 'Price for the 2-bed?',
        commentCreatedAt: new Date(),
        ownerId: h.repA1.id,
      },
    });
    const res = await post(
      convertEnquiry,
      `/api/v1/social-leads/${enquiry.id}/convert`,
      { fullName: 'Converted for a colleague' },
      h.teamManagerA.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: res.body.leadId } });
    expect(lead.ownerId).toBe(h.repA1.id);
    expect(lead.assignedAt).not.toBeNull();
    const history = await prisma.leadAssignmentHistory.findFirstOrThrow({
      where: { tenantId: h.tenantId, leadId: lead.id },
    });
    expect(history).toMatchObject({ toOwnerId: h.repA1.id, assignedById: h.teamManagerA.id });
    const told = await prisma.notification.findFirstOrThrow({
      where: { tenantId: h.tenantId, userId: h.repA1.id, recordId: lead.id, kind: 'lead.assigned' },
    });
    expect(told).toMatchObject({ title: 'Lead assigned: Converted for a colleague', priority: 'HIGH' });
  });
});
