import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import { geminiKey, geminiModel } from '@/lib/ai/gemini';

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
