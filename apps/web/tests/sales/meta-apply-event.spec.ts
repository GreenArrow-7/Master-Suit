import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NormalizedMetaEvent } from '@/lib/integrations/meta/events';

/**
 * The worker half of the Meta pipeline: a stored event becoming CRM records.
 *
 * Prisma and the Graph call are mocked. What is being pinned here is the
 * decision-making — dedupe before create, attach rather than duplicate, merge
 * rather than overwrite, and never invent a customer for a wrong number — not
 * that Prisma writes rows, which its own tests cover.
 */

const prisma = {
  lead: { update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  metaLeadFormRouting: { findUnique: vi.fn(), update: vi.fn() },
  leadStage: { findFirst: vi.fn() },
  conversation: { upsert: vi.fn() },
  communication: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
};
const findDuplicates = vi.fn();
const enqueue = vi.fn();
const connectionCredentials = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma,
  withTx: (_tenantId: string, fn: (tx: typeof prisma) => unknown) => fn(prisma),
}));
vi.mock('@/services/leads/findDuplicates', () => ({ findDuplicates }));
vi.mock('@/lib/queue', () => ({ enqueue }));
vi.mock('@/lib/integrations/connection', () => ({ connectionCredentials }));
vi.mock('@/services/shared/reference', () => ({ nextReference: async () => 'LEAD-1' }));

const { applyMetaEvent } = await import('@/services/meta/applyEvent');

const TENANT = 'tenant-a';
const base = { tenantId: TENANT, connectionId: 'conn-1' };

const leadgenEvent: NormalizedMetaEvent = {
  kind: 'LEAD_CREATED',
  externalId: 'leadgen:55',
  occurredAt: new Date('2026-08-14T10:00:00Z'),
  lead: { leadgenId: '55', formId: 'form-9', adId: 'ad-1', adgroupId: 'set-1', pageId: 'page-1' },
};

const inboundEvent: NormalizedMetaEvent = {
  kind: 'MESSAGE_RECEIVED',
  externalId: 'wamid.1',
  messageId: 'wamid.1',
  occurredAt: new Date('2026-08-14T10:05:00Z'),
  threadId: '971500000001',
  displayName: 'Priya Karim',
  text: 'Is the villa still available?',
  assetId: 'phone-1',
};

const graphOk = (fields: { name: string; values: string[] }[]) =>
  vi.fn(async () => new Response(JSON.stringify({ field_data: fields }), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  connectionCredentials.mockResolvedValue({ accessToken: 'tok' });
  prisma.leadStage.findFirst.mockResolvedValue({ id: 'stage-1' });
  prisma.lead.create.mockResolvedValue({ id: 'lead-new' });
  prisma.lead.findFirst.mockResolvedValue({ customData: {} });
  prisma.metaLeadFormRouting.findUnique.mockResolvedValue(null);
  prisma.metaLeadFormRouting.update.mockResolvedValue({});
});

describe('Meta Lead Ads → CRM', () => {
  it('creates a lead from the retrieved field data and hands it to distribution', async () => {
    vi.stubGlobal(
      'fetch',
      graphOk([
        { name: 'full_name', values: ['Priya Karim'] },
        { name: 'email', values: ['Priya@Example.com'] },
        { name: 'phone_number', values: ['0500000001'] },
      ]),
    );
    findDuplicates.mockResolvedValue([]);

    const result = await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(result).toEqual({ leadId: 'lead-new', created: true });
    const data = prisma.lead.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      fullName: 'Priya Karim',
      // Lower-cased on the way in, so the dedupe index actually matches later.
      email: 'priya@example.com',
      phoneNormalized: '+971500000001',
      source: 'AD_LEAD_FORM',
      sourceDetail: 'facebook:form-9',
    });
    expect(data.customData.metaLeadgen).toMatchObject({ metaLeadgenId: '55', metaAdId: 'ad-1' });
    // Assignment is what eventually notifies the rep (§47, §80).
    expect(enqueue).toHaveBeenCalledWith('distribution', 'assign-lead', { tenantId: TENANT, leadId: 'lead-new' });
  });

  it('attaches to an existing customer instead of creating a duplicate', async () => {
    vi.stubGlobal('fetch', graphOk([{ name: 'email', values: ['priya@example.com'] }]));
    findDuplicates.mockResolvedValue([{ id: 'lead-existing', reference: 'L-1', fullName: 'Priya', confidence: 1 }]);

    const result = await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(result).toEqual({ leadId: 'lead-existing', created: false });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  /** §40: the attribution write must not delete the rest of the column. */
  it('merges attribution into customData rather than replacing it', async () => {
    vi.stubGlobal('fetch', graphOk([{ name: 'email', values: ['priya@example.com'] }]));
    findDuplicates.mockResolvedValue([{ id: 'lead-existing', reference: 'L-1', fullName: 'P', confidence: 1 }]);
    prisma.lead.findFirst.mockResolvedValue({ customData: { budget: '2M', preferredArea: 'Marina' } });

    await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(prisma.lead.update.mock.calls[0]![0].data.customData).toMatchObject({
      budget: '2M',
      preferredArea: 'Marina',
      metaLeadgen: { metaLeadgenId: '55' },
    });
  });

  /** §63: a lapsed token must not silently swallow a customer's enquiry. */
  it('throws so the queue retries when the connection cannot retrieve the lead', async () => {
    connectionCredentials.mockResolvedValue(null);
    await expect(applyMetaEvent({ ...base, event: leadgenEvent })).rejects.toThrow(/access token/);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('throws on a Graph failure rather than writing an empty lead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    findDuplicates.mockResolvedValue([]);
    await expect(applyMetaEvent({ ...base, event: leadgenEvent })).rejects.toThrow(/HTTP 429/);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('ignores a lead form that returned nothing identifying', async () => {
    vi.stubGlobal('fetch', graphOk([{ name: 'consent', values: ['yes'] }]));
    findDuplicates.mockResolvedValue([]);
    await expect(applyMetaEvent({ ...base, event: leadgenEvent })).resolves.toBeUndefined();
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});

describe('inbound WhatsApp → conversation', () => {
  beforeEach(() => {
    prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1', leadId: null });
    prisma.communication.findFirst.mockResolvedValue(null);
    prisma.communication.create.mockResolvedValue({ id: 'msg-1' });
  });

  /** §29: an unknown number opens a thread, and must not manufacture a customer. */
  it('opens a thread for an unknown number without creating a lead', async () => {
    findDuplicates.mockResolvedValue([]);

    const result = await applyMetaEvent({ ...base, event: inboundEvent });

    expect(result).toMatchObject({ conversationId: 'conv-1', duplicate: false });
    expect(prisma.lead.create).not.toHaveBeenCalled();
    const upsert = prisma.conversation.upsert.mock.calls[0]![0];
    expect(upsert.where.tenantId_channel_externalId).toEqual({
      tenantId: TENANT,
      channel: 'WHATSAPP',
      externalId: '971500000001',
    });
    expect(upsert.create).toMatchObject({ displayName: 'Priya Karim', leadId: null, unreadCount: 1 });
  });

  it('links the thread to a known customer when the phone already matches', async () => {
    findDuplicates.mockResolvedValue([{ id: 'lead-7', reference: 'L-7', fullName: 'Priya', confidence: 1 }]);
    await applyMetaEvent({ ...base, event: inboundEvent });
    expect(prisma.conversation.upsert.mock.calls[0]![0].create.leadId).toBe('lead-7');
  });

  /** A retried job must not post the same message twice. */
  it('does not duplicate a message already stored under the same provider id', async () => {
    findDuplicates.mockResolvedValue([]);
    prisma.communication.findFirst.mockResolvedValue({ id: 'msg-existing' });

    const result = await applyMetaEvent({ ...base, event: inboundEvent });

    expect(result).toMatchObject({ messageId: 'msg-existing', duplicate: true });
    expect(prisma.communication.create).not.toHaveBeenCalled();
  });
});

describe('delivery receipts', () => {
  const status = (kind: NormalizedMetaEvent['kind'], s: NormalizedMetaEvent['status']): NormalizedMetaEvent => ({
    kind,
    externalId: `wamid.1:${s}`,
    messageId: 'wamid.1',
    occurredAt: new Date('2026-08-14T10:06:00Z'),
    status: s,
  });

  it('advances a message to read', async () => {
    prisma.communication.findFirst.mockResolvedValue({ id: 'msg-1', status: 'DELIVERED' });
    await applyMetaEvent({ ...base, event: status('MESSAGE_READ', 'READ') });
    expect(prisma.communication.update.mock.calls[0]![0].data).toMatchObject({ status: 'READ' });
  });

  /** Receipts arrive out of order routinely; a late `sent` must not undo `read`. */
  it('ignores a receipt that would move the status backwards', async () => {
    prisma.communication.findFirst.mockResolvedValue({ id: 'msg-1', status: 'READ' });
    await applyMetaEvent({ ...base, event: status('MESSAGE_SENT', 'SENT') });
    expect(prisma.communication.update).not.toHaveBeenCalled();
  });

  it('drops a receipt for a message it has never seen instead of failing', async () => {
    prisma.communication.findFirst.mockResolvedValue(null);
    await expect(applyMetaEvent({ ...base, event: status('MESSAGE_DELIVERED', 'DELIVERED') })).resolves.toBeUndefined();
    expect(prisma.communication.update).not.toHaveBeenCalled();
  });
});

/**
 * Phase 2: a routing rule is what turns "a Meta lead arrived" into "this lead,
 * on this stage, owned by this person". Configuration that the ingestion path
 * ignores would be a settings screen that changes nothing.
 */
describe('Meta lead form routing', () => {
  const withRouting = (rule: Record<string, unknown>) =>
    prisma.metaLeadFormRouting.findUnique.mockResolvedValue({
      id: 'rule-1',
      enabled: true,
      source: 'AD_LEAD_FORM',
      stageId: null,
      priority: 'MEDIUM',
      assignedUserId: null,
      assignedTeamId: null,
      ...rule,
    });

  beforeEach(() => {
    vi.stubGlobal('fetch', graphOk([{ name: 'email', values: ['new@example.com'] }]));
    findDuplicates.mockResolvedValue([]);
  });

  it('applies the rule stage, priority, source and owner to the new lead', async () => {
    withRouting({ stageId: 'stage-qualified', priority: 'HIGH', source: 'CHAT', assignedUserId: 'user-9' });
    prisma.leadStage.findFirst.mockResolvedValue({ id: 'stage-qualified' });

    await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(prisma.lead.create.mock.calls[0]![0].data).toMatchObject({
      stageId: 'stage-qualified',
      priority: 'HIGH',
      source: 'CHAT',
      ownerId: 'user-9',
    });
  });

  /** An administrator who named an owner must not have the engine overrule them. */
  it('skips distribution when the rule already names a person', async () => {
    withRouting({ assignedUserId: 'user-9' });
    await applyMetaEvent({ ...base, event: leadgenEvent });
    const queues = enqueue.mock.calls.map((c) => c[0]);
    expect(queues).not.toContain('distribution');
    expect(queues).toContain('automation');
  });

  /** A team is not a person — distribution still picks who inside it. */
  it('still runs distribution when the rule names only a team', async () => {
    withRouting({ assignedTeamId: 'team-3' });
    await applyMetaEvent({ ...base, event: leadgenEvent });
    expect(enqueue.mock.calls.map((c) => c[0])).toContain('distribution');
    expect(prisma.lead.create.mock.calls[0]![0].data.teamId).toBe('team-3');
  });

  it('creates no lead when the form is switched off, and says so', async () => {
    withRouting({ enabled: false });
    const result = await applyMetaEvent({ ...base, event: leadgenEvent });
    expect(result).toEqual({ skipped: 'routing-disabled' });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  /** A deleted stage must not stop leads arriving. */
  it('falls back to the default stage when the rule points at a stage that is gone', async () => {
    withRouting({ stageId: 'stage-deleted' });
    prisma.leadStage.findFirst
      .mockResolvedValueOnce(null) // the rule's stage no longer exists
      .mockResolvedValueOnce({ id: 'stage-default' });

    await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(prisma.lead.create.mock.calls[0]![0].data.stageId).toBe('stage-default');
  });

  it('behaves exactly as before when no rule exists', async () => {
    prisma.metaLeadFormRouting.findUnique.mockResolvedValue(null);
    prisma.leadStage.findFirst.mockResolvedValue({ id: 'stage-1' });

    await applyMetaEvent({ ...base, event: leadgenEvent });

    expect(prisma.lead.create.mock.calls[0]![0].data).toMatchObject({
      stageId: 'stage-1',
      source: 'AD_LEAD_FORM',
      ownerId: null,
    });
    expect(enqueue.mock.calls.map((c) => c[0])).toContain('distribution');
  });
});
