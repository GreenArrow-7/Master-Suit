import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Deliveries screen reads its session the way Next serves it.
const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { PUT as connect, PATCH as saveMap } from '@/app/api/v1/integrations/[provider]/route';
import { GET as list, POST as replay } from '@/app/api/v1/integrations/[provider]/deliveries/route';
import DeliveriesPage from '@/app/(workspace)/[workspaceSlug]/admin/lead-sources/[provider]/page';
import { deliver, leadEagleWorkspace, sign, work } from '../helpers/leadSource';
import {
  BAYUT,
  DUBIZZLE,
  forwardedByAgent,
  MENTIONS_A_PORTAL,
  NOT_A_PORTAL,
  PORTAL_NOTICE,
  PROPERTY_FINDER,
  type InboundMail,
} from '../helpers/portalEmails';
import { pageText } from '../helpers/render';
import { get, patch, post } from '../helpers/request';

/**
 * Portal notification emails as a lead source (audit row M6-12): the
 * workspace's mail service posts each email it receives, as provider-neutral
 * JSON signed like a Custom webhook, and a Property Finder, Bayut or dubizzle
 * lead email becomes a lead with that portal as its source. Anything else is
 * stored and kept unread, listed on Deliveries.
 */
const PROVIDER = 'inbound_email';
let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let secret = '';
let key = '';

const send = (mail: InboundMail | Record<string, unknown>, headers: Record<string, string> = {}) => {
  const text = JSON.stringify(mail);
  return deliver(key, text, { 'x-signature': sign(secret, text), ...headers });
};
const leadBy = (phoneNormalized: string) =>
  prisma.lead.findFirstOrThrow({ where: { tenantId: ws.tenantId, phoneNormalized } });
const eventFor = (mail: InboundMail) =>
  prisma.webhookEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, externalId: mail.messageId } });
const entry = (sourceKey: string) =>
  prisma.leadSource.findFirstOrThrow({ where: { tenantId: ws.tenantId, key: sourceKey } });

beforeAll(async () => {
  ws = await leadEagleWorkspace('portal-mail', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
    ['leads', 'VIEW'],
  ]);
});

afterAll(async () => {
  await ws.cleanup();
});

describe('portal emails as a lead source', () => {
  it('connects from Integrations with a signing secret the workspace issues', async () => {
    const res = await connect(
      new Request(`http://localhost/api/v1/integrations/${PROVIDER}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: ws.cookie },
        body: '{}',
      }),
      { params: Promise.resolve({ provider: PROVIDER }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('CONNECTED');
    expect(body.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    secret = body.signingSecret;
    key = body.webhookKey;
  });

  it('makes a Property Finder lead email a Marketplace lead on the Property Finder entry', async () => {
    expect((await send(PROPERTY_FINDER)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971500001201');
    expect(lead).toMatchObject({
      fullName: 'Aisha Rahman',
      email: 'aisha.rahman@example.com',
      source: 'MARKETPLACE',
      sourceDetail: 'property_finder:PF-MG-20451',
      sourceId: (await entry('property_finder')).id,
      consentStatus: 'IMPLIED',
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Enquiry via Property Finder email');
    expect(note.notes).toContain('Ref: PF-MG-20451');
    // The message runs over two lines after its label.
    expect(note.notes).toContain('Hello, is this apartment still available? I would like to arrange a viewing');
    expect(
      await prisma.auditLog.count({
        where: { tenantId: ws.tenantId, objectType: 'lead', recordId: lead.id, event: 'RECORD_CREATED' },
      }),
    ).toBe(1);
    expect(await eventFor(PROPERTY_FINDER)).toMatchObject({ processed: true, outcome: 'created', leadId: lead.id });
  });

  it('reads a Bayut email as Bayut’s, though its footer names dubizzle', async () => {
    expect((await send(BAYUT)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971550003302');
    expect(lead).toMatchObject({
      fullName: 'Omar Haddad',
      email: 'omar.haddad@example.com',
      source: 'MARKETPLACE',
      sourceDetail: 'bayut:BY-88213',
      sourceId: (await entry('bayut')).id,
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Enquiry via Bayut email');
    expect(note.notes).toContain("Is the villa still available? I'd like to arrange a viewing.");
  });

  it('reads a dubizzle email sent as HTML only', async () => {
    expect((await send(DUBIZZLE)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971520004403');
    expect(lead).toMatchObject({
      fullName: 'Priya Nair',
      email: 'priya.nair@example.com',
      source: 'MARKETPLACE',
      sourceDetail: 'dubizzle:DZ-7764123',
      sourceId: (await entry('dubizzle')).id,
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Hi, is this still available to rent from November? Thanks & regards');
    expect(note.notes).not.toContain('<');
  });

  it('refuses a wrong signature and stores nothing', async () => {
    const text = JSON.stringify({ ...BAYUT, messageId: '<forged@example.com>' });
    const res = await deliver(key, text, { 'x-signature': sign('not-the-secret', text) });
    expect(res.status).toBe(401);
    expect(
      await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId, externalId: '<forged@example.com>' } }),
    ).toBe(0);
  });

  it('takes one email once: the same messageId again makes nothing, whatever else changed', async () => {
    // A mail service that retries, or forwards the same email twice, with a body that differs.
    const again = { ...PROPERTY_FINDER, text: `${PROPERTY_FINDER.text}\n`, to: 'other@agency-inbox.example.com' };
    expect((await send(again)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971500001201');
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId, phoneNormalized: '+971500001201' } })).toBe(1);
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead.id } })).toBe(1);
    expect(
      await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId, externalId: PROPERTY_FINDER.messageId } }),
    ).toBe(1);
  });

  it('answers an Idempotency-Key retry 200 and makes nothing new', async () => {
    const mail = {
      ...BAYUT,
      messageId: '<by-retry@notifications.bayut.com>',
      text: BAYUT.text!.replace('3302', '3309').replace('omar.haddad@', 'o.haddad@'),
    };
    for (let i = 0; i < 2; i++) expect((await send(mail, { 'idempotency-key': 'mail-retry-1' })).status).toBe(200);
    await work(ws.tenantId, PROVIDER);
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId, phoneNormalized: '+971550003309' } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId, externalId: mail.messageId } })).toBe(1);
  });

  it('takes one email once under two keys, though the bodies differ', async () => {
    const mail = {
      ...BAYUT,
      messageId: '<by-two-keys@notifications.bayut.com>',
      text: BAYUT.text!.replace('3302', '3318').replace('omar.haddad@', 'o.h18@'),
    };
    expect((await send(mail, { 'idempotency-key': 'mail-key-a' })).status).toBe(200);
    expect(
      (await send({ ...mail, to: 'other@agency-inbox.example.com' }, { 'idempotency-key': 'mail-key-b' })).status,
    ).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971550003318');
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead.id } })).toBe(1);
    expect(
      await prisma.webhookEvent.count({
        where: { tenantId: ws.tenantId, externalId: { in: [mail.messageId, 'mail-key-a', 'mail-key-b'] } },
      }),
    ).toBe(1);
  });

  it('keeps an email from no known portal unread, and makes no lead of it', async () => {
    const before = await prisma.lead.count({ where: { tenantId: ws.tenantId } });
    expect((await send(NOT_A_PORTAL)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(await eventFor(NOT_A_PORTAL)).toMatchObject({ processed: true, outcome: 'unparsed', leadId: null });
  });

  it('keeps a portal email that names nobody to contact unread too', async () => {
    const before = await prisma.lead.count({ where: { tenantId: ws.tenantId } });
    expect((await send(PORTAL_NOTICE)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(await eventFor(PORTAL_NOTICE)).toMatchObject({ processed: true, outcome: 'unparsed' });
  });

  it('lists the unread ones on Deliveries as unread', async () => {
    const res = await get(list, `/api/v1/integrations/${PROVIDER}/deliveries`, ws.cookie, { provider: PROVIDER });
    expect(res.status).toBe(200);
    const unread = (res.body.deliveries as { id: string; status: string }[]).filter((d) => d.status === 'unparsed');
    expect(unread).toHaveLength(2);

    cookieJar.value = ws.cookie;
    const text = await pageText(
      DeliveriesPage({
        params: Promise.resolve({ workspaceSlug: ws.slug, provider: PROVIDER }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(text).toContain('Portal emails');
    expect(text).toContain('Not read: unknown email');
  });

  it('reads a label the parser does not know once the field mapping names it, on replay', async () => {
    const mail: InboundMail = {
      ...BAYUT,
      messageId: '<by-new-layout@notifications.bayut.com>',
      text: ['New enquiry on Bayut', 'Client Name : Yusuf Karimi', 'Customer Contact : 055 000 3315'].join('\n'),
    };
    expect((await send(mail)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);
    const stored = await eventFor(mail);
    expect(stored.outcome).toBe('unparsed');

    const mapped = await patch(
      saveMap,
      `/api/v1/integrations/${PROVIDER}`,
      { fieldMap: { 'Customer Contact': 'phone' } },
      ws.cookie,
      { provider: PROVIDER },
    );
    expect(mapped.status).toBe(200);
    const replayed = await post(replay, `/api/v1/integrations/${PROVIDER}/deliveries`, { id: stored.id }, ws.cookie, {
      provider: PROVIDER,
    });
    expect(replayed.status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    const lead = await leadBy('+971550003315');
    expect(lead).toMatchObject({ fullName: 'Yusuf Karimi', sourceDetail: 'bayut' });
    expect(await eventFor(mail)).toMatchObject({ outcome: 'created', leadId: lead.id });
  });

  it('makes two leads of two clients an agent forwarded under one signature, neither with the agent’s numbers', async () => {
    const first = forwardedByAgent({
      name: 'Hamad Saeed',
      phone: '+971 50 000 1230',
      email: 'hamad.saeed@example.com',
      ref: 'PF-JV-30112',
    });
    const second = forwardedByAgent({
      name: 'Rania Aziz',
      phone: '+971 50 000 1231',
      email: 'rania.aziz@example.com',
      ref: 'PF-JV-30113',
    });
    for (const mail of [first, second]) expect((await send(mail)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    expect(await leadBy('+971500001230')).toMatchObject({
      fullName: 'Hamad Saeed',
      sourceDetail: 'property_finder:PF-JV-30112',
    });
    expect(await leadBy('+971500001231')).toMatchObject({
      fullName: 'Rania Aziz',
      sourceDetail: 'property_finder:PF-JV-30113',
    });
    const agents = ['+971550009901', '+97140009900'];
    expect(
      await prisma.lead.count({
        where: {
          tenantId: ws.tenantId,
          OR: [{ phoneNormalized: { in: agents } }, { phones: { some: { normalized: { in: agents } } } }],
        },
      }),
    ).toBe(0);
  });

  it('keeps an email that names a portal only in its body unread', async () => {
    const before = await prisma.lead.count({ where: { tenantId: ws.tenantId } });
    expect((await send(MENTIONS_A_PORTAL)).status).toBe(200);
    await work(ws.tenantId, PROVIDER);

    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(await eventFor(MENTIONS_A_PORTAL)).toMatchObject({ processed: true, outcome: 'unparsed' });
  });
});
