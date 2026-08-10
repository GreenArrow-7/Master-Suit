/**
 * E-signature provider seam (real-estate HRMS §3, §9): offer letters, contracts
 * and policy acknowledgements are signed through a replaceable provider, so the
 * signing vendor can be swapped without touching the onboarding flow.
 *
 * There is no production adapter yet — DocuSign, Adobe Sign and Zoho Sign each
 * plug in here — so the factory returns the `mock` adapter, which records a
 * signature intent and a locally-generated envelope id without contacting
 * anyone. `mock` is a PROVIDER_KEY, so a production deployment that still has
 * ESIGNATURE_PROVIDER=mock is refused at boot by lib/startup-check; the guard
 * here is the same rule enforced a second time at the call site, because a real
 * offer marked signed by a stub is a legal document with no signature behind
 * it — worse than an unsigned one, because it looks done.
 */
import { logger } from '@/lib/logger';

export interface SignatureRequest {
  /** Who signs: the candidate or employee. */
  signerName: string;
  signerEmail: string;
  /** What they sign — an offer, a contract, an NDA, a policy. */
  documentTitle: string;
  /** Opaque reference back to our record (offer id, document id). */
  referenceId: string;
  /** The rendered document to sign, when the provider needs the bytes. */
  documentBytes?: Buffer;
}

export interface SignatureEnvelope {
  /** The provider's id for the signing session, stored against our record. */
  envelopeId: string;
  provider: string;
  status: 'created' | 'sent' | 'completed' | 'declined' | 'error';
  /** Where the signer goes to sign, when the provider hosts the ceremony. */
  signingUrl?: string;
  errorMessage?: string;
}

export interface ESignatureProvider {
  readonly name: string;
  /** Open a signing session and return its envelope. */
  createEnvelope(request: SignatureRequest): Promise<SignatureEnvelope>;
  /** Current state of a session, for polling when no webhook is configured. */
  getStatus(envelopeId: string): Promise<SignatureEnvelope>;
}

/**
 * Mock adapter. Marks an envelope created (never completed on its own), so a
 * human still has to drive completion — a stub that auto-completed would let
 * the onboarding flow believe a real signature exists.
 */
export class MockESignatureProvider implements ESignatureProvider {
  readonly name = 'mock';

  async createEnvelope(request: SignatureRequest): Promise<SignatureEnvelope> {
    const envelopeId = `mock_sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info(
      { provider: 'mock', action: 'createEnvelope', reference: request.referenceId, signer: request.signerEmail },
      'e-signature (mock adapter — no document was actually sent)',
    );
    return { envelopeId, provider: 'mock', status: 'created' };
  }

  async getStatus(envelopeId: string): Promise<SignatureEnvelope> {
    return { envelopeId, provider: 'mock', status: 'created' };
  }
}

/**
 * The configured provider. `ESIGNATURE_PROVIDER` selects the vendor; the `mock`
 * adapter is refused when NODE_ENV is production — the same rule the boot-time
 * check applies across every provider — so a live deployment cannot silently
 * sign nothing.
 */
export function getESignatureProvider(): ESignatureProvider {
  // Read live process.env (not the import-frozen `env`) so the production guard
  // reflects the running environment — the same approach the transcription
  // provider takes for its mock-forbidden-in-prod rule.
  const provider = process.env.ESIGNATURE_PROVIDER ?? 'mock';
  switch (provider) {
    case 'mock':
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ESIGNATURE_PROVIDER=mock is forbidden in production. Configure a real e-signature provider.');
      }
      return new MockESignatureProvider();
    // case 'docusign': return new DocuSignProvider(...)  ← real vendor slots in here
    default:
      throw new Error(`Unknown e-signature provider: ${provider}`);
  }
}
