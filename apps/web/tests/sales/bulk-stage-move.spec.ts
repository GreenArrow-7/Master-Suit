/**
 * The contract the grid's bulk move relays, one lead at a time: every PATCH is
 * its own transaction, so a refusal rolls back only itself, and the refusal's
 * `detail` is the sentence the bulk bar shows — a 404 for a lead the actor
 * cannot see or edit, a 422 naming what the stage still needs — with nothing
 * else about the lead in the body.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { patch } from '../helpers/request';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';

let fixture: Fixture;
let tenantId: string;
let viewing: { id: string };
let ownCookie: string;
const url = (leadId: string) => `/api/v1/leads/${leadId}`;
const stageOf = async (leadId: string, owner = tenantId) =>
  (await prisma.lead.findFirstOrThrow({ where: { tenantId: owner, id: leadId }, select: { stageId: true } })).stageId;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  viewing = await prisma.leadStage.create({
    data: { tenantId, key: 'viewing_bulk', name: 'Viewing booked', position: 6, requiredFields: ['email'] },
  });
  await prisma.lead.update({ where: { tenantId, id: fixture.a.leadIds[0]! }, data: { email: 'buyer@example.test' } });
  const ownRole = await prisma.role.create({
    data: { tenantId, key: 'own_rep', name: 'Own rep', rank: 60, defaultScope: 'OWN' },
  });
  await grantPermissions(
    tenantId,
    ownRole.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ] as const,
    'OWN',
  );
  const ownUser = await createWorkspaceUser({
    tenantId,
    roleId: ownRole.id,
    email: `own-rep@${fixture.a.slug}.test`,
    fullName: 'Own rep',
  });
  ownCookie = await createSessionToken(tenantId, ownUser.id);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('a bulk stage move, one request per lead', () => {
  it('lets each lead answer for itself and rolls back only the refused one', async () => {
    const [ready, noEmail] = fixture.a.leadIds as [string, string];
    const foreign = fixture.b.leadIds[0]!;

    const moved = await patch(patchLead, url(ready), { stageId: viewing.id }, fixture.a.cookie);
    expect(moved.status).toBe(200);

    const refused = await patch(patchLead, url(noEmail), { stageId: viewing.id }, fixture.a.cookie);
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toBe('Viewing booked needs: email.');

    const unseen = await patch(patchLead, url(foreign), { stageId: viewing.id }, fixture.a.cookie);
    expect(unseen.status).toBe(404);
    expect(unseen.body.detail).toBe('Lead not found.');
    expect(unseen.body).not.toHaveProperty('fullName');
    expect(unseen.body.errors).toBeUndefined();

    expect(await stageOf(ready)).toBe(viewing.id);
    expect(await stageOf(noEmail)).toBe(fixture.a.stageId);
    expect(await stageOf(foreign, fixture.b.tenantId)).toBe(fixture.b.stageId);
  });

  it('answers "not found" for a lead outside the actor’s edit scope, with nothing about the lead', async () => {
    // The same 404 as another tenant's lead: a 403 would confirm the id exists.
    const leadId = fixture.a.leadIds[2]!;
    const res = await patch(patchLead, url(leadId), { stageId: viewing.id }, ownCookie);
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('Lead not found.');
    expect(res.body).not.toHaveProperty('fullName');
    expect(res.body).not.toHaveProperty('ownerId');
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
  });
});
