import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { PUT as saveConnection } from '@/app/api/v1/integrations/[provider]/route';
import { put } from '../helpers/request';
import { leadEagleWorkspace } from '../helpers/leadSource';

/**
 * Saving the Gemini connection from Settings → Intelligence.
 *
 * The screen reported a workspace's connection as Error, "No API key is saved
 * for this connection.", "Stored — leave empty to keep" and a Remove key button
 * at the same time. The Provider had been typed the way the vendor spells it —
 * "Open Router" — which no reader matched, so the OpenRouter key was tested
 * against Google and refused; and once the row read ERROR the save path read
 * its stored key through a CONNECTED-only gate, so re-saving with the key box
 * left blank merged over nothing and was refused as "API key is required".
 *
 * `skipVerification` throughout: what is under test is what gets stored, and
 * the vendor is not reachable from a test run.
 */
const path = '/api/v1/integrations/gemini';
const params = { provider: 'gemini' };

let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let other: Awaited<ReturnType<typeof leadEagleWorkspace>>;

const storedFor = async (tenantId: string) => {
  const row = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'gemini' } },
  });
  return row && { ...row, plain: decryptCredentials((row.credentials ?? {}) as Record<string, unknown>) };
};

beforeAll(async () => {
  [ws, other] = await Promise.all([
    leadEagleWorkspace('gem-save', [
      ['integrations', 'VIEW'],
      ['integrations', 'MANAGE_CONFIGURATION'],
    ]),
    leadEagleWorkspace('gem-other', [
      ['integrations', 'VIEW'],
      ['integrations', 'MANAGE_CONFIGURATION'],
    ]),
  ]);
});

afterAll(async () => {
  await Promise.all([ws.cleanup(), other.cleanup()]);
});

describe('saving the Gemini connection', () => {
  it('stores the vendor’s own spelling of the provider as the internal value', async () => {
    const res = await put(
      saveConnection,
      path,
      {
        credentials: { apiKey: 'sk-or-v1-first' },
        settings: { provider: 'Open Router', model: 'google/gemini-2.0-flash-001' },
        skipVerification: true,
      },
      ws.cookie,
      params,
    );

    expect(res.status).toBe(200);
    expect(res.body.metadata.provider).toBe('openrouter');
    // The copy the verifier reads has to agree with it, or a re-test checks the
    // key against the other vendor all over again.
    expect((await storedFor(ws.tenantId))!.plain.provider).toBe('openrouter');
  });

  it('keeps the stored key when the key box is left empty, even from ERROR', async () => {
    // The production state: the verification failed, so the row reads ERROR.
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'gemini' } },
      data: { status: 'ERROR', errorMessage: 'No API key is saved for this connection.' },
    });

    const res = await put(
      saveConnection,
      path,
      { credentials: {}, settings: { model: 'google/gemini-2.5-flash' }, skipVerification: true },
      ws.cookie,
      params,
    );

    expect(res.status).toBe(200);
    const stored = (await storedFor(ws.tenantId))!;
    expect(stored.plain.apiKey).toBe('sk-or-v1-first');
    expect(stored.status).toBe('CONNECTED');
    expect(stored.errorMessage).toBeNull();
    expect((stored.metadata as Record<string, unknown>).model).toBe('google/gemini-2.5-flash');
  });

  it('clears the key only when the box is sent empty on purpose', async () => {
    const res = await put(
      saveConnection,
      path,
      { credentials: { apiKey: '' }, settings: {}, skipVerification: true },
      ws.cookie,
      params,
    );
    // Nothing left to connect with, so the save is refused and the stored key
    // stands — clearing a key is what Remove key is for.
    expect(res.status).toBe(422);
    expect((await storedFor(ws.tenantId))!.plain.apiKey).toBe('sk-or-v1-first');
  });

  it('refuses a provider that is neither, rather than quietly meaning google', async () => {
    const res = await put(
      saveConnection,
      path,
      { credentials: {}, settings: { provider: 'openai' }, skipVerification: true },
      ws.cookie,
      params,
    );

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('google or openrouter');
    expect((await storedFor(ws.tenantId))!.plain.provider).toBe('openrouter');
  });

  it('never merges one workspace’s stored key into another’s save', async () => {
    const res = await put(
      saveConnection,
      path,
      { credentials: {}, settings: { provider: 'google' }, skipVerification: true },
      other.cookie,
      params,
    );

    // The other workspace has no key of its own; the first one's must not stand in.
    expect(res.status).toBe(422);
    expect(await storedFor(other.tenantId)).toBeNull();
  });

  it('leaves an unrelated provider’s credentials alone', async () => {
    await prisma.integrationConnection.create({
      data: {
        tenantId: ws.tenantId,
        provider: 'twilio',
        status: 'CONNECTED',
        credentials: wrapCredentials({ accountSid: 'AC-untouched', authToken: 'tok-untouched' }),
      },
    });

    await put(
      saveConnection,
      path,
      { credentials: { apiKey: 'sk-or-v1-second' }, settings: {}, skipVerification: true },
      ws.cookie,
      params,
    );

    const twilio = await prisma.integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'twilio' } },
    });
    expect(decryptCredentials((twilio!.credentials ?? {}) as Record<string, unknown>)).toEqual({
      accountSid: 'AC-untouched',
      authToken: 'tok-untouched',
    });
  });
});
