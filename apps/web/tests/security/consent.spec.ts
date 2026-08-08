import { describe, it, expect } from 'vitest';

describe('consent enforcement — validation rules', () => {
  it('consent body only accepts consentGiven: true (not false)', async () => {
    const { z } = await import('zod');
    const consentBody = z
      .object({
        consentGiven: z.literal(true),
        method: z.enum(['VERBAL', 'WRITTEN', 'ELECTRONIC', 'PRE_AUTHORIZED']),
        consentVersion: z.string().max(50).optional(),
      })
      .strict();

    expect(() => consentBody.parse({ consentGiven: true, method: 'VERBAL' })).not.toThrow();
    expect(() => consentBody.parse({ consentGiven: false, method: 'VERBAL' })).toThrow();
    expect(() => consentBody.parse({ consentGiven: true, method: 'INVALID' })).toThrow();
  });

  it('recording storageKey must be non-empty', async () => {
    const { z } = await import('zod');
    const recordingBody = z
      .object({
        storageKey: z.string().min(1).max(1000),
        mimeType: z.string().max(100).default('audio/webm'),
      })
      .strict();

    expect(() => recordingBody.parse({ storageKey: '' })).toThrow();
    expect(() => recordingBody.parse({ storageKey: 'recordings/call_123.webm' })).not.toThrow();
  });

  it('analysis correction body is strict — no extra fields', async () => {
    const { z } = await import('zod');
    const correctionBody = z
      .object({
        summary: z.string().max(5000).optional(),
        clientNeeds: z.array(z.string()).optional(),
        objections: z.array(z.string()).optional(),
        commitments: z.array(z.string()).optional(),
        nextSteps: z.array(z.string()).optional(),
        topicsMissed: z.array(z.string()).optional(),
        sentiment: z.string().max(50).optional(),
      })
      .strict();

    expect(() => correctionBody.parse({ summary: 'fixed' })).not.toThrow();
    expect(() => correctionBody.parse({ summary: 'fixed', hackedField: 'injected' })).toThrow();
  });

  it('audit body requires a valid scorecardId', async () => {
    const { z } = await import('zod');
    const auditBody = z
      .object({
        scorecardId: z.string().cuid(),
      })
      .strict();

    expect(() => auditBody.parse({})).toThrow();
    expect(() => auditBody.parse({ scorecardId: 'not-cuid' })).toThrow();
  });
});

describe('transient error detection', () => {
  function isTransient(err: unknown): boolean {
    if (err instanceof Error) {
      if ('status' in err) {
        const s = (err as any).status;
        return s === 429 || s === 502 || s === 503 || s === 504;
      }
      if (
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('fetch failed')
      ) {
        return true;
      }
    }
    return false;
  }

  it('identifies 429/502/503/504 as transient', () => {
    for (const status of [429, 502, 503, 504]) {
      const e: any = new Error('test');
      e.status = status;
      expect(isTransient(e)).toBe(true);
    }
  });

  it('does not treat 400/401/403/404 as transient', () => {
    for (const status of [400, 401, 403, 404]) {
      const e: any = new Error('test');
      e.status = status;
      expect(isTransient(e)).toBe(false);
    }
  });

  it('identifies network errors as transient', () => {
    expect(isTransient(new Error('fetch failed'))).toBe(true);
    expect(isTransient(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransient(new Error('ECONNRESET'))).toBe(true);
  });

  it('does not treat unknown errors as transient', () => {
    expect(isTransient(new Error('unknown'))).toBe(false);
    expect(isTransient('string error')).toBe(false);
  });
});
