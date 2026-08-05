/**
 * Visibility scopes and write-path escalation, against a real org hierarchy.
 *
 * The fixture this used to run on invented its users and never touched the
 * database, so every assertion here was vacuous. See tests/helpers/fixtures.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { get, patch } from '../helpers/request';

let h: Hierarchy;
beforeAll(async () => { h = await seedHierarchy(); }, 60_000);
afterAll(async () => { await h?.cleanup(); });

const ownersVisibleTo = async (cookie: string): Promise<Set<string>> => {
  const res = await get(listLeads, '/api/v1/leads?limit=200', cookie);
  expect(res.status).toBe(200);
  return new Set(res.body.data.map((lead: any) => lead.ownerId));
};

describe('visibility scopes', () => {
  it('OWN — a rep sees only their own leads', async () => {
    expect([...await ownersVisibleTo(h.repA1.cookie)]).toEqual([h.repA1.id]);
  });

  it('TEAM — a team manager sees the whole team, including descendant teams', async () => {
    const owners = await ownersVisibleTo(h.teamManagerA.cookie);
    expect(owners).toContain(h.repA1.id);
    expect(owners).toContain(h.repA2.id);
    expect(owners).toContain(h.repSubTeam.id);
    expect(owners).not.toContain(h.repB1.id);
  });

  it('BRANCH — a branch manager sees every team in the branch', async () => {
    const owners = await ownersVisibleTo(h.branchManager.cookie);
    expect(owners).toContain(h.repA1.id);
    expect(owners).toContain(h.repSubTeam.id);
    expect(owners).not.toContain(h.repB1.id);
    expect(owners).not.toContain(h.repOtherRegion.id);
  });

  it('REGION — a regional manager sees every branch in the region', async () => {
    const owners = await ownersVisibleTo(h.regionalManager.cookie);
    expect(owners).toContain(h.repA1.id);
    expect(owners).toContain(h.repB1.id);
    expect(owners).not.toContain(h.repOtherRegion.id);
  });

  it('ORGANIZATION — the director sees everything in the workspace', async () => {
    const res = await get(listLeads, '/api/v1/leads?limit=200', h.director.cookie);
    expect(res.body.data).toHaveLength(h.totalLeads);
  });
});

describe('write-path re-check (IDOR)', () => {
  it('a rep cannot patch a teammate lead even with a direct id', async () => {
    const res = await patch(patchLead, `/api/v1/leads/${h.repA2.leadId}`, { fullName: 'Taken' }, h.repA1.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('a rep cannot patch a lead in another branch', async () => {
    const res = await patch(patchLead, `/api/v1/leads/${h.repB1.leadId}`, { fullName: 'Taken' }, h.repA1.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a rep cannot reassign a lead to another user without ASSIGN', async () => {
    // updateLead drops ownerId rather than refusing the whole request, so the
    // assertion is on the outcome: the lead must not change hands.
    await patch(patchLead, `/api/v1/leads/${h.repA1.leadId}`, { ownerId: h.repA2.id }, h.repA1.cookie);
    const lead = await prisma.lead.findFirst({ where: { tenantId: h.tenantId, id: h.repA1.leadId } });
    expect(lead?.ownerId).toBe(h.repA1.id);
  });

  it('a manager can patch a lead inside their scope', async () => {
    const res = await patch(patchLead, `/api/v1/leads/${h.repA1.leadId}`, { fullName: 'Coached' }, h.teamManagerA.cookie);
    expect(res.status).toBe(200);
  });

  it('a team manager cannot patch a lead outside their team', async () => {
    const res = await patch(patchLead, `/api/v1/leads/${h.repOtherRegion.leadId}`, { fullName: 'Reached' }, h.teamManagerA.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
