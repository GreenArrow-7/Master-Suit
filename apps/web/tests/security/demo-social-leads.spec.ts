/**
 * Demo leads go through the real pipeline, and only in a demo workspace.
 *
 * The point of a demo connector is not to put a row on a screen — that would
 * prove nothing. It is to exercise deduplication, routing, attribution,
 * assignment and the automation trigger, so that connecting Meta later leaves
 * only the Graph call untested.
 *
 * These assertions therefore check the *consequences* of ingestion, not that a
 * lead exists: the CRM source, the attribution, the idempotency claim, and the
 * merge onto an existing customer. Plus the gate, which is the security half.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateDemoLead, demoLeadStatus } from '@/services/leads/providers/demoSocialLeads';

const suffix = randomBytes(4).toString('hex');
let demoTenantId = '';
let realTenantId = '';

async function workspace(slug: string, isDemo: boolean) {
  const tenant = await prisma.tenant.create({
    data: { slug: `${slug}-${suffix}`, legalName: `${slug} LLC`, displayName: slug, isDemo },
  });
  await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: 'SALES', state: 'ACTIVE' } });
  // Ingestion needs somewhere to put a new lead.
  await prisma.leadStage.create({
    data: { tenantId: tenant.id, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  return tenant.id;
}

beforeAll(async () => {
  demoTenantId = await workspace('demo-ws', true);
  realTenantId = await workspace('real-ws', false);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { endsWith: suffix } } }).catch(() => {});
});

describe('demo social lead connector', () => {
  it('refuses a workspace that is not marked as a demo', async () => {
    // §26/§45: the demo endpoint must never become a lead-injection endpoint
    // aimed at a real customer's CRM.
    await expect(generateDemoLead(realTenantId, { source: 'FACEBOOK' })).rejects.toMatchObject({ status: 403 });
    expect(await prisma.lead.count({ where: { tenantId: realTenantId } })).toBe(0);
  });

  it('reports demo mode rather than "connected"', async () => {
    const demo = await demoLeadStatus(demoTenantId);
    expect(demo.state, 'never claims a provider is connected').toBe('DEMO_MODE');
    expect(demo.enabled).toBe(true);
    expect(demo.sources.map((s) => s.key)).toEqual(['FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'WHATSAPP']);

    const real = await demoLeadStatus(realTenantId);
    expect(real.state).toBe('UNAVAILABLE');
    expect(real.enabled).toBe(false);
  });

  it('creates a real CRM lead through the shared ingestion path', async () => {
    const result = await generateDemoLead(demoTenantId, { source: 'FACEBOOK' });
    expect('leadId' in result && result.created, JSON.stringify(result)).toBe(true);
    const leadId = (result as { leadId: string }).leadId;

    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId: demoTenantId } });

    // The CRM's own vocabulary, not a catch-all: a demo Facebook lead is an
    // AD_LEAD_FORM exactly like a real one, so the reports read it the same way.
    expect(lead.source).toBe('AD_LEAD_FORM');
    expect(lead.sourceDetail).toBe('demo:facebook');
    // Ingestion normalised the phone — that step ran, it was not bypassed.
    expect(lead.phoneNormalized, 'the phone went through normalisation').toMatch(/^\+9715\d{8}$/);
    expect(lead.reference, 'a tenant reference was allocated').toBeTruthy();
    expect(lead.stageId, 'placed in the default stage').toBeTruthy();
    expect(lead.consentStatus).toBe('IMPLIED');

    // And it is labelled as simulated rather than passed off as real traffic.
    const attribution = (lead.customData as Record<string, any>).demoLead;
    expect(attribution.simulated).toBe(true);
    expect(attribution.demoSource).toBe('FACEBOOK');
  });

  it('claims the provider event, so a replay makes no second lead', async () => {
    const externalLeadId = `replay-${suffix}`;
    const first = await generateDemoLead(demoTenantId, { source: 'INSTAGRAM', externalLeadId });
    expect('leadId' in first && first.created).toBe(true);

    // The same provider event delivered again — a webhook retry, in real life.
    const second = await generateDemoLead(demoTenantId, { source: 'INSTAGRAM', externalLeadId });
    expect(second, 'the replay is refused by the idempotency claim').toEqual({ skipped: 'duplicate-event' });

    const claims = await prisma.webhookEvent.count({
      where: { tenantId: demoTenantId, provider: 'demo:INSTAGRAM', externalId: externalLeadId },
    });
    expect(claims, 'exactly one claim row').toBe(1);
  });

  it('merges onto an existing customer instead of duplicating them', async () => {
    // Deduplication is one of the things a demo lead exists to exercise.
    const first = await generateDemoLead(demoTenantId, { source: 'WEBSITE' });
    const leadId = (first as { leadId: string }).leadId;
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId: demoTenantId } });

    const before = await prisma.lead.count({ where: { tenantId: demoTenantId } });

    // A second event from the same person on a different channel.
    const { ingestProviderLead } = await import('@/services/leads/ingestProviderLead');
    const again = await ingestProviderLead({
      tenantId: demoTenantId,
      provider: 'demo:WHATSAPP',
      externalLeadId: `merge-${suffix}`,
      occurredAt: new Date(),
      identity: { fullName: lead.fullName, email: lead.email, phone: lead.phone },
      source: 'CHAT',
      sourceDetail: 'demo:whatsapp',
      attribution: { simulated: true, demoSource: 'WHATSAPP' },
      attributionKey: 'demoLead',
    });

    expect('leadId' in again && again.created, 'attached to the existing customer').toBe(false);
    expect((again as { leadId: string }).leadId).toBe(leadId);
    expect(await prisma.lead.count({ where: { tenantId: demoTenantId } })).toBe(before);

    // First contact is not rewritten by a later touch.
    const after = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId: demoTenantId } });
    expect(after.source, 'still the channel they first arrived on').toBe('PUBLIC_FORM');
    expect(after.sourceDetail).toBe('demo:website');
  });

  it('keeps every demo lead inside its own workspace', async () => {
    expect(await prisma.lead.count({ where: { tenantId: realTenantId } })).toBe(0);
  });
});
