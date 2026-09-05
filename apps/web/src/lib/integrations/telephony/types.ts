/**
 * The contract every calling vendor is reduced to.
 *
 * Business logic never imports a vendor module and never branches on a vendor
 * name. It asks `resolveTelephony(tenantId)` for a provider and calls this
 * interface; which company is on Twilio and which is on Exotel is a row in the
 * database, not a code path.
 */

export const TELEPHONY_VENDORS = ['twilio', 'exotel', 'knowlarity', 'plivo'] as const;
export type TelephonyVendor = (typeof TELEPHONY_VENDORS)[number];

export const isTelephonyVendor = (value: string): value is TelephonyVendor =>
  (TELEPHONY_VENDORS as readonly string[]).includes(value);

/**
 * What a vendor can actually do. The UI disables what is absent rather than
 * offering a button that returns a 500 — vendors genuinely differ here, and
 * "Exotel cannot hang up a call from the API" is a product fact, not a bug.
 */
export type Capability =
  | 'OUTBOUND_CALL'
  | 'CLICK_TO_CALL'
  | 'CALL_RECORDING'
  | 'CALL_STATUS'
  | 'END_CALL'
  | 'SIGNED_WEBHOOK'
  /** The vendor can fork live call audio to a WebSocket (Twilio Media Streams). */
  | 'LIVE_STREAM';

export interface CallRequest {
  /** The number the client sees. A vendor-provisioned virtual number. */
  from: string;
  /** The client. */
  to: string;
  /**
   * The employee's handset.
   *
   * Every vendor here is used click-to-call: the platform rings the agent first
   * and bridges the client on answer, so nobody's personal number is exposed and
   * the leg the vendor records is the whole conversation. Exotel and Knowlarity
   * have no other outbound mode; Twilio and Plivo are driven into the same shape
   * with inline call control so all four behave identically to the caller above.
   */
  agentNumber: string;
  /** Where status and recording callbacks are delivered. */
  callbackUrl: string;
  recordingEnabled?: boolean;
  /**
   * Fork live call audio to this WebSocket for real-time coaching. Only acted
   * on by vendors with the LIVE_STREAM capability; the parameters travel in the
   * stream's start event so the engine can authenticate and attribute it.
   */
  stream?: { url: string; parameters: Record<string, string> };
}

/**
 * The vendor-neutral vocabulary the application stores and reasons about.
 * `parseWebhook` is the only place a vendor's own status string is allowed to
 * exist; everything downstream consumes these.
 */
export type CallEventKind =
  | 'CALL_INITIATED'
  | 'CALL_RINGING'
  | 'CALL_CONNECTED'
  | 'CALL_COMPLETED'
  | 'CALL_FAILED'
  | 'CALL_BUSY'
  | 'CALL_NO_ANSWER'
  | 'RECORDING_AVAILABLE'
  | 'RECORDING_FAILED';

/** Terminal states, so an out-of-order callback cannot reopen a finished call. */
export const TERMINAL_EVENTS: readonly CallEventKind[] = [
  'CALL_COMPLETED',
  'CALL_FAILED',
  'CALL_BUSY',
  'CALL_NO_ANSWER',
];

export interface CallResult {
  /** The vendor's identifier. Never this application's primary key. */
  externalCallId: string;
  event: CallEventKind;
}

export interface CallEvent {
  externalCallId: string;
  event: CallEventKind;
  occurredAt: Date;
  /** Seconds spent ringing before answer, where the vendor reports it. */
  ringSecs?: number;
  /** Total leg time including ring, where the vendor reports it. */
  durationSecs?: number;
  /** Conversation time excluding ring, where the vendor reports it. */
  talkSecs?: number;
  /** Vendor-hosted media. Fetched into our own bucket; never shown to a user. */
  recordingUrl?: string;
  /**
   * The vendor's delivery identifier, used as the idempotency key. Vendors that
   * do not send one get a content hash — a genuine retry of the same event is
   * then deduplicated, and two distinct events never collide.
   */
  deliveryId: string;
}

/** The raw request as it arrived, because signatures cover the URL, not just the body. */
export interface WebhookRequest {
  /** The absolute URL the vendor signed, exactly as configured on their side. */
  url: string;
  rawBody: string;
  headers: Headers;
}

export interface TelephonyProvider {
  readonly name: string;
  readonly capabilities: readonly Capability[];
  initiateCall(request: CallRequest): Promise<CallResult>;
  endCall(externalCallId: string): Promise<void>;
  getCallStatus(externalCallId: string): Promise<CallEvent | null>;
  getRecordingUrl(externalCallId: string): Promise<string | null>;
  /**
   * Headers needed to fetch vendor-hosted media. Twilio's recording URLs require
   * the same basic auth as its API; the others are unauthenticated links. Absent
   * means "fetch it plainly".
   */
  mediaHeaders?(): Record<string, string>;
  /**
   * Hosts this vendor serves recording media from.
   *
   * Consulted by `assertFetchableUrl` before the media worker fetches a URL the
   * vendor supplied in a webhook. A leading dot means "and its subdomains".
   *
   * Defaults live with each provider because they are facts about that vendor,
   * and are overridable by RECORDING_URL_ALLOWED_HOSTS because a CDN change at
   * the vendor's end must not require a deploy here to keep ingesting.
   */
  mediaHosts?(): readonly string[];
  /**
   * Authenticates the delivery. Never throws — an unauthenticated webhook is a
   * `false`, and the route answers 401 without touching the database again.
   */
  validateWebhook(request: WebhookRequest): boolean;
  /** Throws on a malformed payload; the route answers 400. */
  parseWebhook(request: WebhookRequest): CallEvent;
}

export class TelephonyConfigError extends Error {}

/** Vendors that cannot sign their callbacks, so the URL secret is the only credential. */
export const UNSIGNED_VENDORS: readonly TelephonyVendor[] = ['exotel', 'knowlarity'];

/**
 * Credential and setting keys each vendor needs, so one registry drives the
 * admin form, the validation and the connection test. Adding a vendor means
 * adding an adapter and one entry here — never a new form component.
 */
export interface VendorField {
  key: string;
  label: string;
  /** Secret fields are encrypted at rest and never returned by any API. */
  secret: boolean;
  hint?: string;
}

export const VENDOR_FIELDS: Record<TelephonyVendor, VendorField[]> = {
  twilio: [
    { key: 'accountSid', label: 'Account SID', secret: false, hint: 'Starts with AC' },
    { key: 'authToken', label: 'Auth token', secret: true },
  ],
  exotel: [
    { key: 'accountSid', label: 'Account SID', secret: false },
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'apiToken', label: 'API token', secret: true },
    { key: 'subdomain', label: 'API subdomain', secret: false, hint: 'e.g. api.exotel.com or @singapore' },
  ],
  knowlarity: [
    { key: 'srNumber', label: 'SR number (K-number)', secret: false },
    { key: 'apiKey', label: 'x-api-key', secret: true },
    { key: 'authToken', label: 'Authorization token', secret: true },
  ],
  plivo: [
    { key: 'authId', label: 'Auth ID', secret: false },
    { key: 'authToken', label: 'Auth token', secret: true },
  ],
};
