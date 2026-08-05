import { logger } from '../logger';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp provider abstraction
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  name: string;
  language: string;
  components?: { type: string; parameters: { type: string; text?: string }[] }[];
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

export interface WhatsAppProvider {
  name: string;
  sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult>;
  getMessageStatus(externalId: string): Promise<WhatsAppResult | null>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider for development
// ─────────────────────────────────────────────────────────────────────────────

export class MockWhatsAppProvider implements WhatsAppProvider {
  name = 'mock';

  async sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult> {
    const id = `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ provider: 'mock', action: 'sendTemplate', to: message.to, template: message.template.name }, 'whatsapp mock');
    return { externalMessageId: id, status: 'queued' };
  }

  async getMessageStatus(externalId: string): Promise<WhatsAppResult | null> {
    return { externalMessageId: externalId, status: 'delivered' };
  }

  verifyWebhookSignature(): boolean {
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

export class MetaWhatsAppProvider implements WhatsAppProvider {
  name = 'meta';
  private baseUrl: string;

  constructor(
    private accessToken: string,
    private phoneNumberId: string,
    private webhookVerifyToken?: string,
  ) {
    this.baseUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}`;
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

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logger.error({ provider: 'meta', status: res.status, err }, 'WhatsApp API error');
      return {
        externalMessageId: '',
        status: 'failed',
        errorCode: String(err.error?.code ?? res.status),
        errorMessage: err.error?.message ?? `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      externalMessageId: data.messages?.[0]?.id ?? '',
      status: 'queued',
    };
  }

  async getMessageStatus(externalId: string): Promise<WhatsAppResult | null> {
    // Meta doesn't have a GET status endpoint; status comes via webhooks.
    return { externalMessageId: externalId, status: 'queued' };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookVerifyToken) return false;
    // In production, verify HMAC-SHA256 of payload with app secret
    const crypto = require('node:crypto');
    const expected = crypto.createHmac('sha256', this.webhookVerifyToken).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(`sha256=${expected}`), Buffer.from(signature));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function getWhatsAppProvider(
  provider: string,
  config?: { accessToken?: string; phoneNumberId?: string; webhookVerifyToken?: string },
): WhatsAppProvider {
  if (provider === 'meta' && config?.accessToken && config?.phoneNumberId) {
    return new MetaWhatsAppProvider(config.accessToken, config.phoneNumberId, config.webhookVerifyToken);
  }
  return new MockWhatsAppProvider();
}
