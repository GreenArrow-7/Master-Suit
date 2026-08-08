import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { connectionCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { resolveTelephony } from '@/lib/integrations/telephony/resolve';
import { TelephonyConfigError } from '@/lib/integrations/telephony/types';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Which vendor places a call, and what a leaked database row is worth.
 *
 * The first block is a regression: `POST /calls/:id/dial` used to select "the
 * most recently updated connected integration whose provider is not `meta`",
 * which on any workspace with Google Calendar or speech-to-text connected would
 * pick one of those as the phone line. The second is the storage rule — an
 * integration credential is a bearer token for someone else's telephony account
 * and must not be readable from a database dump.
 */
let fixture: Fixture;

const CREDENTIALS = {
  twilio: { accountSid: 'ACtest0000', authToken: 'twilio-secret-value' },
  plivo: { authId: 'MAtest0000', authToken: 'plivo-secret-value' },
};

async function connect(tenantId: string, provider: string, credentials: Record<string, string>, callerNumber?: string) {
  return prisma.integrationConnection.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: {
      tenantId,
      provider,
      status: 'CONNECTED',
      credentials: wrapCredentials(credentials),
      metadata: callerNumber ? { callerNumber } : {},
    },
    update: {
      status: 'CONNECTED',
      credentials: wrapCredentials(credentials),
      metadata: callerNumber ? { callerNumber } : {},
    },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.integrationConnection.deleteMany({
    where: { tenantId: { in: [fixture.a.tenantId, fixture.b.tenantId] } },
  });
  await fixture.cleanup();
});

describe('the calling provider is chosen, never guessed', () => {
  it('refuses rather than treating a non-telephony connection as a phone line', async () => {
    // Exactly the shape that broke it: two connected integrations, neither of
    // which can place a call, the newest one first.
    await connect(fixture.a.tenantId, 'google', { accessToken: 'g' });
    await connect(fixture.a.tenantId, 'transcription', { apiKey: 'k', provider: 'deepgram' });

    await expect(resolveTelephony(fixture.a.tenantId)).rejects.toBeInstanceOf(TelephonyConfigError);
  });

  it('infers the vendor when exactly one is connected', async () => {
    await connect(fixture.a.tenantId, 'twilio', CREDENTIALS.twilio, '+971500000000');

    const resolved = await resolveTelephony(fixture.a.tenantId);
    expect(resolved.vendor).toBe('twilio');
    expect(resolved.callerNumber).toBe('+971500000000');
    expect(resolved.provider.name).toBe('twilio');
  });

  it('refuses to guess once a second vendor is connected', async () => {
    await connect(fixture.a.tenantId, 'plivo', CREDENTIALS.plivo, '+911111111111');

    await expect(resolveTelephony(fixture.a.tenantId)).rejects.toThrow(/default calling provider/i);
  });

  it('uses the workspace default once an administrator chooses one', async () => {
    await prisma.organizationSetting.upsert({
      where: { tenantId: fixture.a.tenantId },
      create: { tenantId: fixture.a.tenantId, telephonyProvider: 'plivo' },
      update: { telephonyProvider: 'plivo' },
    });

    const resolved = await resolveTelephony(fixture.a.tenantId);
    expect(resolved.vendor).toBe('plivo');
    expect(resolved.callerNumber).toBe('+911111111111');
  });

  it('refuses a default that has been disconnected instead of dialling something else', async () => {
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: fixture.a.tenantId, provider: 'plivo' } },
      data: { status: 'DISCONNECTED' },
    });

    await expect(resolveTelephony(fixture.a.tenantId)).rejects.toThrow(/not connected/i);
  });

  it("does not let one workspace resolve another workspace's provider", async () => {
    // Tenant B has connected nothing, and tenant A's rows are fully configured.
    await expect(resolveTelephony(fixture.b.tenantId)).rejects.toBeInstanceOf(TelephonyConfigError);
  });
});

describe('integration credentials at rest', () => {
  it('stores ciphertext, not the token', async () => {
    await connect(fixture.b.tenantId, 'twilio', CREDENTIALS.twilio, '+971500000001');

    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: fixture.b.tenantId, provider: 'twilio' } },
      select: { credentials: true },
    });
    const stored = row.credentials as Record<string, string>;

    expect(stored.authToken).not.toBe(CREDENTIALS.twilio.authToken);
    expect(JSON.stringify(stored)).not.toContain(CREDENTIALS.twilio.authToken);
    expect(stored.authToken.startsWith('v1.')).toBe(true);
  });

  it('round-trips through the reader that business code uses', async () => {
    const read = await connectionCredentials(fixture.b.tenantId, 'twilio');
    expect(read).toEqual(CREDENTIALS.twilio);
  });

  it('reports a disconnected provider as unavailable rather than returning its keys', async () => {
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: fixture.b.tenantId, provider: 'twilio' } },
      data: { status: 'ERROR' },
    });

    expect(await connectionCredentials(fixture.b.tenantId, 'twilio')).toBeNull();
  });

  it('passes through a value written before the column was encrypted', async () => {
    // Legacy rows are plaintext. Refusing to read them would break every
    // workspace configured before this shipped.
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: fixture.b.tenantId, provider: 'twilio' } },
      data: { status: 'CONNECTED', credentials: { accountSid: 'ACplain', authToken: 'plaintext-legacy' } },
    });

    expect(await connectionCredentials(fixture.b.tenantId, 'twilio')).toEqual({
      accountSid: 'ACplain',
      authToken: 'plaintext-legacy',
    });
  });
});
