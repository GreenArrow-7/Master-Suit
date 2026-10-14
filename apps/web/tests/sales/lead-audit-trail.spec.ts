import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Audit Log screen reads its session the way Next serves it.
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
// An upload is scanned and stored; neither engine runs here.
const scan = vi.hoisted(() => ({ verdict: 'CLEAN' as 'CLEAN' | 'INFECTED' }));
vi.mock('@/lib/antivirus', () => ({
  scanBuffer: async () => ({ verdict: scan.verdict, signature: 'test', detail: null }),
}));
// The real writer, which a case can make fail once (a lost insert, then the job's retry).
const auditFault = vi.hoisted(() => ({ failNext: false }));
vi.mock('@/lib/security/audit', async (original) => {
  const real = await original<typeof import('@/lib/security/audit')>();
  return {
    ...real,
    audit: (...args: Parameters<typeof real.audit>) => {
      if (!auditFault.failNext) return real.audit(...args);
      auditFault.failNext = false;
      return Promise.reject(new Error('audit insert failed'));
    },
  };
});
vi.mock('@/lib/storage', async (original) => ({
  ...(await original<typeof import('@/lib/storage')>()),
  putObject: async () => {},
}));

import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { POST as receive } from '@/app/api/v1/webhooks/leads/[key]/route';
import { POST as convert } from '@/app/api/v1/cold-data/[id]/convert/route';
import { POST as upload } from '@/app/api/v1/documents/route';
import { POST as liveAudio } from '@/app/api/v1/calls/[id]/live-audio/route';
import AuditLogPage from '@/app/(workspace)/[workspaceSlug]/admin/audit/page';
import { handleJob } from '@/workers/jobs';
import { checkLeadFirstContact } from '@/services/sla/checkLeadFirstContact';
import { applyMetaEvent } from '@/services/meta/applyEvent';
import type { NormalizedMetaEvent } from '@/lib/integrations/meta/events';
import { post } from '../helpers/request';
import { grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { pageText } from '../helpers/render';

/**
 * Every write to a lead leaves an AuditLog row, including the ones no person
 * made: a portal delivery, the distribution worker, the SLA clock. Those rows
 * have no actor ("System" on the Audit Log) and name the machine in
 * `metadata.source`.
 */
const SECRET = 'pf-signing-secret-for-audit-trail';

let fixture: Fixture;
let tenantId: string;
let pfKey: string;

const auditRows = (recordId: string) =>
  prisma.auditLog.findMany({ where: { tenantId, recordId }, orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId!, [['auditlogs', 'VIEW']]);
  cookieJar.value = fixture.a.cookie;

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
  await prisma.distributionRule.create({
    data: {
      tenantId,
      name: 'Portal rotation',
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: [fixture.a.userId] },
      respectWorkingHours: false,
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

/** A signed Property Finder delivery, through the receiver and the registered worker job. */
async function deliver(leadId: string, phone: string) {
  const body = JSON.stringify({
    event: 'lead.created',
    data: { lead_id: leadId, client: { name: 'Audit Trail', phone } },
  });
  const signature = `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;
  const res = await receive(
    new Request(`http://localhost/api/v1/webhooks/leads/${pfKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signature },
      body,
    }),
    { params: Promise.resolve({ key: pfKey }) },
  );
  expect(res.status).toBe(200);
  const connection = await prisma.integrationConnection.findUniqueOrThrow({ where: { webhookKey: pfKey } });
  await handleJob('webhook', {
    name: 'lead-source.enquiry',
    data: { tenantId, provider: `property_finder:${connection.id}`, externalId: leadId, source: 'property_finder' },
  });
}

describe('machine writes', () => {
  let leadId = '';

  it('a webhook-created, automatically assigned lead has two System rows on the Audit Log', async () => {
    await deliver('pf-audit-1', '050 123 4001');
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: '+971501234001' } });
    leadId = lead.id;
    await handleJob('distribution', { name: 'assign-lead', data: { tenantId, leadId } });

    const rows = await auditRows(leadId);
    expect(rows.map((r) => [r.event, r.actorType, r.actorUserId, (r.metadata as { source?: string }).source])).toEqual([
      ['RECORD_CREATED', 'SYSTEM', null, 'property_finder'],
      ['OWNER_CHANGED', 'SYSTEM', null, 'distribution'],
    ]);
    expect(rows[1]).toMatchObject({ fieldKey: 'ownerId', newValue: fixture.a.userId });

    // The screen: both rows, by "System", with the machine named.
    const text = await pageText(
      AuditLogPage({
        params: Promise.resolve({ workspaceSlug: fixture.a.slug }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(text).toContain('record_created');
    expect(text).toContain('owner_changed');
    expect(text).toContain('source=property_finder');
    // A field change names its machine too, not only the change.
    expect(text).toContain(`ownerId: null → "${fixture.a.userId}" · rule=Portal rotation · source=distribution`);
    expect(text.split('\n').filter((s) => s === 'System')).toHaveLength(2);
  });

  it('a repeat enquiry on that lead is a System row too', async () => {
    await deliver('pf-audit-2', '050 123 4001');
    const rows = await auditRows(leadId);
    expect(rows.at(-1)).toMatchObject({
      event: 'RECORD_UPDATED',
      actorType: 'SYSTEM',
      actorUserId: null,
      metadata: { action: 'lead.enquired_again', source: 'property_finder' },
    });
  });

  it('a first-contact SLA breach is one System row, however often the check runs', async () => {
    await checkLeadFirstContact(tenantId, leadId);
    await checkLeadFirstContact(tenantId, leadId);
    expect((await auditRows(leadId)).filter((r) => r.fieldKey === 'slaState')).toMatchObject([
      { event: 'RECORD_UPDATED', actorType: 'SYSTEM', newValue: 'BREACHED', metadata: { source: 'sla' } },
    ]);
  });

  it('a breach whose audit row failed is undone, and recorded when the job retries', async () => {
    await deliver('pf-audit-3', '050 123 4003');
    const { id } = await prisma.lead.findFirstOrThrow({
      where: { tenantId, phoneNormalized: '+971501234003' },
      select: { id: true },
    });
    auditFault.failNext = true;
    await expect(checkLeadFirstContact(tenantId, id)).rejects.toThrow('audit insert failed');
    const { slaState } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id }, select: { slaState: true } });
    expect(slaState).not.toBe('BREACHED');

    await checkLeadFirstContact(tenantId, id);
    expect((await auditRows(id)).filter((r) => r.fieldKey === 'slaState')).toMatchObject([
      { actorType: 'SYSTEM', newValue: 'BREACHED', metadata: { source: 'sla' } },
    ]);
  });

  it('a Meta Lead Ads lead is a System row, and so is the same person enquiring again', async () => {
    await prisma.integrationConnection.create({
      data: { tenantId, provider: 'meta', status: 'CONNECTED', credentials: wrapCredentials({ accessToken: 'graph' }) },
    });
    // The Graph answer for any leadgen id: the same person both times.
    vi.stubGlobal('fetch', async () =>
      Response.json({
        field_data: [
          { name: 'full_name', values: ['Meta Audit'] },
          { name: 'phone_number', values: ['050 123 4004'] },
        ],
      }),
    );
    const leadgen = (leadgenId: string): NormalizedMetaEvent => ({
      kind: 'LEAD_CREATED',
      externalId: `leadgen:${leadgenId}`,
      occurredAt: new Date(),
      lead: { leadgenId, formId: 'form-audit' },
    });
    try {
      const { leadId: metaLead } = (await applyMetaEvent({
        tenantId,
        connectionId: 'meta',
        event: leadgen('m-1'),
      })) as {
        leadId: string;
      };
      expect(await applyMetaEvent({ tenantId, connectionId: 'meta', event: leadgen('m-2') })).toEqual({
        leadId: metaLead,
        created: false,
      });
      expect(await auditRows(metaLead)).toMatchObject([
        {
          event: 'RECORD_CREATED',
          actorType: 'SYSTEM',
          actorUserId: null,
          metadata: { source: 'facebook:form-audit' },
        },
        {
          event: 'RECORD_UPDATED',
          actorType: 'SYSTEM',
          actorUserId: null,
          metadata: { action: 'lead.enquired_again', source: 'facebook:form-audit' },
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('lead writes made by a person', () => {
  it('converting cold data is one row, by that person, naming the lead', async () => {
    const record = await prisma.dataRecord.create({
      data: { tenantId, fullName: 'Cold Contact', phone: '050 123 4002', batch: 'audit-list.csv' },
    });
    const res = await post(convert, `/api/v1/cold-data/${record.id}/convert`, {}, fixture.a.cookie, {
      id: record.id,
    });
    expect(res.status).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { tenantId, actorUserId: fixture.a.userId } });
    const created = rows.filter((r) => r.event === 'RECORD_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actorType: 'USER', objectType: 'lead', recordId: res.body.leadId });
  });

  const sendDocument = () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 audit'], 'brochure.pdf', { type: 'application/pdf' }));
    form.set('leadId', fixture.a.leadIds[0]!);
    return upload(
      new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: { cookie: fixture.a.cookie },
        body: form,
      }),
      { params: Promise.resolve({}) },
    );
  };

  it('uploading a document to a lead is recorded', async () => {
    const res = await sendDocument();
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(await auditRows(id)).toMatchObject([
      {
        event: 'RECORD_CREATED',
        objectType: 'documents',
        actorUserId: fixture.a.userId,
        metadata: { leadId: fixture.a.leadIds[0], scan: 'CLEAN' },
      },
    ]);
  });

  it('an upload the scan rejects is recorded too', async () => {
    scan.verdict = 'INFECTED';
    try {
      const res = await sendDocument();
      expect(res.status).toBe(422);
      const { id } = await res.json();
      expect(await auditRows(id)).toMatchObject([
        { event: 'RECORD_CREATED', objectType: 'documents', metadata: { scan: 'INFECTED' } },
      ]);
    } finally {
      scan.verdict = 'CLEAN';
    }
  });

  it('finishing a live-microphone call is recorded like finishing any call', async () => {
    const call = await prisma.call.create({
      data: { tenantId, callerId: fixture.a.userId, leadId: fixture.a.leadIds[0], status: 'IN_PROGRESS' },
    });
    await prisma.recordingConsent.create({ data: { tenantId, callId: call.id, consentGiven: true } });

    const res = await liveAudio(
      new Request(`http://localhost/api/v1/calls/${call.id}/live-audio?final=1`, {
        method: 'POST',
        headers: { cookie: fixture.a.cookie },
      }),
      { params: Promise.resolve({ id: call.id }) },
    );
    expect(res.status).toBe(200);
    expect(await auditRows(call.id)).toMatchObject([
      { event: 'CALL_COMPLETED', objectType: 'calls', actorUserId: fixture.a.userId },
    ]);
  });
});

describe('the Audit Log screen', () => {
  it('prints each row on the workspace’s clock, whatever zone the server runs in', async () => {
    const server = process.env.TZ;
    // Neither UTC nor a zone a server or this machine runs in: +13:45 (+12:45 in winter).
    const timeZone = 'Pacific/Chatham';
    process.env.TZ = 'America/Los_Angeles';
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: timeZone } });
    try {
      const { occurredAt } = await prisma.auditLog.create({
        data: { tenantId, event: 'RECORD_UPDATED', objectType: 'lead', metadata: { action: 'clock.check' } },
        select: { occurredAt: true },
      });
      const at = (zone: string) =>
        occurredAt.toLocaleString('en-GB', {
          timeZone: zone,
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
      const text = await pageText(
        AuditLogPage({ params: Promise.resolve({ workspaceSlug: fixture.a.slug }), searchParams: Promise.resolve({}) }),
      );
      expect(text.split('\n')).toContain(at(timeZone));
      expect(text.split('\n')).not.toContain(at('UTC'));
    } finally {
      if (server === undefined) delete process.env.TZ;
      else process.env.TZ = server;
      await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    }
  });
});
