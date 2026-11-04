/**
 * A Gemini connection in ERROR could not be repaired from the screen that
 * showed it.
 *
 * `connectionCredentials` returns nothing unless the row is CONNECTED — right
 * for every runtime caller, and wrong for the two administration paths that
 * read the stored key in order to re-test or re-save it. Test connection
 * therefore read no key and wrote "No API key is saved for this connection"
 * over a row that held one, and re-saving with the key box left blank (the
 * documented way to keep a key you cannot read back) merged over nothing and
 * was refused. Settings → Intelligence showed a saved key, a Remove key button
 * and "no key saved" at the same time, and neither button could get out of it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import {
  connectionCredentials,
  savedCredentials,
  storedCredentialKeys,
  wrapCredentials,
} from '@/lib/integrations/connection';
import { geminiCredential, geminiModel, geminiProvider } from '@/lib/ai/gemini';

const suffix = randomBytes(4).toString('hex');
const workspace = { broken: '', other: '' };

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({
      data: { slug: `gerr-a-${suffix}`, legalName: `GErr A ${suffix}`, displayName: `GErr A ${suffix}` },
    }),
    prisma.tenant.create({
      data: { slug: `gerr-b-${suffix}`, legalName: `GErr B ${suffix}`, displayName: `GErr B ${suffix}` },
    }),
  ]);
  workspace.broken = a.id;
  workspace.other = b.id;

  // The production state from the screenshot: ERROR, a key stored, and the
  // Provider written the way the vendor spells it.
  await prisma.integrationConnection.create({
    data: {
      tenantId: a.id,
      provider: 'gemini',
      status: 'ERROR',
      errorMessage: 'No API key is saved for this connection.',
      credentials: wrapCredentials({ apiKey: 'sk-or-v1-stored' }),
      metadata: { provider: 'Open Router', model: 'google/gemini-2.0-flash-001' },
    },
  });
});

afterAll(async () => {
  await prisma.integrationConnection.deleteMany({ where: { tenantId: { in: [workspace.broken, workspace.other] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [workspace.broken, workspace.other] } } });
});

describe('a Gemini connection parked in ERROR', () => {
  it('still refuses to run on it', async () => {
    // Unchanged, and the reason the administration paths need their own read:
    // a connection the vendor rejected must not serve features.
    expect(await connectionCredentials(workspace.broken, 'gemini')).toBeNull();
  });

  it('hands the stored key back to the settings screen so it can be re-tested and re-saved', async () => {
    expect(await savedCredentials(workspace.broken, 'gemini')).toEqual({ apiKey: 'sk-or-v1-stored' });
  });

  it('reads the vendor spelling of the provider as the provider', async () => {
    expect(await geminiProvider(workspace.broken)).toBe('openrouter');
  });

  /**
   * The consequence the workspace actually noticed: with the label unread, every
   * feature either posted an OpenRouter key to Google or fell back to
   * simulation behind a screen that said otherwise. Once the row is CONNECTED
   * the work runs on the workspace's own key, through OpenRouter.
   */
  it('runs a feature on the workspace key through OpenRouter, not in simulation', async () => {
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: workspace.broken, provider: 'gemini' } },
      data: { status: 'CONNECTED', errorMessage: null },
    });

    expect(await geminiCredential(workspace.broken)).toEqual({
      key: 'sk-or-v1-stored',
      source: 'workspace',
      provider: 'openrouter',
    });
    expect(await geminiModel(workspace.broken)).toBe('google/gemini-2.0-flash-001');
  });

  it('never reads one workspace’s stored key for another', async () => {
    expect(await savedCredentials(workspace.other, 'gemini')).toEqual({});
  });

  it('reports which credential fields hold a value, by name only', async () => {
    const row = await prisma.integrationConnection.findFirst({
      where: { tenantId: workspace.broken, provider: 'gemini' },
      select: { credentials: true },
    });
    // What the board draws "Stored — leave empty to keep" from. It used to come
    // from the status, so a connection holding nothing still promised a key.
    expect(storedCredentialKeys(row?.credentials)).toEqual(['apiKey']);
    expect(storedCredentialKeys({})).toEqual([]);
    expect(storedCredentialKeys(null)).toEqual([]);
  });
});
