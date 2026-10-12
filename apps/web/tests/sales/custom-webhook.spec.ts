import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as board } from '@/app/api/v1/integrations/route';
import { PUT as connect } from '@/app/api/v1/integrations/[provider]/route';
import { get } from '../helpers/request';
import { deliver, leadEagleWorkspace, sign, work } from '../helpers/leadSource';

/**
 * A "Custom webhook" lead source (audit row M6-08): any sender without an
 * adapter of its own posts JSON to the connection's URL, signed with a secret
 * the workspace issued, and a retry carrying the same Idempotency-Key makes
 * nothing new and is still answered 200.
 */
let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let secret = '';
let key = '';
const phone = () => `05${String(Date.now()).slice(-8)}`;

const put = async (body: Record<string, unknown>) => {
  const res = await connect(
    new Request('http://localhost/api/v1/integrations/custom_webhook', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: ws.cookie },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider: 'custom_webhook' }) },
  );
  return { status: res.status, body: await res.json() };
};

const signed = (body: unknown, idempotencyKey?: string) => {
  const text = JSON.stringify(body);
  return deliver(key, text, {
    'x-signature': sign(secret, text),
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  });
};

beforeAll(async () => {
  ws = await leadEagleWorkspace('custom-hook', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);
});

afterAll(async () => {
  await ws.cleanup();
});

describe('a Custom webhook lead source', () => {
  it('is connected from Integrations with a signing secret the workspace issues, shown once', async () => {
    const first = await put({});
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('CONNECTED');
    expect(first.body.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    secret = first.body.signingSecret;
    key = first.body.webhookKey;

    // Stored wrapped, like every other credential, and never handed out again.
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { webhookKey: key } });
    expect(JSON.stringify(row.credentials)).not.toContain(secret);
    const again = await put({});
    expect(again.status).toBe(200);
    expect(again.body.signingSecret).toBeUndefined();
    const listed = await get(board, '/api/v1/integrations', ws.cookie);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    const card = listed.body.providers.find((p: { key: string }) => p.key === 'custom_webhook');
    expect(card).toMatchObject({ label: 'Custom webhook', category: 'LEADS', status: 'CONNECTED' });
    expect(card.webhookUrl).toContain(`/api/v1/webhooks/leads/${key}`);
  });

  it('turns a signed body in the documented shape into a lead', async () => {
    const number = phone();
    const res = await signed({
      name: 'Rania Haddad',
      phone: number,
      email: 'Rania@Example.com',
      message: 'Two-bed in JVC, ready to move',
      source_detail: 'spring-campaign',
    });
    expect(res.status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');

    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: ws.tenantId, phoneNormalized: `+971${number.slice(1)}` },
    });
    expect(lead).toMatchObject({
      fullName: 'Rania Haddad',
      email: 'rania@example.com',
      source: 'WEBHOOK',
      sourceDetail: 'custom_webhook:spring-campaign',
      consentStatus: 'IMPLIED',
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Enquiry via Custom webhook');
    expect(note.notes).toContain('Two-bed in JVC, ready to move');
  });

  it('reads first_name and last_name when the body has no name', async () => {
    const number = phone();
    expect((await signed({ first_name: 'Hala', last_name: 'Mansour', phone: number })).status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: ws.tenantId, phoneNormalized: `+971${number.slice(1)}` },
    });
    expect(lead.fullName).toBe('Hala Mansour');
  });

  it('answers a retry with the same Idempotency-Key 200 and makes nothing new', async () => {
    const number = phone();
    const body = { name: 'Sami Aziz', phone: number };
    const idempotencyKey = `retry-${number}`;
    expect((await signed(body, idempotencyKey)).status).toBe(200);
    // Retried before the worker has run, and again after.
    expect((await signed(body, idempotencyKey)).status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');
    expect((await signed(body, idempotencyKey)).status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');

    expect(await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId, externalId: idempotencyKey } })).toBe(1);
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId, fullName: 'Sami Aziz' } })).toBe(1);
  });

  it('refuses a key reused for a different body, so the second enquiry is not lost behind a 200', async () => {
    const number = phone();
    const idempotencyKey = `static-${number}`;
    expect((await signed({ name: 'Nour Saleh', phone: number }, idempotencyKey)).status).toBe(200);
    const second = await signed({ name: 'Karim Saleh', phone: phone() + '9' }, idempotencyKey);
    expect(second.status).toBe(409);
    expect(await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId, externalId: idempotencyKey } })).toBe(1);
  });

  it('takes a signed body once, whatever key it is resent under', async () => {
    const number = phone();
    const body = { name: 'Rami Khoury', phone: number };
    expect((await signed(body, `first-${number}`)).status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');
    const before = await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId } });
    // Somebody who captured the delivery cannot sign another body, but can mint keys.
    expect((await signed(body, `second-${number}`)).status).toBe(200);
    expect((await signed(body, `third-${number}`)).status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    await work(ws.tenantId, 'custom_webhook');
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: ws.tenantId, phoneNormalized: `+971${number.slice(1)}` },
    });
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead.id } })).toBe(1);
  });

  it('refuses a body signed with anything else, and stores nothing', async () => {
    const before = await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId } });
    const text = JSON.stringify({ name: 'Forged', phone: phone() });
    expect((await deliver(key, text, { 'x-signature': sign('not-the-secret', text) })).status).toBe(401);
    expect((await deliver(key, text)).status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { tenantId: ws.tenantId } })).toBe(before);
  });
});
