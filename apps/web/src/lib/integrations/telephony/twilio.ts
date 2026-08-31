/**
 * Twilio.
 *
 * Outbound is driven as click-to-call: Twilio rings the agent, and the inline
 * TwiML bridges the client on answer. `record="record-from-answer-dual"` means
 * the media that exists is the conversation, not the agent listening to ringing,
 * and it starts only once both legs are up.
 *
 * Callbacks are form-encoded and signed over the URL plus the sorted parameters,
 * which is why `validateWebhook` needs the exact URL Twilio was configured with —
 * a proxy that rewrites the host breaks the signature, and that is the intended
 * behaviour rather than something to work around.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { basic, vendorFetch, xml } from './http';
import type {
  CallEvent,
  CallEventKind,
  CallRequest,
  CallResult,
  Capability,
  TelephonyProvider,
  WebhookRequest,
} from './types';

const API = 'https://api.twilio.com/2010-04-01';

const STATUS: Record<string, CallEventKind> = {
  queued: 'CALL_INITIATED',
  initiated: 'CALL_INITIATED',
  ringing: 'CALL_RINGING',
  'in-progress': 'CALL_CONNECTED',
  answered: 'CALL_CONNECTED',
  completed: 'CALL_COMPLETED',
  busy: 'CALL_BUSY',
  'no-answer': 'CALL_NO_ANSWER',
  failed: 'CALL_FAILED',
  canceled: 'CALL_FAILED',
};

export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  readonly capabilities: readonly Capability[] = [
    'OUTBOUND_CALL',
    'CLICK_TO_CALL',
    'CALL_RECORDING',
    'CALL_STATUS',
    'END_CALL',
    'SIGNED_WEBHOOK',
    'LIVE_STREAM',
  ];

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
  ) {
    if (!accountSid || !authToken) throw new Error('Twilio needs an account SID and an auth token.');
  }

  private get auth() {
    return { Authorization: basic(this.accountSid, this.authToken) };
  }

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const dial = request.recordingEnabled
      ? `<Dial callerId="${xml(request.from)}" record="record-from-answer-dual" recordingStatusCallback="${xml(request.callbackUrl)}" recordingStatusCallbackEvent="completed absent">${xml(request.to)}</Dial>`
      : `<Dial callerId="${xml(request.from)}">${xml(request.to)}</Dial>`;

    // Media Streams: fork the call audio to the realtime engine. `<Start>` runs
    // before `<Dial>`, both_tracks so the agent (inbound) and the client
    // (outbound) arrive separately attributed; the parameters ride the stream's
    // start event so the engine can authenticate it without a callback.
    const stream = request.stream
      ? `<Start><Stream url="${xml(request.stream.url)}" track="both_tracks">${Object.entries(request.stream.parameters)
          .map(([name, value]) => `<Parameter name="${xml(name)}" value="${xml(value)}"/>`)
          .join('')}</Stream></Start>`
      : '';

    const data = await vendorFetch<{ sid: string; status: string }>({
      vendor: this.name,
      url: `${API}/Accounts/${this.accountSid}/Calls.json`,
      headers: this.auth,
      form: {
        To: request.agentNumber,
        From: request.from,
        Twiml: `<Response>${stream}${dial}</Response>`,
        StatusCallback: request.callbackUrl,
        StatusCallbackMethod: 'POST',
        StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      },
    });

    return { externalCallId: data.sid, event: STATUS[data.status] ?? 'CALL_INITIATED' };
  }

  async endCall(externalCallId: string): Promise<void> {
    await vendorFetch({
      vendor: this.name,
      url: `${API}/Accounts/${this.accountSid}/Calls/${encodeURIComponent(externalCallId)}.json`,
      headers: this.auth,
      form: { Status: 'completed' },
    });
  }

  async getCallStatus(externalCallId: string): Promise<CallEvent | null> {
    const data = await vendorFetch<{ sid: string; status: string; duration: string | null; end_time: string | null }>({
      vendor: this.name,
      url: `${API}/Accounts/${this.accountSid}/Calls/${encodeURIComponent(externalCallId)}.json`,
      headers: this.auth,
      retry: true,
    });
    const event = STATUS[data.status];
    if (!event) return null;
    return {
      externalCallId: data.sid,
      event,
      occurredAt: data.end_time ? new Date(data.end_time) : new Date(),
      durationSecs: data.duration ? Number(data.duration) : undefined,
      deliveryId: `poll:${data.sid}:${data.status}`,
    };
  }

  async getRecordingUrl(externalCallId: string): Promise<string | null> {
    const data = await vendorFetch<{ recordings: { sid: string }[] }>({
      vendor: this.name,
      url: `${API}/Accounts/${this.accountSid}/Calls/${encodeURIComponent(externalCallId)}/Recordings.json`,
      headers: this.auth,
      retry: true,
    });
    const sid = data.recordings?.[0]?.sid;
    return sid ? `${API}/Accounts/${this.accountSid}/Recordings/${sid}.mp3` : null;
  }

  /** Basic auth is also what fetches the media, so the ingest worker can reach it. */
  mediaHeaders(): Record<string, string> {
    return this.auth;
  }

  validateWebhook(request: WebhookRequest): boolean {
    const supplied = request.headers.get('x-twilio-signature');
    if (!supplied) return false;

    // Twilio signs the URL with the POST parameters appended in key order. For a
    // JSON body it signs the URL with a bodySHA256 query parameter instead.
    const contentType = request.headers.get('content-type') ?? '';
    let payload = request.url;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(request.rawBody);
      for (const key of [...params.keys()].sort()) payload += key + params.getAll(key).join('');
    } else {
      const digest = createHash('sha256').update(request.rawBody).digest('hex');
      const url = new URL(request.url);
      if (url.searchParams.get('bodySHA256') !== digest) return false;
    }

    const expected = createHmac('sha1', this.authToken).update(payload, 'utf8').digest();
    const actual = Buffer.from(supplied, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  parseWebhook(request: WebhookRequest): CallEvent {
    const p = new URLSearchParams(request.rawBody);
    const callSid = p.get('CallSid');
    if (!callSid) throw new Error('Twilio callback has no CallSid.');

    // Recording callbacks arrive on the same URL and carry RecordingStatus.
    const recordingStatus = p.get('RecordingStatus');
    if (recordingStatus) {
      const recordingSid = p.get('RecordingSid') ?? '';
      return {
        externalCallId: callSid,
        event: recordingStatus === 'completed' ? 'RECORDING_AVAILABLE' : 'RECORDING_FAILED',
        occurredAt: new Date(),
        durationSecs: num(p.get('RecordingDuration')),
        // `.mp3` rather than the bare resource URL: the bare one 302s to a
        // short-lived S3 link, and the ingest worker wants the media directly.
        recordingUrl: recordingStatus === 'completed' ? `${p.get('RecordingUrl')}.mp3` : undefined,
        deliveryId: recordingSid || `${callSid}:recording:${recordingStatus}`,
      };
    }

    const status = p.get('CallStatus') ?? '';
    const event = STATUS[status];
    if (!event) throw new Error(`Twilio callback has an unrecognised CallStatus: ${status.slice(0, 40)}`);

    const timestamp = p.get('Timestamp');
    return {
      externalCallId: callSid,
      event,
      occurredAt: timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp) : new Date(),
      durationSecs: num(p.get('CallDuration')),
      // SequenceNumber is per-call and monotonic, so it is the delivery identity
      // Twilio does not otherwise provide.
      deliveryId: `${callSid}:${p.get('SequenceNumber') ?? status}`,
    };
  }
  /** Twilio serves recording media from its API host and its media CDN. */
  mediaHosts(): readonly string[] {
    return ['api.twilio.com', '.twiliocdn.com'];
  }
}

const num = (value: string | null): number | undefined => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
