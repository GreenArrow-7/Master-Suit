/**
 * The integration event log: what it records, and who can read it.
 *
 * Against real rows, because both halves are claims about the database. A mocked
 * client would let the "never fails the call it describes" rule pass while the
 * write silently never happened, which is the exact failure the rule exists to
 * make safe.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { withRetry } from '@/lib/integrations/retry';
import { recordIntegrationEvent, withIntegrationEvent } from '@/services/integrations/eventLog';
import { loggedTelephony } from '@/services/integrations/loggedTelephony';
import type { TelephonyProvider } from '@/lib/integrations/telephony/types';
import { loggedWhatsApp } from '@/services/integrations/loggedWhatsApp';
import type { WhatsAppProvider, WhatsAppResult } from '@/lib/integrations/whatsapp';

const suffix = randomBytes(4).toString('hex');
let tenantA: string;
let tenantB: string;

const scope = (tenantId: string, operation: string) => ({
  tenantId,
  provider: 'twilio',
  direction: 'OUTBOUND' as const,
  operation,
});

const eventFor = (tenantId: string, operation: string) =>
  prisma.integrationEvent.findFirstOrThrow({ where: { tenantId, operation } });

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { slug: `ie-a-${suffix}`, legalName: 'A LLC', displayName: 'A' } }),
    prisma.tenant.create({ data: { slug: `ie-b-${suffix}`, legalName: 'B LLC', displayName: 'B' } }),
  ]);
  tenantA = a.id;
  tenantB = b.id;
});

afterAll(async () => {
  for (const id of [tenantA, tenantB]) await prisma.tenant.delete({ where: { id } }).catch(() => {});
});

describe('integration event log', () => {
  it('records a successful call, its duration, and what it produced', async () => {
    const value = await withIntegrationEvent(
      { ...scope(tenantA, 'initiateCall'), describe: (r) => ({ externalId: (r as { sid: string }).sid }) },
      async () => ({ sid: 'CA123' }),
    );
    expect(value).toEqual({ sid: 'CA123' });

    const event = await eventFor(tenantA, 'initiateCall');
    expect(event.outcome).toBe('OK');
    expect(event.direction).toBe('OUTBOUND');
    expect(event.externalId).toBe('CA123');
    expect(event.attempts).toBe(1);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.errorCategory).toBeNull();
  });

  it('records the failure, categorised, and still rethrows for the caller', async () => {
    const boom = Object.assign(new Error('twilio returned 401'), { status: 401 });
    await expect(
      withIntegrationEvent(scope(tenantA, 'failingCall'), async () => {
        throw boom;
      }),
    ).rejects.toThrow(/401/);

    const event = await eventFor(tenantA, 'failingCall');
    expect(event.outcome).toBe('FAILED');
    expect(event.errorCategory).toBe('AUTH');
    expect(event.httpStatus).toBe(401);
    expect(event.detail).toContain('twilio returned 401');
  });

  it('counts the retries the call actually took, not the one it looks like', async () => {
    /**
     * The number §33 asks for. It is produced inside `withRetry`, several layers
     * below where it is recorded, so this is the assertion that the ambient
     * counter survives the journey — a threaded parameter would have been four
     * files of signature changes to carry one integer up.
     */
    let calls = 0;
    await withIntegrationEvent(scope(tenantA, 'retriedCall'), () =>
      withRetry(
        'test',
        async () => {
          calls += 1;
          if (calls < 3) throw new Error('fetch failed');
          return 'ok';
        },
        { baseDelayMs: 1 },
      ),
    );

    expect(calls).toBe(3);
    expect((await eventFor(tenantA, 'retriedCall')).attempts).toBe(3);
  });

  it('counts the attempts of a call that never succeeded', async () => {
    await expect(
      withIntegrationEvent(scope(tenantA, 'exhaustedCall'), () =>
        withRetry(
          'test',
          async () => {
            throw new Error('fetch failed');
          },
          { maxAttempts: 2, baseDelayMs: 1 },
        ),
      ),
    ).rejects.toThrow();

    // Read from the catch, which is outside the `run` call in the naive shape
    // and would have said 1 there.
    const event = await eventFor(tenantA, 'exhaustedCall');
    expect(event.attempts).toBe(2);
    expect(event.errorCategory).toBe('UNAVAILABLE');
  });

  it('never turns a working call into a failed one when the log write is rejected', async () => {
    /**
     * The one rule. A tenant id with no row violates the foreign key, which is
     * the closest thing to "the log is broken" that can be arranged on purpose.
     * It must resolve.
     */
    await expect(
      recordIntegrationEvent({
        tenantId: 'no-such-tenant',
        provider: 'twilio',
        direction: 'OUTBOUND',
        operation: 'orphan',
        outcome: 'OK',
      }),
    ).resolves.toBeUndefined();

    expect(await prisma.integrationEvent.count({ where: { tenantId: tenantA, operation: 'orphan' } })).toBe(0);
  });

  it('does not let a describe() that throws fail the call it describes', async () => {
    const value = await withIntegrationEvent(
      {
        ...scope(tenantA, 'badDescribe'),
        describe: () => {
          throw new Error('mapper is wrong');
        },
      },
      async () => 'the call worked',
    );

    expect(value).toBe('the call worked');
    // Still recorded, just without the entity the mapper failed to name.
    expect((await eventFor(tenantA, 'badDescribe')).outcome).toBe('OK');
  });

  it('truncates a provider message rather than refusing to store it', async () => {
    await recordIntegrationEvent({
      tenantId: tenantA,
      provider: 'meta',
      direction: 'OUTBOUND',
      operation: 'longDetail',
      outcome: 'FAILED',
      detail: 'x'.repeat(5_000),
    });
    expect((await eventFor(tenantA, 'longDetail')).detail!.length).toBe(500);
  });

  it('records what a telephony provider did, without the adapters knowing', async () => {
    /**
     * The decorator exists because the four vendor adapters are built by a
     * factory documented as pure and constructed with fake credentials to read
     * capability flags — instrumenting inside them would break the first and
     * write nonsense rows from the second. This checks the wrapper does the
     * recording and still behaves exactly like the provider underneath.
     */
    const calls: string[] = [];
    const fake = {
      name: 'twilio',
      capabilities: ['DIAL'],
      initiateCall: async () => {
        calls.push('initiateCall');
        return { externalCallId: 'CA-wrapped', event: 'CALL_INITIATED' };
      },
      endCall: async () => void calls.push('endCall'),
      getCallStatus: async () => null,
      getRecordingUrl: async () => 'https://example.test/rec.mp3',
      validateWebhook: () => true,
      parseWebhook: () => ({ externalCallId: 'x', event: 'CALL_COMPLETED' }),
    } as unknown as TelephonyProvider;

    const wrapped = loggedTelephony(fake, tenantA);

    const result = await wrapped.initiateCall({} as never);
    expect(result.externalCallId).toBe('CA-wrapped');
    await wrapped.endCall('CA-wrapped');
    expect(await wrapped.getRecordingUrl('CA-wrapped')).toBe('https://example.test/rec.mp3');

    // Passed through untouched: these never cross the network, and logging them
    // would bury the calls that can actually fail.
    expect(wrapped.name).toBe('twilio');
    expect(wrapped.validateWebhook({} as never)).toBe(true);
    expect(calls).toEqual(['initiateCall', 'endCall']);

    const rows = await prisma.integrationEvent.findMany({
      where: { tenantId: tenantA, provider: 'twilio', externalId: 'CA-wrapped' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.operation).sort()).toEqual(['endCall', 'getRecordingUrl', 'initiateCall']);
    expect(rows.every((r) => r.outcome === 'OK' && r.direction === 'OUTBOUND')).toBe(true);
  });

  it('records a telephony failure and lets it through to the caller', async () => {
    const fake = {
      name: 'plivo',
      capabilities: [],
      initiateCall: async () => {
        throw Object.assign(new Error('plivo returned 429'), { status: 429 });
      },
      endCall: async () => undefined,
      getCallStatus: async () => null,
      getRecordingUrl: async () => null,
      validateWebhook: () => false,
      parseWebhook: () => ({ externalCallId: 'x', event: 'CALL_COMPLETED' }),
    } as unknown as TelephonyProvider;

    await expect(loggedTelephony(fake, tenantA).initiateCall({} as never)).rejects.toThrow(/429/);

    const row = await prisma.integrationEvent.findFirstOrThrow({
      where: { tenantId: tenantA, provider: 'plivo', operation: 'initiateCall' },
    });
    expect(row.outcome).toBe('FAILED');
    expect(row.errorCategory).toBe('RATE_LIMIT');
    expect(row.httpStatus).toBe(429);
  });

  it('files a WhatsApp send that failed without throwing as a failure', async () => {
    /**
     * The silent case §33 is about. The Cloud API answers 200 with a `failed`
     * status and a code in the body, so a wrapper keying off exceptions alone
     * would record every refusal as a delivered message.
     */
    const refusing = {
      name: 'meta',
      sendTemplate: async (): Promise<WhatsAppResult> => ({
        externalMessageId: 'wamid.refused',
        status: 'failed',
        errorCode: '131047',
        errorMessage: 'Re-engagement message outside the 24 hour window',
      }),
      sendText: async (): Promise<WhatsAppResult> => ({ externalMessageId: 'x', status: 'queued' }),
      getMessageStatus: async () => null,
      verifyWebhookSignature: () => true,
      verifySubscription: () => true,
    } as unknown as WhatsAppProvider;

    const result = await loggedWhatsApp(refusing, tenantA).sendTemplate({} as never);
    // Returned unchanged: the decorator observes, it does not decide.
    expect(result.status).toBe('failed');

    const row = await prisma.integrationEvent.findFirstOrThrow({
      where: { tenantId: tenantA, provider: 'meta', operation: 'sendTemplate' },
    });
    expect(row.outcome).toBe('FAILED');
    expect(row.detail).toContain('131047');
    expect(row.externalId).toBe('wamid.refused');
  });

  it('records a WhatsApp send that worked, and the id Meta gave it', async () => {
    const working = {
      name: 'meta',
      sendTemplate: async (): Promise<WhatsAppResult> => ({ externalMessageId: 'x', status: 'queued' }),
      sendText: async (): Promise<WhatsAppResult> => ({ externalMessageId: 'wamid.ok', status: 'sent' }),
      getMessageStatus: async () => null,
      verifyWebhookSignature: () => true,
      verifySubscription: () => true,
    } as unknown as WhatsAppProvider;

    await loggedWhatsApp(working, tenantA).sendText('+971500000000', 'hello');

    const row = await prisma.integrationEvent.findFirstOrThrow({
      where: { tenantId: tenantA, provider: 'meta', operation: 'sendText' },
    });
    expect(row.outcome).toBe('OK');
    expect(row.externalId).toBe('wamid.ok');
    expect(row.errorCategory).toBeNull();
  });

  it('keeps one workspace out of another workspace log', async () => {
    await recordIntegrationEvent({ ...scope(tenantB, 'tenantBOnly'), outcome: 'OK' });

    expect(
      await prisma.integrationEvent.findFirst({ where: { tenantId: tenantA, operation: 'tenantBOnly' } }),
    ).toBeNull();
    expect(await prisma.integrationEvent.count({ where: { tenantId: tenantB } })).toBe(1);
  });
});
