import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as assign } from '@/app/api/v1/leads/assign/route';
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
});
