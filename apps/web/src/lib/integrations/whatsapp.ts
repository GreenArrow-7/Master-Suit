import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger';

/**
 * Hard ceiling on one provider round-trip. A hung provider must fail the one
 * feature that needed it, not hold a connection (and on the request path, a
 * request) open indefinitely — graceful degradation starts with a deadline.
 */
const PROVIDER_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp provider abstraction
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  name: string;
  language: string;
  /**
   * `sub_type` and `index` are required for button components and meaningless
   * for body ones. Meta's dynamic-URL buttons are how a per-recipient link
   * reaches a template — the alternative, putting the URL in a body parameter,
   * is rejected at template review for exactly the phishing reason you would
   * expect.
   */
  components?: {
    type: string;
    sub_type?: string;
    index?: string;
    parameters: { type: string; text?: string }[];
  }[];
}

export interface WhatsAppMessage {
  to: string;
  template: WhatsAppTemplate;
}

export interface WhatsAppResult {
  externalMessageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppStatusUpdate {
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
  errorCode?: string;
}

/**
 * How long after the customer's last inbound message a free-form reply is
 * permitted (§32).
 *
 * Meta calls this the customer service window: it opens when a WhatsApp user
 * messages or calls the business, lasts 24 hours, and resets each time they make
 * contact again. Outside it, only an approved template may be sent — so this is
 * a provider rule the product must enforce, not a nicety. Sending free-form
 * outside the window is rejected by Meta, and pretending otherwise would show an
 * agent a sent message the customer never receives.
 *
 * Verified against developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when a free-form reply is allowed, given the customer's last inbound message. */
export function serviceWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

export interface WhatsAppProvider {
  name: string;
  sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult>;
  /** Free-form service message. Only legal inside the customer service window. */
  sendText(to: string, body: string): Promise<WhatsAppResult>;
  getMessageStatus(externalId: string): Promise<WhatsAppResult | null>;
  /** Authenticates an event POST. Keyed with the app secret — see the class below. */
  verifyWebhookSignature(payload: string, signature: string): boolean;
  /**
   * Answers Meta's GET subscription handshake. A separate secret from the one
   * above and a separate question: this proves *we* configured the endpoint,
   * signature verification proves *Meta* sent the payload.
   */
  verifySubscription(token: string): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider for development
// ─────────────────────────────────────────────────────────────────────────────

export class MockWhatsAppProvider implements WhatsAppProvider {
  name = 'mock';

  async sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult> {
    const id = `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info(
      { provider: 'mock', action: 'sendTemplate', to: message.to, template: message.template.name },
      'whatsapp mock',
    );
    return { externalMessageId: id, status: 'queued' };
  }

  async sendText(to: string, body: string): Promise<WhatsAppResult> {
    logger.info({ provider: 'mock', action: 'sendText', to, length: body.length }, 'whatsapp mock');
    return { externalMessageId: `mock_wa_${to}_${body.length}`, status: 'queued' };
  }

  async getMessageStatus(externalId: string): Promise<WhatsAppResult | null> {
    return { externalMessageId: externalId, status: 'delivered' };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  verifySubscription(): boolean {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Business API provider (Meta Cloud API)
//
// Setup:
//   1. Create a Meta Business account and WhatsApp Business app
//   2. Get a permanent access token (System User token)
//   3. Register your phone number
//   4. Create and get approved message templates
//   5. Store token in IntegrationConnection table
//   6. Set WHATSAPP_PHONE_NUMBER_ID in .env
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Graph API version, in one place because Meta sunsets each one roughly two
 * years after release. v26.0 shipped 2026-07-29; v25.0 runs to 2028-07-29.
 * Verified against developers.facebook.com/docs/graph-api/changelog.
 */
const GRAPH_VERSION = 'v26.0';

export interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  /** Signs event payloads. Meta app dashboard → App settings → Basic. */
  appSecret?: string;
  /** Echoed back on the GET subscription handshake only. */
  webhookVerifyToken?: string;
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  name = 'meta';
  private baseUrl: string;

  constructor(private config: MetaWhatsAppConfig) {
    this.baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}`;
  }

  async sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: message.template.name,
        language: { code: message.template.language },
        components: message.template.components,
      },
    };

    return this.post(body);
  }

  /**
   * Free-form text. The caller is responsible for the service window — this
   * cannot check it, because only the conversation knows when the customer last
   * wrote. Meta rejects a free-form message sent outside the window, so calling
   * this without checking produces a failed send, not a silent one.
   */
  async sendText(to: string, body: string): Promise<WhatsAppResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body },
    });
  }

  private async post(body: unknown): Promise<WhatsAppResult> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // The vendor's message is kept, not replaced with a generic one: §33 asks
      // for the failure reason where the provider gives a usable one.
      logger.error({ provider: 'meta', status: res.status, err }, 'WhatsApp API error');
      return {
        externalMessageId: '',
        status: 'failed',
        errorCode: String(err.error?.code ?? res.status),
        errorMessage: err.error?.message ?? `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return { externalMessageId: data.messages?.[0]?.id ?? '', status: 'queued' };
  }

  async getMessageStatus(externalId: string): Promise<WhatsAppResult | null> {
    // Meta doesn't have a GET status endpoint; status comes via webhooks.
    return { externalMessageId: externalId, status: 'queued' };
  }

  /**
   * Keyed with the **app secret**, not the verify token.
   *
   * It used to key this HMAC with `webhookVerifyToken`, which is a different
   * secret answering a different question. Meta computes X-Hub-Signature-256 as
   * HMAC-SHA256 of the raw body under the app secret; the verify token is only
   * ever echoed back during the GET subscription handshake and never signs
   * anything. Keyed wrongly, this rejects every genuine callback — and if an
   * operator had pasted the app secret into the verify-token field to make
   * delivery work, the handshake would then be answering with the app secret in
   * a query string. Two secrets, two fields, two methods.
   *
   * Docs: developers.facebook.com/docs/graph-api/webhooks/getting-started
   *
   * The payload must be the raw request body, before JSON parsing: re-serialising
   * a parsed object reorders keys and changes whitespace, and the signature is
   * over bytes.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.config.appSecret) return false;
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', this.config.appSecret).update(payload).digest('hex')}`,
    );
    const supplied = Buffer.from(signature);
    // timingSafeEqual throws RangeError when the lengths differ, so a malformed
    // signature raised a 500 instead of being rejected. Compare lengths first —
    // that comparison leaks only the length, which is fixed for a real one.
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  verifySubscription(token: string): boolean {
    if (!this.config.webhookVerifyToken) return false;
    const expected = Buffer.from(this.config.webhookVerifyToken);
    const supplied = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function getWhatsAppProvider(
  provider: string,
  config?: Partial<MetaWhatsAppConfig>,
): WhatsAppProvider {
  if (provider === 'meta' && config?.accessToken && config?.phoneNumberId) {
    return new MetaWhatsAppProvider({ ...config, accessToken: config.accessToken, phoneNumberId: config.phoneNumberId });
  }
  return new MockWhatsAppProvider();
}
