import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
 * the vendor is not reachable from a test run. The model id is still checked
 * against the catalogue (that is input validation, not verification), so a
 * local server stands in for OpenRouter's model list.
 */
let catalogue: Server;
let catalogueDown = false;
const CATALOGUE = ['google/gemini-2.0-flash-001', 'google/gemini-2.5-flash', 'google/gemini-3.8-flash'];
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
  catalogue = createServer((_req, res) => {
    if (catalogueDown) return void res.writeHead(502).end();
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        data: CATALOGUE.map((id) => ({ id, name: `Google: ${id.split('/')[1]}`, supported_parameters: ['tools'] })),
      }),
    );
  });
  await new Promise<void>((r) => catalogue.listen(0, '127.0.0.1', r));
  vi.stubEnv(
    'AI_OPENROUTER_URL',
    `http://127.0.0.1:${(catalogue.address() as AddressInfo).port}/api/v1/chat/completions`,
  );
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
  vi.unstubAllEnvs();
  await new Promise((r) => catalogue.close(r));
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

/**
 * The incident: "Google Gemini" saved as the model id. A refused change must
 * leave the working configuration exactly as it was — model, key, status.
 * Runs after the suite above, so `ws` holds an OpenRouter key and
 * google/gemini-2.5-flash.
 */
describe('the model id is checked against the provider catalogue', () => {
  const save = (settings: Record<string, string>, cookie = ws.cookie, credentials: Record<string, string> = {}) =>
    put(saveConnection, path, { credentials, settings, skipVerification: true }, cookie, params);

  const snapshot = async (tenantId: string) => {
    const row = await storedFor(tenantId);
    return row && { metadata: row.metadata, plain: row.plain, status: row.status, errorMessage: row.errorMessage };
  };

  it('refuses the display name "Google Gemini" and keeps the working row', async () => {
    const before = await snapshot(ws.tenantId);
    const res = await save({ model: 'Google Gemini' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('not a valid OpenRouter model id');
    expect(await snapshot(ws.tenantId)).toEqual(before);
  });

  it('refuses an id the catalogue does not list', async () => {
    const before = await snapshot(ws.tenantId);
    const res = await save({ model: 'google/gemini-0-nope' });
    expect(res.status).toBe(422);
    expect(await snapshot(ws.tenantId)).toEqual(before);
  });

  it('says the catalogue is down, not that the id is bad, and changes nothing', async () => {
    const before = await snapshot(ws.tenantId);
    catalogueDown = true;
    try {
      const res = await save({ model: 'google/gemini-3.8-flash' });
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).toContain('could not be checked');
    } finally {
      catalogueDown = false;
    }
    expect(await snapshot(ws.tenantId)).toEqual(before);
  });

  it('stores a valid id as the id, its label apart, and keeps the blank-box key', async () => {
    const keyBefore = (await storedFor(ws.tenantId))!.plain.apiKey;
    const res = await save({ model: ' google/gemini-3.8-flash ' });
    expect(res.status).toBe(200);
    const stored = (await storedFor(ws.tenantId))!;
    expect(stored.metadata).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.8-flash',
      modelLabel: 'Google: gemini-3.8-flash',
    });
    expect(stored.plain.model).toBe('google/gemini-3.8-flash');
    expect(stored.plain.apiKey).toBe(keyBefore);
  });

  it('refuses a model label that is not a setting', async () => {
    const res = await save({ modelLabel: 'anything' });
    expect(res.status).toBe(422);
  });

  it('keeps each workspace’s check and row to itself', async () => {
    const before = await snapshot(ws.tenantId);
    const refused = await save({ provider: 'openrouter', model: 'Google Gemini' }, other.cookie, {
      apiKey: 'sk-or-v1-other',
    });
    expect(refused.status).toBe(422);
    expect(await storedFor(other.tenantId)).toBeNull();
    expect(await snapshot(ws.tenantId)).toEqual(before);

    const ok = await save({ provider: 'openrouter', model: 'google/gemini-2.5-flash' }, other.cookie, {
      apiKey: 'sk-or-v1-other',
    });
    expect(ok.status).toBe(200);
    expect((await storedFor(other.tenantId))!.plain.apiKey).toBe('sk-or-v1-other');
    expect(await snapshot(ws.tenantId)).toEqual(before);
  });
});
