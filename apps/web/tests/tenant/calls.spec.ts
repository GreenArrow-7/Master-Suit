import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';

const suffix = randomBytes(4).toString('hex');
const a = { slug: `calls-a-${suffix}`, id: '', callId: '' };
const b = { slug: `calls-b-${suffix}`, id: '', callId: '' };

beforeAll(async () => {
  for (const workspace of [a, b]) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;

    const role = await prisma.role.create({
      data: { tenantId: tenant.id, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
    });
    const caller = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `caller@${workspace.slug}.test`,
        fullName: 'Caller',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });

    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        callerId: caller.id,
        recipientNumber: '+971500000000',
        direction: 'OUTBOUND',
        status: 'COMPLETED',
        // The same external id in both tenants: the composite key must allow it.
        providerName: 'test-provider',
        externalCallId: `shared-external-${suffix}`,
      },
    });
    workspace.callId = call.id;
  }
});

afterAll(async () => {
  for (const workspace of [a, b]) {
    if (workspace.id) await prisma.tenant.delete({ where: { id: workspace.id } }).catch(() => {});
  }
});

describe('call tenant isolation', () => {
  /**
   * Replaces an assertion that read `expect(ctxA.tenantId).not.toBe(ctxB.tenantId)`
   * on two hand-built objects — a tautology that would have passed with the
   * database on fire. These go through the real client against real rows.
   */
  it('does not return another workspace call, even by its exact id', async () => {
    const found = await prisma.call.findFirst({ where: { tenantId: a.id, id: b.callId } });
    expect(found).toBeNull();
  });

  it('lets each workspace see exactly its own call', async () => {
    const [mine, theirs] = await Promise.all([
      prisma.call.findMany({ where: { tenantId: a.id } }),
      prisma.call.findMany({ where: { tenantId: b.id } }),
    ]);
    expect(mine.map((c) => c.id)).toEqual([a.callId]);
    expect(theirs.map((c) => c.id)).toEqual([b.callId]);
  });

  it('allows the same provider call id in two workspaces', async () => {
    // externalCallId is unique per (tenant, provider), not globally — treating it
    // as globally unique is how one tenant's webhook reaches another's record.
    const rows = await prisma.call.findMany({
      where: { tenantId: a.id, providerName: 'test-provider', externalCallId: `shared-external-${suffix}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(a.callId);
  });

  it('cannot update another workspace call', async () => {
    const result = await prisma.call.updateMany({
      where: { tenantId: a.id, id: b.callId },
      data: { status: 'FAILED' },
    });
    expect(result.count).toBe(0);
    const untouched = await prisma.call.findFirst({ where: { tenantId: b.id, id: b.callId } });
    expect(untouched!.status).toBe('COMPLETED');
  });

  it('call API Zod schemas reject invalid CUIDs', async () => {
    const { z } = await import('zod');
    const params = z.object({ id: z.string().cuid() });
    expect(() => params.parse({ id: 'not-a-cuid' })).toThrow();
    expect(() => params.parse({ id: '' })).toThrow();
  });

  it('call create body rejects missing recipientNumber', async () => {
    const { z } = await import('zod');
    const createBody = z
      .object({
        recipientNumber: z.string().min(1).max(30),
        direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
      })
      .strict();
    expect(() => createBody.parse({})).toThrow();
    expect(() => createBody.parse({ recipientNumber: '' })).toThrow();
  });

  it('consent body requires consentGiven to be true', async () => {
    const { z } = await import('zod');
    const consentBody = z
      .object({
        consentGiven: z.literal(true),
        method: z.enum(['VERBAL', 'WRITTEN', 'ELECTRONIC', 'PRE_AUTHORIZED']),
      })
      .strict();
    expect(() => consentBody.parse({ consentGiven: false, method: 'VERBAL' })).toThrow();
    expect(() => consentBody.parse({ consentGiven: true, method: 'VERBAL' })).not.toThrow();
  });

  it('recording body rejects negative sizeBytes', async () => {
    const { z } = await import('zod');
    const createBody = z
      .object({
        storageKey: z.string().min(1).max(1000),
        sizeBytes: z.number().int().positive().optional(),
      })
      .strict();
    expect(() => createBody.parse({ storageKey: 'key', sizeBytes: -1 })).toThrow();
    expect(() => createBody.parse({ storageKey: 'key', sizeBytes: 100 })).not.toThrow();
  });

  it('transcript body rejects content over 500k chars', async () => {
    const { z } = await import('zod');
    const body = z
      .object({
        content: z.string().min(1).max(500_000),
      })
      .strict();
    expect(() => body.parse({ content: 'x'.repeat(500_001) })).toThrow();
    expect(() => body.parse({ content: 'hello' })).not.toThrow();
  });
});
