/**
 * SMS provider seam (real-estate HRMS §3, §9): OTP-adjacent notices, attendance
 * reminders and offboarding alerts can go by SMS through a replaceable provider.
 *
 * Twilio, Unifonic (common in the UAE) and AWS SNS each plug in here. Until one
 * is wired the factory returns the mock adapter, which logs the message and
 * returns a synthetic id without sending anything. `mock` is a PROVIDER_KEY, so
 * lib/startup-check refuses a production deployment that still has
 * SMS_PROVIDER=mock; a stub that reported "sent" would let a workflow believe a
 * person was notified when nobody was.
 */
import { logger } from '@/lib/logger';

export interface SmsMessage {
  /** E.164, e.g. +9715xxxxxxxx. Validated by the caller against the lead/employee. */
  to: string;
  body: string;
  /** Opaque reference back to our record, for delivery reconciliation. */
  referenceId?: string;
}

export interface SmsResult {
  provider: string;
  status: 'queued' | 'sent' | 'failed';
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

/** Mock adapter: logs and returns a synthetic id; sends nothing. */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';

  async send(message: SmsMessage): Promise<SmsResult> {
    logger.info(
      { provider: 'mock', action: 'send', to: message.to, reference: message.referenceId },
      'sms (mock adapter — no message was actually sent)',
    );
    return {
      provider: 'mock',
      status: 'queued',
      providerMessageId: `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

/**
 * The configured SMS provider. `SMS_PROVIDER` selects the vendor; the `mock`
 * adapter is refused in production so a live deployment cannot silently drop
 * every SMS while reporting success.
 */
export function getSmsProvider(): SmsProvider {
  // Live process.env, like the transcription provider, so the production guard
  // reflects the running environment rather than the import-frozen snapshot.
  const provider = process.env.SMS_PROVIDER ?? 'mock';
  switch (provider) {
    case 'mock':
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SMS_PROVIDER=mock is forbidden in production. Configure a real SMS provider.');
      }
      return new MockSmsProvider();
    // case 'twilio': return new TwilioSmsProvider(...)  ← real vendor slots in here
    default:
      throw new Error(`Unknown SMS provider: ${provider}`);
  }
}
