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

/** The test provider: nothing leaves the process, every send is recorded. */
const provider = vi.hoisted(() => ({
  name: 'test',
  sendTemplate: vi.fn(async () => ({ externalMessageId: `wamid.${Math.random()}`, status: 'sent' as const })),
  sendText: vi.fn(async () => ({ externalMessageId: 'wamid.text', status: 'sent' as const })),
}));
vi.mock('@/lib/integrations/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/whatsapp')>()),
  getWhatsAppProvider: () => provider,
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { mockOutbox } from '@/lib/mailer';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { POST as sendToLead } from '@/app/api/v1/leads/[id]/messages/route';
import { GET as readTimeline } from '@/app/api/v1/leads/[id]/timeline/route';
import { POST as replyInInbox } from '@/app/api/v1/conversations/[id]/messages/route';
import {
  GET as listEmailTemplates,
  PATCH as editEmailTemplate,
  POST as createEmailTemplate,
} from '@/app/api/v1/email-templates/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, patch, post } from '../helpers/request';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';

/**
 * Sending a WhatsApp template or an email from the lead (Lead Eagle audit row
 * M4-28), in a Lead-Eagle-only workspace: an approved template, its variables
 * filled from the lead, to a number marked as on WhatsApp (the main one by
 * default) or to the lead's email, through the same send the inbox uses, so
 * it is a Communication on the lead's timeline and an audit row. Refused,
 * with the reason, when the lead opted out or has nowhere to send it; 404
 * outside the sender's lead scope; never answering with the number.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
let adminId: string;
/** Lead Eagle's agent: its own leads, `communications:VIEW` and `CREATE`. */
let agent: string;
let agentId: string;
/** Every lead, without the sensitive fields (numbers masked), and the inbox. */
let masked: string;
/** Its own leads, no `communications`. */
let quiet: string;
let quietId: string;
/** `leads:VIEW` only, with the inbox: reads the lead, does not work it. */
let reader: string;
let leadId: string;
let officePhoneId: string;

const MAIN = '+971501234567';
const OFFICE = '+971559876543';
const EMAIL = 'sara.ahmed@client.test';
const TEMPLATE = 'wa:viewing_invite:en';

const url = (id: string) => `/api/v1/leads/${id}/messages`;
const send = (as: string, id: string, body: Record<string, unknown>) => post(sendToLead, url(id), body, as, { id });
const messagesOf = (id: string) =>
  prisma.communication.findMany({ where: { tenantId, leadId: id }, orderBy: { createdAt: 'asc' } });

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
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

async function newLead(data: Record<string, unknown>) {
  return prisma.lead.create({
    data: {
      tenantId,
      reference: `MS-${randomBytes(3).toString('hex')}`,
      fullName: 'Plain Lead',
      stageId: fixture.a.stageId,
      ...data,
    },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  adminId = fixture.a.userId;
  cookieJar.value = admin;
  // Lead Eagle alone: the product the row is for.
  await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await invalidateEntitlements(tenantId);
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });

  const adminRoleId = (
    await prisma.user.findFirstOrThrow({ where: { tenantId, id: adminId }, select: { roleId: true } })
  ).roleId!;
  await grantPermissions(tenantId, adminRoleId, [
    ['communications', 'VIEW'],
    ['communications', 'CREATE'],
    ['settings', 'VIEW'],
    ['settings', 'MANAGE_CONFIGURATION'],
  ]);

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

  const lead = await newLead({
    firstName: 'Sara',
    fullName: 'Sara Ahmed',
    phone: MAIN,
    phoneNormalized: MAIN,
    email: EMAIL,
    ownerId: agentId,
  });
  leadId = lead.id;
  officePhoneId = (
    await prisma.leadPhone.create({
      data: { tenantId, leadId, raw: OFFICE, normalized: OFFICE, label: 'Office', isWhatsapp: true },
    })
  ).id;

  // WhatsApp connected, with the test provider standing in for Meta.
  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'meta',
      status: 'CONNECTED',
      credentials: { accessToken: 'test-token', phoneNumberId: '5550001' },
    },
  });
  await prisma.messageTemplate.createMany({
    data: [
      {
        tenantId,
        key: TEMPLATE,
        name: 'viewing_invite',
        channel: 'WHATSAPP',
        language: 'en',
        body: 'Hi {{1}}, this is {{2}}. Shall we view {{3}}?',
        mergeFields: ['1', '2', '3'],
        approvalState: 'APPROVED',
      },
      {
        tenantId,
        key: 'wa:paused_one:en',
        name: 'paused_one',
        channel: 'WHATSAPP',
        language: 'en',
        body: 'Hello',
        approvalState: 'PAUSED',
      },
    ],
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

beforeEach(() => {
  provider.sendTemplate.mockClear();
  provider.sendText.mockClear();
});

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

describe('a WhatsApp template from the lead (M4-28)', () => {
  it('a Lead-Eagle-only agent sends an approved template to the main number: a Communication on its thread, audited, on the timeline', async () => {
    const res = await send(agent, leadId, {
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      variables: ['', '', 'Marina Gate'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
    // The number never comes back, in any form.
    expect(JSON.stringify(res.body)).not.toMatch(/501234567/);

    // {{1}} the lead's first name, {{2}} the sender's, {{3}} as typed.
    expect(provider.sendTemplate).toHaveBeenCalledTimes(1);
    expect(provider.sendTemplate).toHaveBeenCalledWith({
      to: '971501234567',
      template: {
        name: 'viewing_invite',
        language: 'en',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Sara' },
              { type: 'text', text: 'The agent' },
              { type: 'text', text: 'Marina Gate' },
            ],
          },
        ],
      },
    });

    const [message, ...more] = await messagesOf(leadId);
    expect(more).toHaveLength(0);
    expect(message).toMatchObject({
      id: res.body.message.id,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      status: 'SENT',
      body: 'Hi Sara, this is The agent. Shall we view Marina Gate?',
      ownerId: agentId,
      createdById: agentId,
      toAddress: '971501234567',
    });
    expect(message!.templateId).not.toBeNull();
    // On the lead's thread, which the sender now owns, as a reply in the inbox claims it.
    const thread = await prisma.conversation.findFirstOrThrow({ where: { tenantId, id: message!.conversationId! } });
    expect(thread).toMatchObject({ channel: 'WHATSAPP', externalId: '971501234567', leadId, ownerId: agentId });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, event: 'MESSAGE_SENT', objectType: 'lead', recordId: leadId },
    });
    expect(audit).toMatchObject({ actorUserId: agentId, actorType: 'USER' });
    expect(audit.metadata).toMatchObject({ channel: 'WHATSAPP', template: TEMPLATE, communicationId: message!.id });

    const timeline = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, agent, { id: leadId });
    expect(timeline.status).toBe(200);
    expect(timeline.body.entries[0]).toMatchObject({
      kind: 'message',
      title: 'WhatsApp sent',
      detail: 'Sent',
      notes: 'Hi Sara, this is The agent. Shall we view Marina Gate?',
      by: 'The agent',
    });
  });

  it('goes to another number marked as on WhatsApp when chosen, and refuses one that is not', async () => {
    const res = await send(agent, leadId, {
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      to: officePhoneId,
      variables: ['', '', 'the villa'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(provider.sendTemplate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '971559876543' }));

    await prisma.leadPhone.update({ where: { tenantId, id: officePhoneId }, data: { isWhatsapp: false } });
    const refused = await send(agent, leadId, {
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      to: officePhoneId,
      variables: ['', '', 'the villa'],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.errors[0]).toMatchObject({ code: 'not_whatsapp' });
    await prisma.leadPhone.update({ where: { tenantId, id: officePhoneId }, data: { isWhatsapp: true } });
  });

  it('follows the main-number flag: a landline is never sent to, and with no number marked the send is refused', async () => {
    const landline = await newLead({
      fullName: 'Landline Lead',
      phone: '+97142223333',
      phoneNormalized: '+97142223333',
      phoneIsWhatsapp: false,
      ownerId: agentId,
    });
    const res = await send(agent, landline.id, {
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      variables: ['', '', 'x'],
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'no_whatsapp_number',
      message: 'Landline Lead has no number marked as on WhatsApp.',
    });

    // With the main number off and another on, the other one is the default.
    await prisma.leadPhone.create({
      data: { tenantId, leadId: landline.id, raw: '0507770000', normalized: '+971507770000', isWhatsapp: true },
    });
    const other = await send(agent, landline.id, {
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      variables: ['', '', 'x'],
    });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(provider.sendTemplate).toHaveBeenCalledTimes(1);
    expect(provider.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: '971507770000' }));
  });

  it('refuses an opted-out lead, with the reason, and sends nothing', async () => {
    const optedOut = await newLead({
      fullName: 'Opted Out',
      phone: '+971501110000',
      phoneNormalized: '+971501110000',
      email: 'opted@client.test',
      whatsappOptOut: true,
      emailOptOut: true,
      ownerId: agentId,
    });
    const wa = await send(agent, optedOut.id, { channel: 'WHATSAPP', templateKey: TEMPLATE, variables: ['', '', 'x'] });
    expect(wa.status).toBe(422);
    expect(wa.body.errors[0]).toMatchObject({ code: 'opted_out', message: 'Opted Out has opted out of WhatsApp.' });

    const template = await prisma.messageTemplate.create({
      data: { tenantId, key: 'email:opt-check', name: 'Opt check', channel: 'EMAIL', subject: 'Hi', body: 'Hello' },
    });
    const email = await send(agent, optedOut.id, { channel: 'EMAIL', templateKey: template.key });
    expect(email.status).toBe(422);
    expect(email.body.errors[0]).toMatchObject({ code: 'opted_out', message: 'Opted Out has opted out of email.' });

    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(mockOutbox.lastTo('opted@client.test')).toBeUndefined();
    expect(await messagesOf(optedOut.id)).toEqual([]);
  });

  it('answers a template that is not approved, unknown or not filled in, and sends nothing', async () => {
    const paused = await send(agent, leadId, { channel: 'WHATSAPP', templateKey: 'wa:paused_one:en' });
    expect(paused.status).toBe(409);
    const unknown = await send(agent, leadId, { channel: 'WHATSAPP', templateKey: 'wa:nothing:en' });
    expect(unknown.status).toBe(404);
    // {{3}} has no value of the lead's to take.
    const unfilled = await send(agent, leadId, { channel: 'WHATSAPP', templateKey: TEMPLATE });
    expect(unfilled.status).toBe(422);
    expect(unfilled.body.errors[0]).toMatchObject({ code: 'missing_variable', message: 'Fill in {{3}}.' });
    expect(provider.sendTemplate).not.toHaveBeenCalled();
  });

  it('a role that sees the numbers masked sends, and is never answered with one', async () => {
    const res = await send(masked, leadId, { channel: 'WHATSAPP', templateKey: TEMPLATE, variables: ['', '', 'x'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(provider.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: '971501234567' }));
    // The message, and nothing of where it went: not the number, not its mask.
    expect(Object.keys(res.body.message).sort()).toEqual(['channel', 'errorMessage', 'id', 'sentAt', 'status']);
    expect(JSON.stringify(res.body)).not.toMatch(/1234567|•/);
  });

  it('the lead page offers the sends where they would go, numbers as the viewer reads them, and says why not', async () => {
    const offer = async (as: string, id: string) => {
      cookieJar.value = as;
      try {
        return propsWith(await LeadDetailPage({ params: Promise.resolve({ id }) }), 'messaging')?.messaging;
      } finally {
        cookieJar.value = admin;
      }
    };
    expect(await offer(agent, leadId)).toEqual({
      numbers: [
        { id: 'main', label: `Main · ${MAIN}` },
        { id: officePhoneId, label: `Office · ${OFFICE}` },
      ],
      whatsappBlocked: null,
      emailBlocked: null,
    });
    // Masked: the labels carry the mask, never the number.
    const seen = await offer(masked, leadId);
    expect(seen.numbers.map((n: { id: string }) => n.id)).toEqual(['main', officePhoneId]);
    expect(JSON.stringify(seen)).not.toMatch(/1234567|9876543/);
    expect(JSON.stringify(seen)).toContain('•');
    // No permission to send, or a lead it only reads: no card at all.
    const quietLead = await newLead({
      fullName: 'Quiet Own',
      phone: '+971501110002',
      phoneNormalized: '+971501110002',
      ownerId: quietId,
    });
    expect(await offer(quiet, quietLead.id)).toBeNull();
    expect(await offer(reader, leadId)).toBeNull();

    const optedOut = await newLead({
      fullName: 'Page Opted Out',
      phone: '+971501110001',
      phoneNormalized: '+971501110001',
      whatsappOptOut: true,
      ownerId: agentId,
    });
    expect(await offer(agent, optedOut.id)).toMatchObject({
      whatsappBlocked: 'Page Opted Out has opted out of WhatsApp.',
      emailBlocked: 'No email address.',
    });
    await prisma.integrationConnection.updateMany({
      where: { tenantId, provider: 'meta' },
      data: { status: 'DISCONNECTED' },
    });
    try {
      expect((await offer(agent, leadId)).whatsappBlocked).toBe('WhatsApp is not connected for this workspace.');
    } finally {
      await prisma.integrationConnection.updateMany({
        where: { tenantId, provider: 'meta' },
        data: { status: 'CONNECTED' },
      });
    }
  });

  it('answers 404 outside the lead scope and 403 without the permission, and sends nothing', async () => {
    const body = { channel: 'WHATSAPP', templateKey: TEMPLATE, variables: ['', '', 'x'] };
    // The administrator's lead, and another workspace's.
    const others = fixture.a.leadIds[0]!;
    await prisma.lead.update({ where: { tenantId, id: others }, data: { phone: MAIN, phoneNormalized: MAIN } });
    expect((await send(agent, others, body)).status).toBe(404);
    expect((await send(agent, fixture.b.leadIds[0]!, body)).status).toBe(404);
    // Reads the lead but does not work it: not one it may write to.
    expect((await send(reader, leadId, body)).status).toBe(404);
    // Works its leads, without the inbox's permission to send.
    const ownLead = await newLead({ fullName: 'Quiet Lead', phone: MAIN, phoneNormalized: MAIN });
    expect((await send(quiet, ownLead.id, body)).status).toBe(403);
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(await messagesOf(others)).toEqual([]);
  });

  it('is refused while WhatsApp is not connected', async () => {
    await prisma.integrationConnection.updateMany({
      where: { tenantId, provider: 'meta' },
      data: { status: 'DISCONNECTED' },
    });
    const res = await send(agent, leadId, { channel: 'WHATSAPP', templateKey: TEMPLATE, variables: ['', '', 'x'] });
    await prisma.integrationConnection.updateMany({
      where: { tenantId, provider: 'meta' },
      data: { status: 'CONNECTED' },
    });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('WhatsApp is not connected for this workspace.');
    expect(provider.sendTemplate).not.toHaveBeenCalled();
  });

  it('the inbox reply sends a template through the same send', async () => {
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId, channel: 'WHATSAPP', externalId: '971501234567' },
    });
    const res = await post(
      replyInInbox,
      `/api/v1/conversations/${thread.id}/messages`,
      { templateKey: TEMPLATE, variables: ['Sara', 'Admin', 'the tower'] },
      admin,
      { id: thread.id },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(provider.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: '971501234567' }));
    const sent = await prisma.communication.findFirstOrThrow({ where: { tenantId, id: res.body.message.id } });
    expect(sent.body).toBe('Hi Sara, this is Admin. Shall we view the tower?');
  });
});

describe('an email template from the lead (M4-28)', () => {
  let key: string;

  it('the administrator keeps email templates under Settings, audited; an agent may not', async () => {
    const created = await post(
      createEmailTemplate,
      '/api/v1/email-templates',
      { name: 'Brochure', subject: 'Your brochure, {{1}}', body: 'Dear {{1}},\n\nAs promised. {{2}}' },
      admin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({ name: 'Brochure', mergeFields: ['1', '2'], isActive: true });
    key = created.body.key;
    expect(
      await prisma.auditLog.count({
        where: { tenantId, objectType: 'message-template', recordId: created.body.id, event: 'RECORD_CREATED' },
      }),
    ).toBe(1);

    expect(
      (await post(createEmailTemplate, '/api/v1/email-templates', { name: 'X', subject: 'X', body: 'X' }, agent))
        .status,
    ).toBe(403);

    // The agent picks from the active ones.
    const listed = await get(listEmailTemplates, '/api/v1/email-templates', agent);
    expect(listed.status).toBe(200);
    expect(listed.body.templates.map((t: { key: string }) => t.key)).toContain(key);

    const retired = await post(
      createEmailTemplate,
      '/api/v1/email-templates',
      { name: 'Old offer', subject: 'Old', body: 'Old' },
      admin,
    );
    const off = await patch(
      editEmailTemplate,
      `/api/v1/email-templates?id=${retired.body.id}`,
      { isActive: false },
      admin,
    );
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const after = await get(listEmailTemplates, '/api/v1/email-templates', agent);
    expect(after.body.templates.map((t: { key: string }) => t.key)).not.toContain(retired.body.key);
    // Another workspace's template is not this one's to change.
    const theirs = await prisma.messageTemplate.create({
      data: { tenantId: fixture.b.tenantId, key: 'email:theirs', name: 'Theirs', channel: 'EMAIL', body: 'x' },
    });
    expect(
      (await patch(editEmailTemplate, `/api/v1/email-templates?id=${theirs.id}`, { name: 'Mine' }, admin)).status,
    ).toBe(404);
  });

  it('sends the template, filled from the lead, through the mail provider, and puts it on the timeline', async () => {
    mockOutbox.clear();
    const res = await send(agent, leadId, { channel: 'EMAIL', templateKey: key });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toMatchObject({ channel: 'EMAIL', status: 'SENT' });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);

    const mail = mockOutbox.lastTo(EMAIL);
    expect(mail).toMatchObject({ subject: 'Your brochure, Sara', body: 'Dear Sara,\n\nAs promised. The agent' });

    const message = await prisma.communication.findFirstOrThrow({ where: { tenantId, id: res.body.message.id } });
    expect(message).toMatchObject({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      status: 'SENT',
      leadId,
      subject: 'Your brochure, Sara',
      ownerId: agentId,
      createdById: agentId,
      conversationId: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { tenantId, event: 'MESSAGE_SENT', recordId: leadId, metadata: { path: ['channel'], equals: 'EMAIL' } },
      }),
    ).toBe(1);

    const timeline = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, agent, { id: leadId });
    expect(timeline.body.entries[0]).toMatchObject({
      kind: 'message',
      title: 'Email sent',
      notes: 'Your brochure, Sara — Dear Sara,\n\nAs promised. The agent',
      by: 'The agent',
    });
  });

  it('refuses a lead with no email address', async () => {
    const noEmail = await newLead({ fullName: 'No Mail', ownerId: agentId });
    const res = await send(agent, noEmail.id, { channel: 'EMAIL', templateKey: key });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ code: 'no_email', message: 'No Mail has no email address.' });
  });
});
