/**
 * Knowlarity.
 *
 * Kept as its own adapter rather than folded into Exotel: they are both Indian
 * click-to-call vendors and both unsigned, but the request is JSON with two
 * bearer headers rather than form-encoded basic auth, the identifier is
 * `call_id` rather than a SID, and the outcome vocabulary is
 * `dispatch_status`, which has no overlap with Exotel's. Sharing one adapter
 * would be a class with a vendor flag in every method — the thing §1 forbids.
 *
 * Knowlarity does not sign its callbacks. Authentication is the secret in the
 * URL, exactly as for Exotel, and is documented as weaker than a signature.
 */
import { urlTokenValid, vendorFetch } from './http';
import type {
  CallEvent,
  CallEventKind,
  CallRequest,
  CallResult,
  Capability,
  TelephonyProvider,
  WebhookRequest,
} from './types';

const API = 'https://kpi.knowlarity.com/Basic/v1/account';

const STATUS: Record<string, CallEventKind> = {
  answered: 'CALL_COMPLETED',
  completed: 'CALL_COMPLETED',
  connected: 'CALL_CONNECTED',
  ringing: 'CALL_RINGING',
  not_answered: 'CALL_NO_ANSWER',
  'not answered': 'CALL_NO_ANSWER',
  missed: 'CALL_NO_ANSWER',
  busy: 'CALL_BUSY',
  failed: 'CALL_FAILED',
  cancelled: 'CALL_FAILED',
};

export class KnowlarityProvider implements TelephonyProvider {
  readonly name = 'knowlarity';
  readonly capabilities: readonly Capability[] = ['OUTBOUND_CALL', 'CLICK_TO_CALL', 'CALL_RECORDING'];

  constructor(
    private readonly srNumber: string,
    private readonly apiKey: string,
    private readonly authToken: string,
    private readonly callbackToken: string,
  ) {
    if (!srNumber || !apiKey || !authToken) throw new Error('Knowlarity needs an SR number, API key and token.');
  }

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const data = await vendorFetch<{ success?: { call_id?: string | number }; error?: unknown }>({
      vendor: this.name,
      url: `${API}/call/makecall`,
      headers: { 'x-api-key': this.apiKey, authorization: this.authToken },
      json: {
        k_number: this.srNumber,
        agent_number: request.agentNumber,
        customer_number: request.to,
        caller_id: request.from,
        // Knowlarity has no per-call callback parameter: the callback URL is set
        // on the account in their panel. Passed through so the delivery can be
        // correlated even when their panel is pointed at a shared endpoint.
        additional_params: JSON.stringify({ callback: request.callbackUrl }),
      },
    });

    const callId = data.success?.call_id;
    if (callId == null) throw new Error('Knowlarity did not return a call id.');
    return { externalCallId: String(callId), event: 'CALL_INITIATED' };
  }

  async endCall(): Promise<void> {
    throw new Error('Knowlarity calls cannot be ended from the application — see capabilities.');
  }

  async getCallStatus(): Promise<CallEvent | null> {
    // Their call-log API is paginated by date range with no lookup by call id,
    // so a single-call poll would mean scanning a day of logs.
    // ponytail: only worth building if a reconciliation job needs it.
    return null;
  }

  async getRecordingUrl(): Promise<string | null> {
    return null;
  }

  validateWebhook(request: WebhookRequest): boolean {
    return urlTokenValid(request.url, this.callbackToken);
  }

  parseWebhook(request: WebhookRequest): CallEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody);
    } catch {
      throw new Error('Knowlarity callback body is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Knowlarity callback body is not an object.');
    const p = parsed as Record<string, unknown>;

    const externalCallId = String(p.call_id ?? p.uuid ?? '').trim();
    if (!externalCallId) throw new Error('Knowlarity callback has no call_id.');

    const status = String(p.dispatch_status ?? p.call_status ?? '')
      .trim()
      .toLowerCase();
    const event = STATUS[status];
    if (!event) throw new Error(`Knowlarity callback has an unrecognised dispatch_status: ${status.slice(0, 40)}`);

    const recordingUrl = typeof p.recording_url === 'string' ? p.recording_url : undefined;
    const startTime = typeof p.start_time === 'string' ? p.start_time : undefined;

    return {
      externalCallId,
      event,
      occurredAt: startTime && !Number.isNaN(Date.parse(startTime)) ? new Date(startTime) : new Date(),
      durationSecs: num(p.call_duration),
      recordingUrl: recordingUrl && /^https:\/\//i.test(recordingUrl) ? recordingUrl : undefined,
      deliveryId: `${externalCallId}:${status}`,
    };
  }
  /** Knowlarity serves recording media from its own domain. */
  mediaHosts(): readonly string[] {
    return ['.knowlarity.com'];
  }
}

const num = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
