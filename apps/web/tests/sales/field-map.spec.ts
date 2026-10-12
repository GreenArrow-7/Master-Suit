import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { parseEnquiry } from '@/lib/integrations/leadSources';
import { PATCH as saveMap } from '@/app/api/v1/integrations/[provider]/route';
import { POST as replay } from '@/app/api/v1/integrations/[provider]/deliveries/route';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { patch, post } from '../helpers/request';
import { deliver, leadEagleWorkspace, sign, work } from '../helpers/leadSource';
import { createSessionToken } from '../helpers/session';

/**
 * A field mapping per lead source (audit row M6-20): an administrator names
 * which of a sender's fields is the lead's name, number or budget, and the map
 * is applied before the enquiry is read, so replaying a delivery that was read
 * wrongly yields the lead it should have been.
 */
const SECRET = 'field-map-signing-secret';
let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let hrOnly: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let key = '';
/** integrations:VIEW only. */
let viewerCookie = '';
const number = `05${String(Date.now()).slice(-8)}`;

beforeAll(async () => {
  ws = await leadEagleWorkspace('field-map', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);
  key = (
    await prisma.integrationConnection.create({
      data: {
        tenantId: ws.tenantId,
        provider: 'custom_webhook',
        status: 'CONNECTED',
        credentials: wrapCredentials({ secret: SECRET }),
      },
    })
  ).webhookKey;

  const role = await prisma.role.create({
    data: { tenantId: ws.tenantId, key: 'map-viewer', name: 'Viewer', rank: 50, defaultScope: 'OWN' },
  });
  await grantPermissions(ws.tenantId, role.id, [['integrations', 'VIEW']]);
  const viewer = await createWorkspaceUser({
    tenantId: ws.tenantId,
    roleId: role.id,
    email: `viewer@${ws.slug}.test`,
    fullName: 'Map Viewer',
  });
  viewerCookie = await createSessionToken(ws.tenantId, viewer.id);

  hrOnly = await leadEagleWorkspace('field-map-hr', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);
  await prisma.moduleEntitlement.updateMany({ where: { tenantId: hrOnly.tenantId }, data: { module: 'HRMS' } });
  await prisma.integrationConnection.create({
    data: { tenantId: hrOnly.tenantId, provider: 'custom_webhook', status: 'CONNECTED' },
  });
});

afterAll(async () => {
  await ws.cleanup();
  await hrOnly.cleanup();
});

const saveFieldMap = (fieldMap: Record<string, string>, provider = 'custom_webhook', cookie = ws.cookie) =>
  patch(saveMap, `/api/v1/integrations/${provider}`, { fieldMap }, cookie, { provider });

describe('the field map', () => {
  it('reads a mapped sender field as the lead field, at any depth, over the parser’s own guess', () => {
    const payload = {
      customer: { full: 'Lina Farah', mobile_no: '050 765 4321' },
      name: 'Website',
      budget_aed: '2.5M',
    };
    const plain = parseEnquiry(payload);
    expect(plain.phones).toEqual([]);
    expect(plain.fullName).toBe('Website');

    const mapped = parseEnquiry(payload, { 'customer.full': 'fullName', 'Mobile No': 'phone', budget_aed: 'budget' });
    expect(mapped.fullName).toBe('Lina Farah');
    expect(mapped.phones).toEqual(['050 765 4321']);
    expect(mapped.details).toContain('Budget: 2.5M');
  });

  it('reads a mapped name or number only from the mapped field, whatever else the body carries', () => {
    const payload = {
      form: { name: 'Spring Campaign' },
      fname: 'Lina',
      lname: 'Farah',
      phone: '044001122',
      customer_mobile: '0501234567',
      data: { customer: { contact_mail: 'Lina@Example.com' } },
    };
    const mapped = parseEnquiry(payload, {
      fname: 'firstName',
      lname: 'lastName',
      customer_mobile: 'phone',
      'data.customer.contact_mail': 'email',
    });
    // Not the form's name, and not the office number beside the client's.
    expect(mapped.fullName).toBe('Lina Farah');
    expect(mapped.phones).toEqual(['0501234567']);
    expect(mapped.email).toBe('lina@example.com');
  });

  it('is saved on the connection by an administrator, and refuses a field it cannot map to', async () => {
    const saved = await saveFieldMap({ customer: 'fullName', mobile_no: 'phone' });
    expect(saved.status).toBe(200);
    expect(saved.body.fieldMap).toEqual({ customer: 'fullName', mobile_no: 'phone' });
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { webhookKey: key } });
    expect((row.metadata as { fieldMap?: unknown }).fieldMap).toEqual({ customer: 'fullName', mobile_no: 'phone' });
    // The map decides which lead a delivery joins, so the record says what it was and what it became.
    const trail = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: ws.tenantId, event: 'INTEGRATION_MODIFIED', recordId: row.id },
    });
    expect(trail).toMatchObject({
      actorUserId: ws.userId,
      previousValue: { fieldMap: {} },
      newValue: { fieldMap: { customer: 'fullName', mobile_no: 'phone' } },
    });

    expect((await saveFieldMap({ owner: 'ownerId' })).status).toBe(422);
    // Not a lead source, and a lead source this workspace has not connected.
    expect((await saveFieldMap({ a: 'phone' }, 'twilio')).status).toBe(404);
    expect((await saveFieldMap({ a: 'phone' }, 'bayut')).status).toBe(404);
    // Reading integrations is not configuring them, and a workspace without a lead product has no lead sources.
    expect((await saveFieldMap({ a: 'phone' }, 'custom_webhook', viewerCookie)).status).toBe(403);
    expect((await saveFieldMap({ a: 'phone' }, 'custom_webhook', hrOnly.cookie)).status).toBe(403);
    await saveFieldMap({});
  });

  it('is used when a stored delivery is replayed, so a misread one becomes the right lead', async () => {
    const text = JSON.stringify({ customer: 'Omar Nasser', mobile_no: number, note: 'Villa please' });
    expect((await deliver(key, text, { 'x-signature': sign(SECRET, text) })).status).toBe(200);
    const stored = await work(ws.tenantId, 'custom_webhook');
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, provider: stored } });
    // Read without a map, it names nobody the parser recognises.
    expect(event).toMatchObject({ processed: true, outcome: 'anonymous', leadId: null });
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(0);

    expect((await saveFieldMap({ customer: 'fullName', mobile_no: 'phone', note: 'message' })).status).toBe(200);
    const res = await post(replay, '/api/v1/integrations/custom_webhook/deliveries', { id: event.id }, ws.cookie, {
      provider: 'custom_webhook',
    });
    expect(res.status).toBe(200);
    await work(ws.tenantId, 'custom_webhook');

    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: ws.tenantId, phoneNormalized: `+971${number.slice(1)}` },
    });
    expect(lead.fullName).toBe('Omar Nasser');
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead.id } });
    expect(note.notes).toContain('Villa please');
    expect(
      await prisma.webhookEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, id: event.id } }),
    ).toMatchObject({
      processed: true,
      outcome: 'created',
      leadId: lead.id,
    });
  });
});
