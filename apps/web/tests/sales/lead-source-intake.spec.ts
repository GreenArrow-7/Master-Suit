import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { POST as receive } from '@/app/api/v1/webhooks/leads/[key]/route';
import { handleJob } from '@/workers/jobs';
import { updateLead } from '@/services/leads/updateLead';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { DELETE as removePhone, POST as addPhone } from '@/app/api/v1/leads/[id]/phones/route';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { whatsappLink } from '@/components/workspace/CallLink';
import { del, patch, post } from '../helpers/request';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * Property portal and Google Ads enquiries, through the real receiver, the real
 * signature check and the registered worker job, against the database.
 *
 * No portal has delivered to this application yet — they deliver to approved
 * partners only — so the bodies are in the shapes Lead Eagle's adapters were
 * written for, and the field names Google documents for lead form webhooks.
 */
const SECRET = 'pf-signing-secret-for-intake-test';
const GOOGLE_KEY = 'google-key-for-intake-test';

let fixture: Fixture;
let tenantId: string;
let pfKey: string;
let googleKey: string;
let noteTypeId: string;

const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;

async function deliver(key: string, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  const res = await receive(
    new Request(`http://localhost/api/v1/webhooks/leads/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: text,
    }),
    { params: Promise.resolve({ key }) },
  );
  return { status: res.status, text };
}

/** What the queue would run: every stored, unworked delivery for the connection, through the registered job. */
async function work(key: string) {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({ where: { webhookKey: key } });
  const provider = `${connection.provider}:${connection.id}`;
  const events = await prisma.webhookEvent.findMany({ where: { tenantId, provider, processed: false } });
  for (const event of events) {
    await handleJob('webhook', {
      name: 'lead-source.enquiry',
      data: { tenantId, provider, externalId: event.externalId, source: connection.provider },
    });
  }
}

const leadByPhone = (phoneNormalized: string) =>
  prisma.lead.findMany({ where: { tenantId, phoneNormalized }, include: { phones: true } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  noteTypeId = (await prisma.activityType.create({ data: { tenantId, key: 'note', name: 'Note' } })).id;
  pfKey = (
    await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'property_finder',
        status: 'CONNECTED',
        credentials: wrapCredentials({ secret: SECRET }),
      },
    })
  ).webhookKey;
  googleKey = (
    await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'google_ads',
        status: 'CONNECTED',
        credentials: wrapCredentials({ secret: GOOGLE_KEY }),
      },
    })
  ).webhookKey;
});

afterAll(async () => {
  await fixture.cleanup();
});

const pfEnquiry = {
  event: 'lead.created',
  data: {
    lead_id: 'pf-1001',
    listing: { listing_reference: 'PF-MARINA-22' },
    client: { name: 'Huda Rahman', phone: '050 111 2233', mobile: '+971 52 444 5566', email: 'Huda@Example.com' },
    agent: { name: 'Listing Agent', email: 'agent@brokerage.test', phone: '0559999999' },
    offering_type: 'Rent',
    property_type: 'Apartment',
    community: 'Dubai Marina',
    message: 'Is it available from November?',
  },
};

describe('lead source intake', () => {
  it('turns a signed Property Finder enquiry into a lead with both numbers and the enquiry on its timeline', async () => {
    const body = JSON.stringify(pfEnquiry);
    const { status } = await deliver(pfKey, pfEnquiry, { 'x-signature': sign(body) });
    expect(status).toBe(200);
    await work(pfKey);

    const [lead, ...others] = await leadByPhone('+971501112233');
    expect(others).toHaveLength(0);
    expect(lead).toMatchObject({
      fullName: 'Huda Rahman',
      email: 'huda@example.com',
      source: 'MARKETPLACE',
      sourceDetail: 'property_finder:PF-MARINA-22',
      consentStatus: 'IMPLIED',
      // A portal enquirer is on WhatsApp on every number they gave, the main one included (M4-02).
      phoneIsWhatsapp: true,
    });
    // Mapped to the workspace's catalogue entry for the connection's kind (M4-03).
    expect(await prisma.leadSource.findFirst({ where: { tenantId, id: lead!.sourceId ?? '' } })).toMatchObject({
      key: 'property_finder',
      name: 'Property Finder',
    });
    expect(lead!.phones.map((p) => [p.normalized, p.isWhatsapp])).toEqual([['+971524445566', true]]);

    const [note] = await prisma.activity.findMany({ where: { tenantId, leadId: lead!.id, typeId: noteTypeId } });
    expect(note!.notes).toContain('Enquiry via Property Finder');
    expect(note!.notes).toContain('Area: Dubai Marina');
    expect(note!.notes).toContain('Is it available from November?');
  });

  it('stores a retried delivery once and makes no second lead', async () => {
    const body = JSON.stringify(pfEnquiry);
    const again = await deliver(pfKey, pfEnquiry, { 'x-signature': sign(body) });
    expect(again.status).toBe(200);
    await work(pfKey);
    expect(await leadByPhone('+971501112233')).toHaveLength(1);
  });

  it('refuses a delivery with a wrong signature and stores nothing', async () => {
    const before = await prisma.webhookEvent.count({ where: { tenantId } });
    const forged = { ...pfEnquiry, data: { ...pfEnquiry.data, lead_id: 'pf-forged' } };
    expect((await deliver(pfKey, forged, { 'x-signature': sign('something else') })).status).toBe(401);
    expect((await deliver(pfKey, forged)).status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { tenantId } })).toBe(before);
  });

  it('attaches a repeat enquiry from the second number to the lead that holds it, and tells its owner', async () => {
    const [lead] = await leadByPhone('+971501112233');
    await prisma.lead.update({ where: { tenantId, id: lead!.id }, data: { ownerId: fixture.a.userId } });

    const repeat = { lead_id: 'pf-1002', name: 'Huda R.', mobile: '0524445566', message: 'Can I view on Saturday?' };
    const body = JSON.stringify(repeat);
    expect((await deliver(pfKey, repeat, { 'x-signature': sign(body) })).status).toBe(200);
    await work(pfKey);

    expect(await prisma.lead.count({ where: { tenantId, fullName: { startsWith: 'Huda' } } })).toBe(1);
    expect(await prisma.activity.count({ where: { tenantId, leadId: lead!.id, typeId: noteTypeId } })).toBe(2);
    const bell = await prisma.notification.findFirst({ where: { tenantId, recordId: lead!.id, kind: 'lead.enquiry' } });
    expect(bell).toMatchObject({ userId: fixture.a.userId, priority: 'HIGH' });
  });

  it('takes a Google Ads lead with the right key and refuses the wrong one', async () => {
    const googleLead = (key: string, extra: Record<string, unknown> = {}) => ({
      lead_id: 'gads-1',
      form_id: '4242',
      campaign_id: '77',
      google_key: key,
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Omar' },
        { column_id: 'LAST_NAME', string_value: 'Saleh' },
        { column_id: 'PHONE_NUMBER', string_value: '+971 50 777 8899' },
        { column_id: 'PROPERTY_TYPE', string_value: 'Villa' },
      ],
      ...extra,
    });

    expect((await deliver(googleKey, googleLead('not-the-key'))).status).toBe(401);
    expect((await deliver(googleKey, googleLead(GOOGLE_KEY, { lead_id: 'gads-test', is_test: true }))).status).toBe(
      200,
    );
    expect((await deliver(googleKey, googleLead(GOOGLE_KEY))).status).toBe(200);
    await work(googleKey);

    // The test lead is accepted and stored, never a lead.
    const leads = await leadByPhone('+971507778899');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ fullName: 'Omar Saleh', source: 'AD_LEAD_FORM', sourceDetail: 'google_ads:4242' });
    expect(await prisma.leadSource.findFirst({ where: { tenantId, id: leads[0]!.sourceId ?? '' } })).toMatchObject({
      key: 'google_ads',
    });
  });

  it('answers 401 for an unknown key and for a disconnected source', async () => {
    expect((await deliver('no-such-key', pfEnquiry)).status).toBe(401);
    await prisma.integrationConnection.update({ where: { webhookKey: googleKey }, data: { status: 'DISCONNECTED' } });
    const body = { lead_id: 'gads-2', google_key: GOOGLE_KEY, user_column_data: [] };
    expect((await deliver(googleKey, body)).status).toBe(401);
  });
});

describe('phone numbers and duplicate matching', () => {
  it('matches a newcomer on a lead’s other number, not only its main one', async () => {
    const [match] = await findDuplicates(tenantId, { phoneNormalized: '+971524445566' });
    expect(match?.fullName).toBe('Huda Rahman');
  });

  it('re-normalises the main number when it is edited, so matching follows the new one', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const ctx = buildCtx(
      buildActor({
        id: fixture.a.userId,
        tenantId,
        grants: [
          ['leads', 'VIEW'],
          ['leads', 'EDIT'],
        ],
      }),
    );
    await updateLead(ctx, leadId, { phone: '055 123 0000' });
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId } });
    expect(lead.phoneNormalized).toBe('+971551230000');
    const [match] = await findDuplicates(tenantId, { phoneNormalized: '+971551230000' });
    expect(match?.id).toBe(leadId);
  });
});

describe('the main number’s WhatsApp flag (M4-02)', () => {
  it('starts on, and the WhatsApp link follows it when switched off and on', async () => {
    const cookie = fixture.a.cookie;
    const created = await post(createLead, '/api/v1/leads', { fullName: 'Flag lead', phone: '050 930 0001' }, cookie);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.phoneIsWhatsapp).toBe(true);
    // The lead page's WhatsApp action is this link.
    expect(whatsappLink(created.body.phoneNormalized, created.body.phoneIsWhatsapp)).toBe('https://wa.me/971509300001');
    const url = `/api/v1/leads/${created.body.id}`;
    const off = await patch(patchLead, url, { phoneIsWhatsapp: false }, cookie);
    expect(off.body.phoneIsWhatsapp).toBe(false);
    expect(whatsappLink(off.body.phoneNormalized, off.body.phoneIsWhatsapp)).toBeNull();
    expect(await prisma.lead.findFirst({ where: { tenantId, id: created.body.id } })).toMatchObject({
      phoneIsWhatsapp: false,
    });
    const on = await patch(patchLead, url, { phoneIsWhatsapp: true }, cookie);
    expect(whatsappLink(on.body.phoneNormalized, on.body.phoneIsWhatsapp)).toBe('https://wa.me/971509300001');

    // A landline is created with the flag off.
    const landline = await post(
      createLead,
      '/api/v1/leads',
      { fullName: 'Office line', phone: '04 930 0002', phoneIsWhatsapp: false },
      cookie,
    );
    expect(landline.body.phoneIsWhatsapp).toBe(false);
  });

  it('is on for every lead that existed before it: the column’s default', async () => {
    const [column] = await prisma.$queryRaw<{ column_default: string }[]>`
      SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'Lead' AND column_name = 'phoneIsWhatsapp'`;
    expect(column?.column_default).toBe('true');
  });

  it('is never a link for a number the viewer sees masked', () => {
    expect(whatsappLink('+971 50 123 4567', true)).toBe('https://wa.me/971501234567');
    expect(whatsappLink('+971 •• ••• ••67', true)).toBeNull();
    expect(whatsappLink(null, true)).toBeNull();
  });
});

describe('the duplicate check on edit (M4-51)', () => {
  it('editing a phone to another lead’s number is refused', async () => {
    const cookie = fixture.a.cookie;
    const make = async (fullName: string, phone: string) => {
      const res = await post(createLead, '/api/v1/leads', { fullName, phone }, cookie);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as { id: string; reference: string };
    };
    const holder = await make('Number holder', '050 940 0001');
    const other = await post(addPhone, `/api/v1/leads/${holder.id}/phones`, { phone: '050 940 0002' }, cookie);
    expect(other.status).toBe(200);
    const taker = await make('Number taker', '050 940 0003');
    const url = `/api/v1/leads/${taker.id}`;

    // Its main number and one of its other numbers, each typed another way: 409 as create answers.
    for (const phone of ['+971 50 940 0001', '0509400002']) {
      const res = await patch(patchLead, url, { phone }, cookie);
      expect(res.status, phone).toBe(409);
      expect(res.body.detail).toContain(`already exists (${holder.reference}).`);
    }
    expect(await prisma.lead.findFirst({ where: { tenantId, id: taker.id } })).toMatchObject({
      phoneNormalized: '+971509400003',
    });

    // Someone the lead is out of scope for learns nothing from the check: 404, as for a missing lead.
    const role = await prisma.role.create({ data: { tenantId, key: `own-${taker.id}`, name: 'Own editor', rank: 70 } });
    await grantPermissions(
      tenantId,
      role.id,
      [
        ['leads', 'VIEW'],
        ['leads', 'EDIT'],
        // Sees numbers whole, so the phone is theirs to change and reaches the check.
        ['leads', 'VIEW_SENSITIVE_FIELDS'],
      ],
      'OWN',
    );
    const outsider = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `own-${taker.id}@a.test`,
      fullName: 'Own editor',
    });
    const theirs = await patch(
      patchLead,
      url,
      { phone: '0509400001' },
      await createSessionToken(tenantId, outsider.id),
    );
    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBe('Lead not found.');
  });
});

describe('a lead’s other numbers', () => {
  const path = (leadId: string, query = '') => `/api/v1/leads/${leadId}/phones${query}`;

  it('adds a number, refuses it twice and refuses the main number, and removes it', async () => {
    const leadId = fixture.a.leadIds[1]!;
    const cookie = fixture.a.cookie;
    await prisma.lead.update({
      where: { tenantId, id: leadId },
      data: { phone: '0501000000', phoneNormalized: '+971501000000' },
    });

    const added = await post(addPhone, path(leadId), { phone: '04 222 3333', label: 'Office' }, cookie);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ raw: '04 222 3333', label: 'Office', isWhatsapp: false });
    expect((await post(addPhone, path(leadId), { phone: '+97142223333' }, cookie)).status).toBe(409);
    expect((await post(addPhone, path(leadId), { phone: '050 100 0000' }, cookie)).status).toBe(409);

    expect((await del(removePhone, path(leadId, `?phoneId=${added.body.id}`), cookie)).status).toBe(200);
    expect(await prisma.leadPhone.count({ where: { tenantId, leadId } })).toBe(0);
  });

  it('refuses a role that may not edit the phone field', async () => {
    const { roleId } = await prisma.user.findFirstOrThrow({
      where: { tenantId, id: fixture.a.userId },
      select: { roleId: true },
    });
    const rule = await prisma.fieldPermission.create({
      data: { tenantId, roleId, objectType: 'LEAD', fieldKey: 'phone', canView: true, canEdit: false },
    });
    try {
      const res = await post(addPhone, path(fixture.a.leadIds[2]!), { phone: '0503334444' }, fixture.a.cookie);
      expect(res.status).toBe(403);
    } finally {
      await prisma.fieldPermission.delete({ where: { tenantId, id: rule.id } });
    }
  });
});
