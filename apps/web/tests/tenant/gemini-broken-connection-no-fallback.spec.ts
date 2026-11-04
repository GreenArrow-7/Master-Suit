/**
 * A workspace whose own AI connection is broken must not be moved onto the
 * deployment's key.
 *
 * `geminiCredential` asked `connectionCredentials` for the workspace's key and
 * fell through to `GEMINI_API_KEY` when it got null. That answer is null for
 * two different situations — "this workspace never connected a provider" and
 * "this workspace connected one and the connection is currently marked broken"
 * — and the fallback ran for both.
 *
 * So a workspace that had chosen and paid for its own key, and whose connection
 * had since been marked ERROR, had its prompts and its bill silently moved onto
 * the platform's Google account: the opposite of what the file's own contract
 * promises ("a shared deployment key silently overriding that would be the
 * opposite of what connecting it meant"), a data boundary crossed without
 * anybody being told, and then a refusal from a deployment budget ceiling the
 * workspace had never agreed to while its own key sat unused in the row.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, afterEach, describe, it, expect } from 'vitest';

import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { geminiCredential } from '@/lib/ai/gemini';

const suffix = randomBytes(4).toString('hex');
const DEPLOYMENT_KEY = 'AIza-deployment-key-for-this-test-only';
const ids = { broken: '', never: '' };
const original = process.env.GEMINI_API_KEY;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({
      data: { slug: `gfb-a-${suffix}`, legalName: `GFb A ${suffix}`, displayName: `GFb A ${suffix}` },
    }),
    prisma.tenant.create({
      data: { slug: `gfb-b-${suffix}`, legalName: `GFb B ${suffix}`, displayName: `GFb B ${suffix}` },
    }),
  ]);
  ids.broken = a.id;
  ids.never = b.id;

  // The production state: a key stored, the row marked broken.
  await prisma.integrationConnection.create({
    data: {
      tenantId: ids.broken,
      provider: 'gemini',
      status: 'ERROR',
      errorMessage: 'No API key is saved for this connection.',
      credentials: wrapCredentials({ apiKey: 'workspace-own-key' }),
      metadata: { provider: 'Google', model: 'gemini-flash-latest' },
    },
  });
  // `ids.never` connects nothing at all: the case the fallback is actually for.
});

afterEach(() => {
  if (original === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = original;
});

afterAll(async () => {
  await prisma.integrationConnection.deleteMany({ where: { tenantId: { in: [ids.broken, ids.never] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.broken, ids.never] } } });
});

describe('a workspace whose AI connection is broken', () => {
  it('is not billed to the deployment key', async () => {
    process.env.GEMINI_API_KEY = DEPLOYMENT_KEY;

    const credential = await geminiCredential(ids.broken);

    // The whole point: on the old code this was {key: DEPLOYMENT_KEY,
    // source: 'deployment'}.
    expect(credential.key).toBeNull();
    expect(credential.source).toBe('simulated');
    expect(credential.source === 'simulated' && credential.reason).toBe('connection-broken');
  });

  it('does not quietly run on its own stored key either, while the row says broken', async () => {
    delete process.env.GEMINI_API_KEY;
    const credential = await geminiCredential(ids.broken);
    expect(credential.key).toBeNull();
  });

  it('says why, so the feature can name the repair instead of reporting an outage', async () => {
    const credential = await geminiCredential(ids.broken);
    expect(credential.source === 'simulated' && credential.reason).toBe('connection-broken');
  });

  it('runs on its own key again as soon as the connection is repaired', async () => {
    process.env.GEMINI_API_KEY = DEPLOYMENT_KEY;
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ids.broken, provider: 'gemini' } },
      data: { status: 'CONNECTED', errorMessage: null },
    });

    expect(await geminiCredential(ids.broken)).toEqual({
      key: 'workspace-own-key',
      source: 'workspace',
      provider: 'google',
    });

    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ids.broken, provider: 'gemini' } },
      data: { status: 'ERROR', errorMessage: 'No API key is saved for this connection.' },
    });
  });
});

describe('a workspace that never connected a provider', () => {
  it('still falls back to the deployment key, which is what the fallback is for', async () => {
    process.env.GEMINI_API_KEY = DEPLOYMENT_KEY;

    expect(await geminiCredential(ids.never)).toEqual({
      key: DEPLOYMENT_KEY,
      source: 'deployment',
      provider: 'google',
    });
  });

  it('runs simulated when the deployment holds no key either', async () => {
    delete process.env.GEMINI_API_KEY;

    const credential = await geminiCredential(ids.never);
    expect(credential.key).toBeNull();
    expect(credential.source).toBe('simulated');
    // No reason: nothing is broken, nothing needs repairing.
    expect(credential.source === 'simulated' && credential.reason).toBeUndefined();
  });
});
