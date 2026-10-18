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

import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { wrapCredentials } from '@/lib/integrations/connection';
import { sendsSms, telephonyProvider } from '@/lib/integrations/telephony';
import { smsSetup } from '@/lib/integrations/telephony/resolve';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { clear } from '@/lib/security/ratelimit';
import { POST as sendSms } from '@/app/api/v1/leads/[id]/sms/route';
import { GET as readTimeline } from '@/app/api/v1/leads/[id]/timeline/route';
import { GET as listIntegrations } from '@/app/api/v1/integrations/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import CommunicationsPage from '@/app/(workspace)/[workspaceSlug]/sales/communications/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, post } from '../helpers/request';

/**
 * Send an SMS from the lead (Lead Eagle audit row M4-29), in a Lead-Eagle-only
 * workspace: through the workspace's Twilio connection (its credentials, as
 * telephony stores them), from the SMS sender on its card, to the lead's main
 * number; an SMS Communication on the lead and its timeline, audited, sent or
 * failed with the provider's answer. Refused, with the reason, for a lead with
 * no number, opted out, withdrawn or on the do-not-call list, and while SMS is
 * not set up; 404 outside the sender's lead scope, 403 without the permission.
 * Twilio is `fetch`, stubbed: nothing leaves the process.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** Its own leads, with the numbers and `communications:CREATE`. */
let agent: string;
let agentId: string;
/** Every lead, numbers masked, may send. */
let masked: string;
/** Its own leads, no `communications`. */
let quiet: string;
let quietId: string;
/** Reads every lead, may send, does not work leads. */
let reader: string;
let leadId: string;

const MAIN = '+971501234567';
const SENDER = 'YOUHANHOMES';
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/AC0123456789/Messages.json';
const users: string[] = [];

const fetchMock = vi.fn<typeof fetch>();
const twilioAnswers = (status: number, body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));

const url = (id: string) => `/api/v1/leads/${id}/sms`;
const send = (as: string, id: string, body: Record<string, unknown>) => post(sendSms, url(id), body, as, { id });
const textsOf = (id: string) =>
  prisma.communication.findMany({ where: { tenantId, leadId: id, channel: 'SMS' }, orderBy: { createdAt: 'asc' } });
const setTwilio = (metadata: Record<string, unknown>, status: 'CONNECTED' | 'ERROR' = 'CONNECTED') =>
  prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'twilio' },
    data: { status, metadata: { callerNumber: '+97144000000', ...metadata } },
  });

async function roleUser(key: string, grants: Grants, scope: 'OWN' | 'ORGANIZATION') {
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 80 } });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${key}-${suffix}@a.test`,
    fullName: `The ${key}`,
  });
  users.push(user.id);
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

async function newLead(data: Record<string, unknown>) {
  return prisma.lead.create({
    data: {
      tenantId,
      reference: `MS-${randomBytes(3).toString('hex')}`,
      fullName: 'Plain Lead',
      stageId: fixture.a.stageId,
      ownerId: agentId,
      ...data,
    },
  });
}

/** The props of the first element in a rendered tree that carries a prop named `key`. */
function propsWith(node: unknown, key: string): Record<string, any> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsWith(child, key);
      if (found) return found;
    }
    return undefined;
  }
  const props = (node as { props?: Record<string, any> }).props;
  if (!props) return undefined;
  return key in props ? props : propsWith(props.children, key);
}

const offer = async (as: string, id: string) => {
  cookieJar.value = as;
  try {
    return propsWith(await LeadDetailPage({ params: Promise.resolve({ id }) }), 'messaging')?.messaging;
  } finally {
    cookieJar.value = admin;
  }
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  cookieJar.value = admin;
  const adminRoleId = (
    await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId }, select: { roleId: true } })
  ).roleId!;
  await grantPermissions(tenantId, adminRoleId, [['integrations', 'VIEW']]);
  await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await invalidateEntitlements(tenantId);

  const work: Grants = [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ['communications', 'VIEW'],
    ['communications', 'CREATE'],
  ];
  ({ id: agentId, cookie: agent } = await roleUser('agent', work, 'OWN'));
  masked = (
    await roleUser(
      'masked',
      work.filter(([, action]) => action !== 'VIEW_SENSITIVE_FIELDS'),
      'ORGANIZATION',
    )
  ).cookie;
  ({ id: quietId, cookie: quiet } = await roleUser(
    'quiet',
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ],
    'OWN',
  ));
  reader = (
    await roleUser(
      'reader',
      [
        ['leads', 'VIEW'],
        ['communications', 'VIEW'],
        ['communications', 'CREATE'],
      ],
      'ORGANIZATION',
    )
  ).cookie;

  leadId = (await newLead({ firstName: 'Sara', fullName: 'Sara Ahmed', phone: MAIN, phoneNormalized: MAIN })).id;

  // Twilio connected for calls, as the telephony card stores it: the credentials wrapped.
  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'twilio',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accountSid: 'AC0123456789', authToken: 'twilio-test-token' }),
      metadata: { callerNumber: '+97144000000', smsSender: SENDER },
    },
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fixture.cleanup();
});

beforeEach(async () => {
  fetchMock.mockReset();
  twilioAnswers(201, { sid: 'SM00000000000000000000000000000001', status: 'queued', error_code: null });
  for (const id of users) await clear({ key: `route:communications:CREATE:${id}`, max: 20, windowSeconds: 300 });
});

afterEach(async () => {
  await setTwilio({ smsSender: SENDER });
});

describe('an SMS from the lead (M4-29)', () => {
  it('goes through the Twilio connection from the SMS sender, is an SMS on the lead, audited, on the timeline', async () => {
    const res = await send(agent, leadId, { body: '  Hi Sara, the viewing is at 5 pm.  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toMatchObject({ channel: 'SMS', status: 'SENT', errorMessage: null });
    // The number never comes back.
    expect(JSON.stringify(res.body)).not.toMatch(/501234567/);

    // The Messages API, basic auth with the account SID and token, the text trimmed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0]!;
    expect(target).toBe(TWILIO);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC0123456789:twilio-test-token').toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      To: MAIN,
      From: SENDER,
      Body: 'Hi Sara, the viewing is at 5 pm.',
    });

    const [text] = await textsOf(leadId);
    expect(text).toMatchObject({
      channel: 'SMS',
      direction: 'OUTBOUND',
      status: 'SENT',
      body: 'Hi Sara, the viewing is at 5 pm.',
      toAddress: MAIN,
      fromAddress: SENDER,
      providerKey: 'twilio',
      providerMessageId: 'SM00000000000000000000000000000001',
      createdById: agentId,
    });
    expect(text!.sentAt).toBeInstanceOf(Date);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, event: 'MESSAGE_SENT', objectType: 'lead', recordId: leadId },
    });
    expect(audit).toMatchObject({ actorUserId: agentId });
    expect(audit.metadata).toMatchObject({ channel: 'SMS', communicationId: text!.id });

    const timeline = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, agent, { id: leadId });
    expect(timeline.body.entries[0]).toMatchObject({
      kind: 'message',
      title: 'SMS sent',
      detail: 'Sent',
      notes: 'Hi Sara, the viewing is at 5 pm.',
      by: 'The agent',
    });
  });

  it('a refusal by Twilio is on the lead as a failed SMS, its reason without the number', async () => {
    const lead = await newLead({ fullName: 'Bad Number', phone: '+971500000009', phoneNormalized: '+971500000009' });
    twilioAnswers(400, {
      code: 21211,
      message: "The 'To' number +971500000009 is not a valid phone number.",
      status: 400,
    });
    const res = await send(masked, lead.id, { body: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toMatchObject({ channel: 'SMS', status: 'FAILED', sentAt: null });
    expect(res.body.message.errorMessage).toBe("The 'To' number the number is not a valid phone number.");
    expect(JSON.stringify(res.body)).not.toMatch(/500000009/);
    expect(await textsOf(lead.id)).toMatchObject([{ status: 'FAILED', errorCode: '400', providerMessageId: null }]);

    // Accepted, then failed at once: failed too, with the provider's id.
    twilioAnswers(201, { sid: 'SM2', status: 'failed', error_code: 30007, error_message: 'Carrier filtered.' });
    const again = await send(masked, lead.id, { body: 'Hello again' });
    expect(again.body.message).toMatchObject({ status: 'FAILED', errorMessage: 'Carrier filtered.' });
    expect((await textsOf(lead.id))[1]).toMatchObject({ providerMessageId: 'SM2', errorCode: '30007' });
  });

  it('a send Twilio never answers stays queued with a warning, not failed: it may have gone', async () => {
    const lead = await newLead({ fullName: 'No Answer', phone: MAIN, phoneNormalized: MAIN });
    const unanswered = {
      status: 'QUEUED',
      sentAt: null,
      errorMessage: 'The SMS provider did not answer, so this text may have been sent. Check before sending it again.',
    };
    // The request timed out or the connection dropped: Twilio may have taken it.
    fetchMock.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'));
    const res = await send(agent, lead.id, { body: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toMatchObject(unanswered);
    // A 2xx Twilio answered with something that is not its JSON: taken, as far as anyone knows.
    fetchMock.mockImplementation(async () => new Response('<html>Bad gateway</html>', { status: 200 }));
    expect((await send(agent, lead.id, { body: 'Hello again' })).body.message).toMatchObject(unanswered);
    expect(await textsOf(lead.id)).toMatchObject([
      { ...unanswered, errorCode: null, providerMessageId: null },
      { ...unanswered, errorCode: null, providerMessageId: null },
    ]);
  });

  it('the Communications page lists the viewer’s messages only, a lead’s number read as the lead’s own', async () => {
    const theirs = await newLead({
      fullName: 'Someone Else',
      phone: '+971502223344',
      phoneNormalized: '+971502223344',
      ownerId: fixture.a.userId,
    });
    const fromMasked = (await send(masked, theirs.id, { body: 'From the masked role' })).body.message.id;
    const fromAgent = (await send(agent, leadId, { body: 'From the agent' })).body.message.id;
    const listed = async (as: string) => {
      cookieJar.value = as;
      try {
        const page = await CommunicationsPage({ searchParams: Promise.resolve({ channel: 'SMS' }) });
        return propsWith(page, 'rows')!.rows as { id: string; toAddress: string }[];
      } finally {
        cookieJar.value = admin;
      }
    };
    await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'ACTIVE' } });
    await invalidateEntitlements(tenantId);
    try {
      // Its own messages (communications at OWN), the number as it reads its lead's.
      const own = await listed(agent);
      expect(own.find((row) => row.id === fromAgent)?.toAddress).toBe(MAIN);
      expect(own.map((row) => row.id)).not.toContain(fromMasked);
      // Every message, each lead's number masked as the lead's is to this role.
      const all = await listed(masked);
      expect(all.map((row) => row.id)).toEqual(expect.arrayContaining([fromAgent, fromMasked]));
      expect(all.find((row) => row.id === fromAgent)?.toAddress).toBeTruthy();
      expect(JSON.stringify(all)).not.toMatch(/501234567|502223344/);
    } finally {
      await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
      await invalidateEntitlements(tenantId);
    }
  });

  it('answers 404 outside the lead scope and 403 without the permission, and sends nothing', async () => {
    const others = await newLead({
      fullName: 'Not Yours',
      phone: MAIN,
      phoneNormalized: MAIN,
      ownerId: fixture.a.userId,
    });
    expect((await send(agent, others.id, { body: 'x' })).status).toBe(404);
    expect((await send(agent, fixture.b.leadIds[0]!, { body: 'x' })).status).toBe(404);
    // Reads the lead but does not work it.
    expect((await send(reader, leadId, { body: 'x' })).status).toBe(404);
    // Works its leads, without the permission to send.
    const own = await newLead({ fullName: 'Quiet Lead', phone: MAIN, phoneNormalized: MAIN, ownerId: quietId });
    expect((await send(quiet, own.id, { body: 'x' })).status).toBe(403);
    // An empty or too long text.
    expect((await send(agent, leadId, { body: '   ' })).status).toBe(422);
    expect((await send(agent, leadId, { body: 'x'.repeat(641) })).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await textsOf(others.id)).toEqual([]);
    expect(await textsOf(own.id)).toEqual([]);
  });

  it('refuses a lead with no number, opted out of SMS, withdrawn or on the do-not-call list, with the reason', async () => {
    const cases = [
      [{ fullName: 'No Phone' }, 'no_phone', 'No Phone has no phone number.'],
      [{ fullName: 'Opted Out', phone: MAIN, smsOptOut: true }, 'opted_out', 'Opted Out has opted out of SMS.'],
      [
        { fullName: 'Withdrawn', phone: MAIN, consentStatus: 'WITHDRAWN' },
        'opted_out',
        'Withdrawn has withdrawn consent to be contacted.',
      ],
      [
        { fullName: 'Dnc Lead', phone: MAIN, doNotCall: true },
        'do_not_contact',
        'Dnc Lead is on the do-not-call list.',
      ],
    ] as const;
    for (const [data, code, message] of cases) {
      const lead = await newLead(data);
      const res = await send(agent, lead.id, { body: 'Hello' });
      expect(res.status, data.fullName).toBe(422);
      expect(res.body.errors[0]).toMatchObject({ field: 'lead', code, message });
      expect(await textsOf(lead.id)).toEqual([]);
      // And the lead page says the same, the button off.
      expect((await offer(agent, lead.id)).smsBlocked).toBe(message);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a lead with only another number is texted on it', async () => {
    const lead = await newLead({ fullName: 'Other Number' });
    await prisma.leadPhone.create({
      data: { tenantId, leadId: lead.id, raw: '055 987 6543', normalized: '+971559876543', label: 'Office' },
    });
    expect((await send(agent, lead.id, { body: 'Hello' })).status).toBe(200);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('To')).toBe('+971559876543');
  });

  it('is refused while SMS is not set up, and the lead page says why', async () => {
    const notSet = 'SMS is not set up: set the SMS sender on the Twilio card under Administration → Integrations.';
    expect(await offer(agent, leadId)).toMatchObject({ smsBlocked: null });

    await setTwilio({ smsSender: '' });
    let res = await send(agent, leadId, { body: 'Hello' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe(notSet);
    expect((await offer(agent, leadId)).smsBlocked).toBe(notSet);

    await setTwilio({ smsSender: 'NOT A VALID SENDER' });
    res = await send(agent, leadId, { body: 'Hello' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/^The SMS sender on the Twilio card is neither a number/);

    // Chosen as the calling provider, but its check failed.
    await setTwilio({ smsSender: SENDER }, 'ERROR');
    await prisma.organizationSetting.upsert({
      where: { tenantId },
      create: { tenantId, telephonyProvider: 'twilio' },
      update: { telephonyProvider: 'twilio' },
    });
    res = await send(agent, leadId, { body: 'Hello' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('SMS is not set up: Twilio is not connected.');

    // A calling provider that does not text.
    await prisma.organizationSetting.upsert({
      where: { tenantId },
      create: { tenantId, telephonyProvider: 'plivo' },
      update: { telephonyProvider: 'plivo' },
    });
    try {
      await setTwilio({ smsSender: SENDER });
      res = await send(agent, leadId, { body: 'Hello' });
      expect(res.status).toBe(403);
      expect(res.body.detail).toMatch(/^SMS is not set up: connect Twilio/);
    } finally {
      await prisma.organizationSetting.updateMany({ where: { tenantId }, data: { telephonyProvider: null } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the Twilio card carries the SMS sender; a vendor that does not text has none', async () => {
    const res = await get(listIntegrations, '/api/v1/integrations', admin);
    expect(res.status).toBe(200);
    const card = (key: string) => res.body.providers.find((p: { key: string }) => p.key === key);
    expect(card('twilio').settingFields.map((f: { key: string }) => f.key)).toContain('smsSender');
    expect(card('twilio').settings.smsSender).toBe(SENDER);
    expect(card('twilio').capabilities).toContain('SMS');
    expect(card('plivo').settingFields.map((f: { key: string }) => f.key)).not.toContain('smsSender');
  });

  it('the development mock texts nobody, in development only, and is refused in production', async () => {
    await prisma.integrationConnection.create({
      data: { tenantId, provider: 'mock', status: 'CONNECTED', credentials: {}, metadata: { smsSender: 'YOUHAN' } },
    });
    // The mock is the calling provider only where it is the one connected, and only in development (resolve.ts).
    await setTwilio({ smsSender: SENDER }, 'ERROR');
    try {
      vi.stubEnv('NODE_ENV', 'development');
      const res = await send(agent, leadId, { body: 'From the mock' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.message.status).toBe('SENT');
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await textsOf(leadId)).at(-1)).toMatchObject({ providerKey: 'mock', fromAddress: 'YOUHAN' });

      const was = env.NODE_ENV;
      (env as { NODE_ENV: string }).NODE_ENV = 'production';
      try {
        expect(sendsSms('mock')).toBe(false);
        expect(() => telephonyProvider('mock', {}, 'key')).toThrow(/forbidden in production/);
        expect(await smsSetup(tenantId)).toMatchObject({ ready: false });
      } finally {
        (env as { NODE_ENV: string }).NODE_ENV = was;
      }
    } finally {
      vi.unstubAllEnvs();
      await prisma.integrationConnection.deleteMany({ where: { tenantId, provider: 'mock' } });
    }
  });
});
