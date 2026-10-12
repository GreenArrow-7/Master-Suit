import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { runReport } from '@/services/leadership/reports';
import { buildActor, buildCtx } from '../helpers/ctx';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { post } from '../helpers/request';

/**
 * Referral as a lead source (audit row M6-15): a Lead-Eagle-only workspace
 * records who referred a lead, and the source reports show Referral beside the
 * portals and forms.
 */
let fixture: Fixture;
let tenantId: string;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  // Lead Eagle instead of Sales: the product the row is for.
  await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await invalidateEntitlements(tenantId);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('Referral as a lead source', () => {
  it('records who referred the lead', async () => {
    const res = await post(
      createLead,
      '/api/v1/leads',
      { fullName: 'Referred Buyer', phone: '0501112233', source: 'REFERRAL', sourceDetail: 'Ahmed Al Mansoori' },
      fixture.a.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: res.body.id } });
    expect(lead).toMatchObject({ source: 'REFERRAL', sourceDetail: 'Ahmed Al Mansoori' });
  });

  it('refuses a referral that names nobody', async () => {
    const res = await post(
      createLead,
      '/api/v1/leads',
      { fullName: 'Nobody Referred', source: 'REFERRAL' },
      fixture.a.cookie,
    );
    expect(res.status).toBe(422);
    expect(await prisma.lead.count({ where: { tenantId, fullName: 'Nobody Referred' } })).toBe(0);
  });

  it('shows Referral in the source reports', async () => {
    // A referrer typed like a portal's key stays a referral; a detail named like
    // an object's own property is no label at all.
    for (const [phone, source, sourceDetail] of [
      ['0501112234', 'REFERRAL', 'bayut'],
      ['0501112235', 'MANUAL', '__proto__'],
    ]) {
      const res = await post(
        createLead,
        '/api/v1/leads',
        { fullName: `Odd detail ${sourceDetail}`, phone, source, sourceDetail },
        fixture.a.cookie,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const ctx = buildCtx(buildActor({ id: fixture.a.userId, tenantId, grants: [['reports', 'VIEW']] }));
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const toBooking = await runReport(ctx, 'source-to-booking', range);
    expect(toBooking.rows.find((r) => r.source === 'Referral')).toMatchObject({ leads: 2, bookings: 0 });
    expect(toBooking.rows.find((r) => r.source === 'Bayut')).toBeUndefined();
    expect(toBooking.rows.map((r) => typeof r.source)).toEqual(toBooking.rows.map(() => 'string'));
    const analysis = await runReport(ctx, 'source-analysis', range);
    expect(analysis.rows.find((r) => r.source === 'referral')).toMatchObject({ leads: 2 });
  });
});
