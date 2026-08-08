/**
 * Exotel.
 *
 * `Calls/connect` is click-to-call by construction: `From` is the agent, `To` is
 * the client, `CallerId` is the ExoPhone. There is no other outbound mode, which
 * is why the shared CallRequest carries `agentNumber` rather than treating it as
 * a Twilio-specific extra.
 *
 * Exotel does not sign its callbacks. Authentication is therefore the secret in
 * the URL — see `urlTokenValid`. Callback bodies arrive form-encoded from the
 * classic StatusCallback and JSON from the newer one, so the parser accepts both
 * and reads keys case-insensitively; Exotel's own documentation is inconsistent
 * about the casing.
 */
import { basic, urlTokenValid, vendorFetch } from './http';
import type {
  CallEvent,
  CallEventKind,
  CallRequest,
  CallResult,
  Capability,
  TelephonyProvider,
  WebhookRequest,
} from './types';

const STATUS: Record<string, CallEventKind> = {
  queued: 'CALL_INITIATED',
  'in-progress': 'CALL_CONNECTED',
  inprogress: 'CALL_CONNECTED',
  completed: 'CALL_COMPLETED',
  busy: 'CALL_BUSY',
  'no-answer': 'CALL_NO_ANSWER',
  'no answer': 'CALL_NO_ANSWER',
  failed: 'CALL_FAILED',
  canceled: 'CALL_FAILED',
};

export class ExotelProvider implements TelephonyProvider {
  readonly name = 'exotel';
  readonly capabilities: readonly Capability[] = ['OUTBOUND_CALL', 'CLICK_TO_CALL', 'CALL_RECORDING', 'CALL_STATUS'];

  private readonly base: string;

  constructor(
    private readonly accountSid: string,
    private readonly apiKey: string,
    private readonly apiToken: string,
    subdomain: string,
    private readonly callbackToken: string,
  ) {
    if (!accountSid || !apiKey || !apiToken) throw new Error('Exotel needs an account SID, API key and API token.');
    // Accepts `api.exotel.com`, `@singapore.exotel.com` or a full URL.
    const host =
      subdomain
        .replace(/^https?:\/\//, '')
        .replace(/^@/, '')
        .replace(/\/+$/, '') || 'api.exotel.com';
    this.base = `https://${host}/v1/Accounts/${accountSid}`;
  }

  private get auth() {
    return { Authorization: basic(this.apiKey, this.apiToken) };
  }

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const data = await vendorFetch<{ Call: { Sid: string; Status: string } }>({
      vendor: this.name,
      url: `${this.base}/Calls/connect.json`,
      headers: this.auth,
      form: {
        From: request.agentNumber,
        To: request.to,
        CallerId: request.from,
        CallType: 'trans',
        Record: request.recordingEnabled ? 'true' : 'false',
        StatusCallback: request.callbackUrl,
        StatusCallbackContentType: 'application/json',
      },
    });

    const sid = data.Call?.Sid;
    if (!sid) throw new Error('Exotel did not return a call SID.');
    return { externalCallId: sid, event: STATUS[String(data.Call.Status).toLowerCase()] ?? 'CALL_INITIATED' };
  }

  async endCall(): Promise<void> {
    throw new Error('Exotel calls cannot be ended from the application — see capabilities.');
  }

  async getCallStatus(externalCallId: string): Promise<CallEvent | null> {
    const data = await vendorFetch<{ Call: Record<string, unknown> }>({
      vendor: this.name,
      url: `${this.base}/Calls/${encodeURIComponent(externalCallId)}.json`,
      headers: this.auth,
      retry: true,
    });
    const call = data.Call ?? {};
    const event = STATUS[String(call.Status ?? '').toLowerCase()];
    if (!event) return null;
    return {
      externalCallId,
      event,
      occurredAt: new Date(),
      durationSecs: num(call.Duration),
      recordingUrl: typeof call.RecordingUrl === 'string' ? call.RecordingUrl : undefined,
      deliveryId: `poll:${externalCallId}:${String(call.Status)}`,
    };
  }

  async getRecordingUrl(externalCallId: string): Promise<string | null> {
    return (await this.getCallStatus(externalCallId))?.recordingUrl ?? null;
  }

  validateWebhook(request: WebhookRequest): boolean {
    return urlTokenValid(request.url, this.callbackToken);
  }

  parseWebhook(request: WebhookRequest): CallEvent {
    const p = readBody(request);
    const externalCallId = p.callsid;
    if (!externalCallId) throw new Error('Exotel callback has no CallSid.');

    const status = String(p.status ?? '').toLowerCase();
    const event = STATUS[status];
    if (!event) throw new Error(`Exotel callback has an unrecognised Status: ${status.slice(0, 40)}`);

    const recordingUrl = p.recordingurl;
    return {
      externalCallId,
      event,
      occurredAt: p.endtime && !Number.isNaN(Date.parse(p.endtime)) ? new Date(p.endtime) : new Date(),
      durationSecs: num(p.dialcallduration ?? p.duration),
      talkSecs: num(p.conversationduration),
      recordingUrl: recordingUrl && /^https:\/\//i.test(recordingUrl) ? recordingUrl : undefined,
      // Exotel sends no delivery id, and re-sends the terminal callback on
      // failure. Keying on the call and its status makes a genuine re-send a
      // no-op while still letting the call progress through its states.
      deliveryId: `${externalCallId}:${status}`,
    };
  }
}

/** Form-encoded or JSON, keys lowercased, values stringified. */
function readBody(request: WebhookRequest): Record<string, string | undefined> {
  const contentType = request.headers.get('content-type') ?? '';
  const flat: Record<string, string | undefined> = {};

  if (contentType.includes('json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody);
    } catch {
      throw new Error('Exotel callback body is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Exotel callback body is not an object.');
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value != null && typeof value !== 'object') flat[key.toLowerCase()] = String(value);
    }
    return flat;
  }

  for (const [key, value] of new URLSearchParams(request.rawBody)) flat[key.toLowerCase()] = value;
  return flat;
}

const num = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
