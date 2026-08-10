/**
 * Provider seams (real-estate HRMS §3, §9): the e-signature and SMS providers
 * are replaceable, and their mock adapters must be impossible to enable
 * in production — a stub that reports success would let a workflow believe an
 * offer was signed or a person was notified when neither happened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getESignatureProvider, MockESignatureProvider } from '@/lib/integrations/esignature';
import { getSmsProvider, MockSmsProvider } from '@/lib/integrations/sms';

afterEach(() => {
  vi.unstubAllEnvs();
});

const setEnv = (name: string, value: string) => vi.stubEnv(name, value);

describe('e-signature provider', () => {
  it('returns the mock adapter outside production', () => {
    setEnv('NODE_ENV', 'development');
    expect(getESignatureProvider()).toBeInstanceOf(MockESignatureProvider);
  });

  it('creates an envelope that is never auto-completed', async () => {
    setEnv('NODE_ENV', 'development');
    const envelope = await getESignatureProvider().createEnvelope({
      signerName: 'Aisha',
      signerEmail: 'aisha@example.test',
      documentTitle: 'Offer letter',
      referenceId: 'offer_1',
    });
    expect(envelope.envelopeId).toMatch(/^mock_sig_/);
    // A real signature has to be driven by a human, not invented by the stub.
    expect(envelope.status).toBe('created');
  });

  it('refuses the mock adapter in production', () => {
    setEnv('NODE_ENV', 'production');
    expect(() => getESignatureProvider()).toThrow(/forbidden in production/);
  });

  it('rejects an unknown provider', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('ESIGNATURE_PROVIDER', 'nope');
    expect(() => getESignatureProvider()).toThrow(/Unknown e-signature provider/);
  });
});

describe('SMS provider', () => {
  it('returns the mock adapter outside production and reports queued', async () => {
    setEnv('NODE_ENV', 'test');
    const provider = getSmsProvider();
    expect(provider).toBeInstanceOf(MockSmsProvider);
    const result = await provider.send({ to: '+971500000000', body: 'Reminder' });
    expect(result.status).toBe('queued');
    expect(result.providerMessageId).toMatch(/^mock_sms_/);
  });

  it('refuses the mock adapter in production', () => {
    setEnv('NODE_ENV', 'production');
    expect(() => getSmsProvider()).toThrow(/forbidden in production/);
  });
});
