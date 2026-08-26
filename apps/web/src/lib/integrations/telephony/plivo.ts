/**
 * Plivo.
 *
 * Plivo has no inline call-control parameter, so click-to-call needs an
 * `answer_url` the platform serves — see the `/answer` route beside the webhook.
 * Plivo rings the agent, fetches that URL on answer, and the XML it returns
 * bridges the client.
 *
 * Signature V3 covers the URL and a nonce, not the body, and the header may
 * carry several comma-separated signatures during a key rotation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { basic, vendorFetch } from './http';
import type {
  CallEvent,
  CallEventKind,
  CallRequest,
  CallResult,
  Capability,
  TelephonyProvider,
  WebhookRequest,
} from './types';

const API = 'https://api.plivo.com/v1/Account';

const STATUS: Record<string, CallEventKind> = {
  ringing: 'CALL_RINGING',
  'in-progress': 'CALL_CONNECTED',
  completed: 'CALL_COMPLETED',
  busy: 'CALL_BUSY',
  'no-answer': 'CALL_NO_ANSWER',
  timeout: 'CALL_NO_ANSWER',
  failed: 'CALL_FAILED',
  cancel: 'CALL_FAILED',
};

export class PlivoProvider implements TelephonyProvider {
  readonly name = 'plivo';
  /**
   * No CALL_STATUS or END_CALL.
   *
   * Both need the CallUUID Plivo assigns after the call is created, and the
   * create response returns only a RequestUUID. Storing a second identifier
   * would mean a schema column used by one vendor, so the honest answer is to
   * declare the capability absent and let the UI hide the buttons — §26.
   *
   * ponytail: add a `providerCallId` column and populate it from the first
   * callback if hang-up-from-the-app becomes a requirement.
   */
  readonly capabilities: readonly Capability[] = ['OUTBOUND_CALL', 'CLICK_TO_CALL', 'CALL_RECORDING', 'SIGNED_WEBHOOK'];

  constructor(
    private readonly authId: string,
    private readonly authToken: string,
  ) {
    if (!authId || !authToken) throw new Error('Plivo needs an auth ID and an auth token.');
  }

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const answerUrl = new URL(request.callbackUrl);
    answerUrl.pathname = `${answerUrl.pathname.replace(/\/$/, '')}/answer`;

    const data = await vendorFetch<{ request_uuid: string }>({
      vendor: this.name,
      url: `${API}/${this.authId}/Call/`,
      headers: { Authorization: basic(this.authId, this.authToken) },
      json: {
        to: request.agentNumber,
        from: request.from,
        answer_url: answerUrl.toString(),
        answer_method: 'POST',
        ring_url: request.callbackUrl,
        ring_method: 'POST',
        hangup_url: request.callbackUrl,
        hangup_method: 'POST',
      },
    });

    if (!data.request_uuid) throw new Error('Plivo did not return a request UUID.');
    return { externalCallId: data.request_uuid, event: 'CALL_INITIATED' };
  }

  async endCall(): Promise<void> {
    throw new Error('Plivo calls cannot be ended from the application — see capabilities.');
  }

  async getCallStatus(): Promise<CallEvent | null> {
    return null;
  }

  async getRecordingUrl(externalCallId: string): Promise<string | null> {
    const data = await vendorFetch<{ objects: { record_url: string }[] }>({
      vendor: this.name,
      url: `${API}/${this.authId}/Recording/?limit=1&call_uuid=${encodeURIComponent(externalCallId)}`,
      headers: { Authorization: basic(this.authId, this.authToken) },
      retry: true,
    });
    return data.objects?.[0]?.record_url ?? null;
  }

  validateWebhook(request: WebhookRequest): boolean {
    const supplied = request.headers.get('x-plivo-signature-v3');
    const nonce = request.headers.get('x-plivo-signature-v3-nonce');
    if (!supplied || !nonce) return false;

    // Plivo signs the URL without its query string, plus the nonce.
    const url = new URL(request.url);
    const expected = createHmac('sha256', this.authToken)
      .update(`${url.origin}${url.pathname}${url.search}${nonce}`, 'utf8')
      .digest();

    // Several signatures during a rotation, comma-separated.
    return supplied.split(',').some((one) => {
      const actual = Buffer.from(one.trim(), 'base64');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  }

  parseWebhook(request: WebhookRequest): CallEvent {
    const p = new URLSearchParams(request.rawBody);
    const requestUuid = p.get('RequestUUID');
    if (!requestUuid) throw new Error('Plivo callback has no RequestUUID.');

    const recordUrl = p.get('RecordUrl');
    if (recordUrl) {
      return {
        externalCallId: requestUuid,
        event: 'RECORDING_AVAILABLE',
        occurredAt: new Date(),
        durationSecs: num(p.get('RecordingDuration')),
        recordingUrl: recordUrl,
        deliveryId: p.get('RecordingID') ?? `${requestUuid}:recording`,
      };
    }

    // Ring callbacks say Event=Ring and carry no CallStatus.
    const raw = p.get('Event') === 'Ring' ? 'ringing' : (p.get('CallStatus') ?? '');
    const event = STATUS[raw];
    if (!event) throw new Error(`Plivo callback has an unrecognised CallStatus: ${raw.slice(0, 40)}`);

    return {
      externalCallId: requestUuid,
      event,
      occurredAt: new Date(),
      durationSecs: num(p.get('Duration')),
      talkSecs: num(p.get('BillDuration')),
      deliveryId: `${requestUuid}:${p.get('CallUUID') ?? ''}:${raw}`,
    };
  }
  /** Plivo serves recording media from its API host and its media CDN. */
  mediaHosts(): readonly string[] {
    return ['api.plivo.com', '.plivo.com'];
  }
}

const num = (value: string | null): number | undefined => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
