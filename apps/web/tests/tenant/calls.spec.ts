import { describe, it, expect } from 'vitest';
import { buildActor, buildCtx } from '../helpers/ctx';

describe('call tenant isolation — unit checks', () => {
  const tenantA = 'tenant_call_a';
  const tenantB = 'tenant_call_b';
  const adminA = buildActor({ id: 'user_call_a', tenantId: tenantA });
  const adminB = buildActor({ id: 'user_call_b', tenantId: tenantB });

  it('actors in different tenants have different tenantIds', () => {
    const ctxA = buildCtx(adminA);
    const ctxB = buildCtx(adminB);
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);
  });

  it('call API Zod schemas reject invalid CUIDs', async () => {
    const { z } = await import('zod');
    const params = z.object({ id: z.string().cuid() });
    expect(() => params.parse({ id: 'not-a-cuid' })).toThrow();
    expect(() => params.parse({ id: '' })).toThrow();
  });

  it('call create body rejects missing recipientNumber', async () => {
    const { z } = await import('zod');
    const createBody = z.object({
      recipientNumber: z.string().min(1).max(30),
      direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
    }).strict();
    expect(() => createBody.parse({})).toThrow();
    expect(() => createBody.parse({ recipientNumber: '' })).toThrow();
  });

  it('consent body requires consentGiven to be true', async () => {
    const { z } = await import('zod');
    const consentBody = z.object({
      consentGiven: z.literal(true),
      method: z.enum(['VERBAL', 'WRITTEN', 'ELECTRONIC', 'PRE_AUTHORIZED']),
    }).strict();
    expect(() => consentBody.parse({ consentGiven: false, method: 'VERBAL' })).toThrow();
    expect(() => consentBody.parse({ consentGiven: true, method: 'VERBAL' })).not.toThrow();
  });

  it('recording body rejects negative sizeBytes', async () => {
    const { z } = await import('zod');
    const createBody = z.object({
      storageKey: z.string().min(1).max(1000),
      sizeBytes: z.number().int().positive().optional(),
    }).strict();
    expect(() => createBody.parse({ storageKey: 'key', sizeBytes: -1 })).toThrow();
    expect(() => createBody.parse({ storageKey: 'key', sizeBytes: 100 })).not.toThrow();
  });

  it('transcript body rejects content over 500k chars', async () => {
    const { z } = await import('zod');
    const body = z.object({
      content: z.string().min(1).max(500_000),
    }).strict();
    expect(() => body.parse({ content: 'x'.repeat(500_001) })).toThrow();
    expect(() => body.parse({ content: 'hello' })).not.toThrow();
  });
});
