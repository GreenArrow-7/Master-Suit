import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { patch } from '../helpers/request';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * A stage that claims something happened carries the evidence (Lead Eagle plan,
 * gap 3): a reason, from its list when it has one, and the fields it names —
 * checked in the shared update path, so the lead screen and the grid's bulk
 * move obey the same rule.
 */
let fixture: Fixture;
let tenantId: string;
let lost: { id: string };
let viewing: { id: string };
const url = (leadId: string) => `/api/v1/leads/${leadId}`;
const stageOf = async (leadId: string) =>
  prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: { stageId: true, stageReason: true } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  lost = await prisma.leadStage.create({
    data: {
      tenantId,
      key: 'lost_reasons',
      name: 'Lost',
      position: 9,
      category: 'TERMINAL_NEGATIVE',
      requiresReason: true,
      reasons: ['Budget', 'Bought elsewhere'],
    },
  });
  viewing = await prisma.leadStage.create({
    data: { tenantId, key: 'viewing_booked', name: 'Viewing booked', position: 5, requiredFields: ['phone', 'email'] },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('entering a stage', () => {
  it('refuses a stage that needs a reason without one, or with one it does not offer', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const none = await patch(patchLead, url(leadId), { stageId: lost.id }, fixture.a.cookie);
    expect(none.status).toBe(422);
    expect(none.body.detail).toBe('Moving a lead to Lost needs a reason.');
    const odd = await patch(patchLead, url(leadId), { stageId: lost.id, stageReason: 'Moon phase' }, fixture.a.cookie);
    expect(odd.status).toBe(422);
    expect((await stageOf(leadId)).stageId).toBe(fixture.a.stageId);
  });

  it('moves with an offered reason and keeps it on the lead and its history', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const moved = await patch(patchLead, url(leadId), { stageId: lost.id, stageReason: 'Budget' }, fixture.a.cookie);
    expect(moved.status).toBe(200);
    expect(await stageOf(leadId)).toEqual({ stageId: lost.id, stageReason: 'Budget' });
    const history = await prisma.leadStageHistory.findFirst({ where: { tenantId, leadId, toStageId: lost.id } });
    expect(history?.reason).toBe('Budget');
  });

  it('clears the reason when the lead moves on', async () => {
    const leadId = fixture.a.leadIds[0]!;
    expect((await patch(patchLead, url(leadId), { stageId: fixture.a.stageId }, fixture.a.cookie)).status).toBe(200);
    expect(await stageOf(leadId)).toEqual({ stageId: fixture.a.stageId, stageReason: null });
  });

  it('needs the stage’s fields filled first, and accepts them in the same move', async () => {
    const leadId = fixture.a.leadIds[1]!;
    const empty = await patch(patchLead, url(leadId), { stageId: viewing.id }, fixture.a.cookie);
    expect(empty.status).toBe(422);
    expect(empty.body.detail).toBe('Viewing booked needs: phone, email.');
    const filled = await patch(
      patchLead,
      url(leadId),
      { stageId: viewing.id, phone: '0501234567', email: 'buyer@example.test' },
      fixture.a.cookie,
    );
    expect(filled.status).toBe(200);
    expect((await stageOf(leadId)).stageId).toBe(viewing.id);
  });
});
