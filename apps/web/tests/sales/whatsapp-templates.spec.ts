import { describe, expect, it, vi, beforeEach } from 'vitest';

const prisma = {
  messageTemplate: { upsert: vi.fn(), updateMany: vi.fn() },
};
const connectionCredentials = vi.fn();

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/integrations/connection', () => ({ connectionCredentials }));

const { syncWhatsAppTemplates, placeholdersOf, SENDABLE } = await import('@/services/meta/templates');

const graph = (data: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  connectionCredentials.mockResolvedValue({ accessToken: 'tok', wabaId: 'waba-1' });
  prisma.messageTemplate.upsert.mockResolvedValue({});
  prisma.messageTemplate.updateMany.mockResolvedValue({ count: 0 });
});

describe('template placeholders', () => {
  it('reads positional variables out of the body, in order', () => {
    expect(placeholdersOf('Hello {{1}}, your viewing is at {{2}}.')).toEqual(['1', '2']);
  });

  it('returns nothing for a template with no variables', () => {
    expect(placeholdersOf('Thanks for getting in touch.')).toEqual([]);
  });
});

describe('template sync', () => {
  it('mirrors Meta approval state verbatim rather than collapsing it to a boolean', async () => {
    global.fetch = graph([
      {
        id: 't1',
        name: 'viewing_reminder',
        status: 'APPROVED',
        language: 'en',
        components: [{ type: 'BODY', text: 'Hi {{1}}' }],
      },
      {
        id: 't2',
        name: 'promo_blast',
        status: 'REJECTED',
        language: 'en',
        components: [{ type: 'BODY', text: 'Buy now' }],
      },
      { id: 't3', name: 'slow_one', status: 'PENDING', language: 'en', components: [{ type: 'BODY', text: 'Soon' }] },
    ]) as never;

    const result = await syncWhatsAppTemplates('tenant-a');

    expect(result.synced).toBe(3);
    const states = prisma.messageTemplate.upsert.mock.calls.map((c) => c[0].create.approvalState);
    // An administrator asking "why can I not use this" needs the real answer.
    expect(states).toEqual(['APPROVED', 'REJECTED', 'PENDING']);
    expect(SENDABLE).toBe('APPROVED');
  });

  /** The same template name exists once per language; the key must carry both. */
  it('keys a template by name and language so translations do not overwrite each other', async () => {
    global.fetch = graph([
      { id: 't1', name: 'welcome', status: 'APPROVED', language: 'en', components: [{ type: 'BODY', text: 'Hello' }] },
      { id: 't2', name: 'welcome', status: 'APPROVED', language: 'ar', components: [{ type: 'BODY', text: 'مرحبا' }] },
    ]) as never;

    await syncWhatsAppTemplates('tenant-a');

    const keys = prisma.messageTemplate.upsert.mock.calls.map((c) => c[0].where.tenantId_key.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(['wa:welcome:en', 'wa:welcome:ar']);
  });

  it('records the variables a template expects', async () => {
    global.fetch = graph([
      {
        id: 't1',
        name: 'viewing',
        status: 'APPROVED',
        language: 'en',
        components: [{ type: 'BODY', text: 'Hi {{1}}, {{2}} at {{3}}' }],
      },
    ]) as never;
    await syncWhatsAppTemplates('tenant-a');
    expect(prisma.messageTemplate.upsert.mock.calls[0]![0].create.mergeFields).toEqual(['1', '2', '3']);
  });

  /**
   * A withdrawn template is deactivated, not deleted: a Communication row can
   * reference it, and "what did we send this customer" must stay answerable.
   */
  it('deactivates templates that have disappeared upstream instead of deleting them', async () => {
    global.fetch = graph([
      { id: 't1', name: 'kept', status: 'APPROVED', language: 'en', components: [{ type: 'BODY', text: 'x' }] },
    ]) as never;
    prisma.messageTemplate.updateMany.mockResolvedValue({ count: 2 });

    const result = await syncWhatsAppTemplates('tenant-a');

    expect(result.retired).toBe(2);
    const where = prisma.messageTemplate.updateMany.mock.calls[0]![0];
    expect(where.data).toMatchObject({ isActive: false, approvalState: 'WITHDRAWN' });
    expect(where.where.NOT.key.in).toEqual(['wa:kept:en']);
  });

  /** The phone number id is not interchangeable with the business account id. */
  it('refuses clearly when no business account id is configured', async () => {
    connectionCredentials.mockResolvedValue({ accessToken: 'tok', phoneNumberId: '123' });
    await expect(syncWhatsAppTemplates('tenant-a')).rejects.toThrow(/Business Account ID/);
  });

  it('refuses when WhatsApp is not connected at all', async () => {
    connectionCredentials.mockResolvedValue(null);
    await expect(syncWhatsAppTemplates('tenant-a')).rejects.toThrow(/not connected/);
  });

  it('surfaces a Graph failure rather than silently syncing nothing', async () => {
    global.fetch = vi.fn(async () => new Response('bad token', { status: 401 })) as never;
    await expect(syncWhatsAppTemplates('tenant-a')).rejects.toThrow(/HTTP 401/);
  });
});
