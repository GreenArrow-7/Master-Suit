import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { geminiCredential, geminiKey, geminiModel, geminiProvider } from '@/lib/ai/gemini';

/**
 * Whose key an AI feature runs on.
 *
 * The workspace's own key has to win over the deployment's. A tenant that
 * brings its own key is buying its own quota, billing and data boundary, and a
 * shared key quietly overriding that would defeat the point of connecting one.
 */
const suffix = randomBytes(4).toString('hex');
const workspace = { id: '', other: '' };
const originalKey = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({
      data: { slug: `gem-a-${suffix}`, legalName: `Gem A ${suffix}`, displayName: `Gem A ${suffix}` },
    }),
    prisma.tenant.create({
      data: { slug: `gem-b-${suffix}`, legalName: `Gem B ${suffix}`, displayName: `Gem B ${suffix}` },
    }),
  ]);
  workspace.id = a.id;
  workspace.other = b.id;

  await prisma.integrationConnection.create({
    data: {
      tenantId: a.id,
      provider: 'gemini',
      status: 'CONNECTED',
      credentials: wrapCredentials({ apiKey: 'tenant-a-key' }),
      metadata: { model: 'gemini-3-pro' },
    },
  });
});

afterAll(async () => {
  process.env.GEMINI_API_KEY = originalKey;
  process.env.GEMINI_MODEL = originalModel;
  await prisma.integrationConnection.deleteMany({ where: { tenantId: { in: [workspace.id, workspace.other] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [workspace.id, workspace.other] } } });
});

describe('gemini key resolution', () => {
  it('prefers the workspace key over the deployment key', async () => {
    process.env.GEMINI_API_KEY = 'deployment-key';
    expect(await geminiKey(workspace.id)).toBe('tenant-a-key');
  });

  it('falls back to the deployment key for a workspace that has not connected one', async () => {
    process.env.GEMINI_API_KEY = 'deployment-key';
    expect(await geminiKey(workspace.other)).toBe('deployment-key');
  });

  /**
   * One workspace's key must never serve another's work. This is the same
   * isolation every other credential has; it is asserted because the fallback
   * makes a leak look like a working feature rather than an error.
   */
  it('never lends one workspace key to another', async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await geminiKey(workspace.id)).toBe('tenant-a-key');
    expect(await geminiKey(workspace.other)).toBeNull();
  });

  it('reports nothing when neither source has a key', async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await geminiKey(workspace.other)).toBeNull();
    expect(await geminiKey()).toBeNull();
  });

  it('stores the key encrypted, never in plain text', async () => {
    const row = await prisma.integrationConnection.findFirst({
      where: { tenantId: workspace.id, provider: 'gemini' },
      select: { credentials: true },
    });
    const stored = JSON.stringify(row!.credentials);
    expect(stored).not.toContain('tenant-a-key');
  });

  it('lets a workspace pick its own model, and falls back when it has not', async () => {
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    expect(await geminiModel(workspace.id)).toBe('gemini-3-pro');
    expect(await geminiModel(workspace.other)).toBe('gemini-2.0-flash');
  });

  /**
   * A key does not say which API it belongs to, and the two are not
   * interchangeable: OpenRouter is a Bearer token against an OpenAI-compatible
   * endpoint, Google is a query parameter against generativelanguage. Sent the
   * wrong way a key 400s, every feature falls back to simulation, and Settings
   * → Integrations goes on reading Connected — the exact shape of failure this
   * integration has already had once, when a retired model id was hardcoded.
   */
  describe('provider selection', () => {
    const setProvider = (tenantId: string, provider?: string, model?: string) =>
      prisma.integrationConnection.updateMany({
        where: { tenantId, provider: 'gemini' },
        data: { metadata: { ...(provider ? { provider } : {}), ...(model ? { model } : {}) } },
      });

    afterAll(() => setProvider(workspace.id, undefined, 'gemini-3-pro'));

    it('defaults to google, including for a workspace that set nothing', async () => {
      expect(await geminiProvider(workspace.other)).toBe('google');
      expect(await geminiProvider()).toBe('google');
    });

    it('travels with the credential, so the transport cannot guess', async () => {
      delete process.env.GEMINI_API_KEY;
      await setProvider(workspace.id, 'openrouter', 'google/gemini-2.0-flash-001');
      expect(await geminiCredential(workspace.id)).toEqual({
        key: 'tenant-a-key',
        source: 'workspace',
        provider: 'openrouter',
      });
    });

    /**
     * OpenRouter ids are namespaced and versioned with no rolling alias, so
     * there is nothing honest to default to. Substituting a guess is how a
     * workspace ends up 404ing into simulation behind a green tick; refusing
     * puts the misconfiguration where somebody sees it.
     */
    it('refuses to guess an OpenRouter model rather than defaulting to Google’s', async () => {
      delete process.env.GEMINI_API_KEY;
      await setProvider(workspace.id, 'openrouter');
      const credential = await geminiCredential(workspace.id);
      expect(credential.key).toBeNull();
      expect(credential.source).toBe('simulated');
      // And specifically not the Google default, which OpenRouter does not know.
      expect(credential.provider).toBe('openrouter');
    });

    it('still serves a Google key with no model set, because that default is real', async () => {
      delete process.env.GEMINI_API_KEY;
      // An earlier case pins GEMINI_MODEL; this one is about the built-in
      // fallback, which only shows when the deployment has not overridden it.
      delete process.env.GEMINI_MODEL;
      await setProvider(workspace.id, 'google');
      const credential = await geminiCredential(workspace.id);
      expect(credential.key).toBe('tenant-a-key');
      expect(await geminiModel(workspace.id)).toBe('gemini-flash-latest');
    });

    /**
     * The workspace that chose OpenRouter must not drag that choice onto the
     * *deployment's* key when its own becomes unusable. `GEMINI_API_KEY` is a
     * Google key by definition, and labelling it openrouter would send it to
     * the wrong endpoint on the one path that exists to keep working.
     *
     * Asserted on a workspace whose connection is present and says openrouter,
     * then disconnected — a workspace with no connection row at all reports
     * google regardless, so it cannot tell the two behaviours apart.
     */
    it('keeps the deployment key on google whatever the workspace chose', async () => {
      process.env.GEMINI_API_KEY = 'deployment-key';
      await setProvider(workspace.id, 'openrouter', 'google/gemini-2.0-flash-001');
      expect(await geminiProvider(workspace.id)).toBe('openrouter');

      await prisma.integrationConnection.updateMany({
        where: { tenantId: workspace.id, provider: 'gemini' },
        data: { status: 'DISCONNECTED' },
      });
      try {
        expect(await geminiCredential(workspace.id)).toEqual({
          key: 'deployment-key',
          source: 'deployment',
          provider: 'google',
        });
      } finally {
        await prisma.integrationConnection.updateMany({
          where: { tenantId: workspace.id, provider: 'gemini' },
          data: { status: 'CONNECTED' },
        });
      }
    });
  });

  it('ignores a disconnected connection', async () => {
    await prisma.integrationConnection.updateMany({
      where: { tenantId: workspace.id, provider: 'gemini' },
      data: { status: 'DISCONNECTED' },
    });
    delete process.env.GEMINI_API_KEY;
    // Disconnected means disconnected — not "keep using the key quietly".
    expect(await geminiKey(workspace.id)).toBeNull();
    await prisma.integrationConnection.updateMany({
      where: { tenantId: workspace.id, provider: 'gemini' },
      data: { status: 'CONNECTED' },
    });
  });
});
