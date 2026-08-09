/**
 * The campaign lifecycle sweep — what the campaign worker runs once a minute.
 *
 * Matrix: a due WhatsApp campaign with a template sends and starts; one with
 * no template pauses honestly instead of sitting due forever; one whose
 * workspace never connected WhatsApp pauses too; a due VOICE campaign starts
 * without sending anything; a RUNNING campaign past its end date completes;
 * and a campaign scheduled for tomorrow is left alone.
 *
 * The provider factory is mocked to the ship-with mock provider so nothing
 * reaches Meta; everything else — credentials, consent gating, Communication
 * evidence, status transitions — is the real pipeline against real rows.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations/whatsapp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/whatsapp')>();
  return { ...actual, getWhatsAppProvider: () => new actual.MockWhatsAppProvider() };
});

import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { sweepDueCampaigns } from '@/services/campaigns/scheduler';

const suffix = randomBytes(4).toString('hex');
const past = new Date(Date.now() - 3_600_000);
const future = new Date(Date.now() + 86_400_000);

let tenantId = '';
let bareTenantId = '';
const ids: Record<string, string> = {};
const tenantOf: Record<string, string> = {};

async function campaign(
  tenant: string,
  key: string,
  data: Partial<Parameters<typeof prisma.campaign.create>[0]['data']>,
) {
  const row = await prisma.campaign.create({
    data: {
      tenantId: tenant,
      name: `${key} ${suffix}`,
      code: `${key.toUpperCase()}-${suffix}`,
      campaignType: 'OUTBOUND',
      channel: 'WHATSAPP',
      status: 'SCHEDULED',
      startDate: past,
      ...data,
    } as Parameters<typeof prisma.campaign.create>[0]['data'],
  });
  ids[key] = row.id;
  tenantOf[key] = tenant;
  return row;
}

const statusOf = (key: string) =>
  prisma.campaign.findFirstOrThrow({ where: { id: ids[key], tenantId: tenantOf[key] } }).then((c) => c.status);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `sched-${suffix}`, legalName: 'Sched LLC', displayName: 'Sched', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const bare = await prisma.tenant.create({
    data: { slug: `schedbare-${suffix}`, legalName: 'SchedBare LLC', displayName: 'SchedBare', status: 'ACTIVE' },
  });
  bareTenantId = bare.id;

  // WhatsApp is CONNECTED for the first tenant only.
  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'meta',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accessToken: `token-${suffix}`, phoneNumberId: '1234567890' }),
    },
  });

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
  });

  await campaign(tenantId, 'ready', { customData: { whatsappTemplate: 'promo_v1', whatsappLanguage: 'en' } });
  await campaign(tenantId, 'templateless', {});
  await campaign(tenantId, 'voice', { channel: 'VOICE' });
  await campaign(tenantId, 'finished', { status: 'RUNNING', endDate: past });
  await campaign(tenantId, 'tomorrow', {
    startDate: future,
    customData: { whatsappTemplate: 'promo_v1' },
  });
  await campaign(bareTenantId, 'disconnected', { customData: { whatsappTemplate: 'promo_v1' } });

  // Two consented, reachable leads on the ready campaign; one lead whose
  // consent was withdrawn, to prove the gate holds under the scheduler too.
  await prisma.lead.createMany({
    data: [
      {
        tenantId,
        reference: `SC-${suffix}-1`,
        fullName: 'Consenting One',
        stageId: stage.id,
        phone: '+971501110001',
        consentStatus: 'GRANTED',
        campaignId: ids.ready,
      },
      {
        tenantId,
        reference: `SC-${suffix}-2`,
        fullName: 'Consenting Two',
        stageId: stage.id,
        phone: '+971501110002',
        consentStatus: 'IMPLIED',
        campaignId: ids.ready,
      },
      {
        tenantId,
        reference: `SC-${suffix}-3`,
        fullName: 'Withdrawn Three',
        stageId: stage.id,
        phone: '+971501110003',
        consentStatus: 'WITHDRAWN',
        campaignId: ids.ready,
      },
    ],
  });
});

afterAll(async () => {
  for (const id of [tenantId, bareTenantId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
});

describe('sweepDueCampaigns', () => {
  it('runs the whole lifecycle in one sweep', async () => {
    const summary = await sweepDueCampaigns();

    // ready: sent to the two consented leads, never the withdrawn one.
    expect(await statusOf('ready')).toBe('RUNNING');
    const comms = await prisma.communication.findMany({
      where: { tenantId, campaignId: ids.ready },
      select: { status: true, toAddress: true, body: true, createdById: true },
    });
    expect(comms.length).toBe(2);
    expect(comms.every((c) => c.status === 'SENT' && c.body === 'template:promo_v1')).toBe(true);
    expect(comms.map((c) => c.toAddress).sort()).toEqual(['+971501110001', '+971501110002']);
    // The scheduler pressed the button, not a person.
    expect(comms.every((c) => c.createdById === null)).toBe(true);

    // templateless: an honest "did not start", not a silent forever-due row.
    expect(await statusOf('templateless')).toBe('PAUSED');

    // disconnected workspace: same honesty.
    expect(await statusOf('disconnected')).toBe('PAUSED');

    // voice: started for the dialer to work; nothing sent.
    expect(await statusOf('voice')).toBe('RUNNING');
    expect(await prisma.communication.count({ where: { tenantId, campaignId: ids.voice } })).toBe(0);

    // finished: closed out.
    expect(await statusOf('finished')).toBe('COMPLETED');

    // tomorrow: untouched.
    expect(await statusOf('tomorrow')).toBe('SCHEDULED');

    expect(summary.started).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.paused).toBe(2);
    expect(summary.completed).toBe(1);
  });

  it('is idempotent: a second sweep sends nothing twice', async () => {
    const summary = await sweepDueCampaigns();
    expect(summary.sent).toBe(0);
    expect(summary.started).toBe(0);
    expect(await prisma.communication.count({ where: { tenantId, campaignId: ids.ready } })).toBe(2);
  });
});
