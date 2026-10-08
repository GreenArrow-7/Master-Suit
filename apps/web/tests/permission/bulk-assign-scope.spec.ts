import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as assign } from '@/app/api/v1/leads/assign/route';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * Bulk assign takes lead ids in the body. It moved every lead they named in the
 * workspace, whatever the caller's ASSIGN scope, and wrote assignment history
 * for every id it was sent, moved or not.
 */
let h: Hierarchy;
let unassigned: string;
const MISSING = `c${'0'.repeat(24)}`;
const assignAs = (cookie: string, leadIds: string[], ownerId: string) =>
  post(assign, '/api/v1/leads/assign', { leadIds, ownerId }, cookie);
const ownerOf = (leadId: string) =>
  prisma.lead
    .findFirstOrThrow({ where: { tenantId: h.tenantId, id: leadId }, select: { ownerId: true } })
    .then((lead) => lead.ownerId);
const historyOf = (leadId: string) => prisma.leadAssignmentHistory.count({ where: { tenantId: h.tenantId, leadId } });

beforeAll(async () => {
  h = await seedHierarchy();
  const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.leadId } });
  unassigned = (
    await prisma.lead.create({ data: { tenantId: h.tenantId, reference: 'POOL-1', fullName: 'Pool lead', stageId } })
  ).id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe('bulk assign, as a team manager', () => {
  it('moves the team’s leads and unassigned ones, not another team’s, with history only for those', async () => {
    const res = await assignAs(h.teamManagerA.cookie, [h.repA2.leadId, unassigned, h.repB1.leadId], h.repA1.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ assigned: 2 });
    expect(await ownerOf(h.repA2.leadId)).toBe(h.repA1.id);
    expect(await ownerOf(unassigned)).toBe(h.repA1.id);
    expect(await ownerOf(h.repB1.leadId)).toBe(h.repB1.id);
    expect(await historyOf(h.repA2.leadId)).toBe(1);
    expect(await historyOf(h.repB1.leadId)).toBe(0);
  });

  it('counts a lead out of reach exactly as one that does not exist', async () => {
    const theirs = await assignAs(h.teamManagerA.cookie, [h.repB1.leadId], h.repA1.id);
    const missing = await assignAs(h.teamManagerA.cookie, [MISSING], h.repA1.id);
    expect(theirs.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(theirs.body).toEqual({ assigned: 0 });
    expect(missing.body).toEqual(theirs.body);
    expect(await ownerOf(h.repB1.leadId)).toBe(h.repB1.id);
  });

  it('answers an owner who is not in the workspace with 404, not a server error', async () => {
    expect((await assignAs(h.teamManagerA.cookie, [h.repA1.leadId], MISSING)).status).toBe(404);
    expect(await ownerOf(h.repA1.leadId)).toBe(h.repA1.id);
  });
});
