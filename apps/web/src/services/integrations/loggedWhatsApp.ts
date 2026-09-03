/**
 * A WhatsApp provider that writes down what it sent, and what Meta said back.
 *
 * Same shape and same reason as `loggedTelephony`: `getWhatsAppProvider` is a
 * pure factory taking credentials, with no tenant to attribute anything to, so
 * the wrapping happens where a tenant and a provider are both in scope.
 *
 * One difference that matters. A send can fail without throwing — the Cloud API
 * answers with a `failed` status and an error code in the body, and the provider
 * faithfully returns it rather than raising. A wrapper that keyed off exceptions
 * alone would file every one of those as a success, which is precisely the class
 * of silent failure §33 is about. So the result is inspected as well.
 */
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppResult } from '@/lib/integrations/whatsapp';

import { categoriseIntegrationError, recordIntegrationEvent } from './eventLog';

async function send(
  tenantId: string,
  provider: WhatsAppProvider,
  operation: string,
  run: () => Promise<WhatsAppResult>,
): Promise<WhatsAppResult> {
  const startedAt = Date.now();
  const common = {
    tenantId,
    // The vendor, not the adapter: a mock send must not be filed as Meta traffic.
    provider: provider.name === 'meta' ? 'meta' : provider.name,
    direction: 'OUTBOUND' as const,
    operation,
  };

  try {
    const result = await run();
    const failed = result.status === 'failed';
    await recordIntegrationEvent({
      ...common,
      outcome: failed ? 'FAILED' : 'OK',
      durationMs: Date.now() - startedAt,
      externalId: result.externalMessageId,
      ...(failed
        ? {
            // No HTTP status to read — the call returned 200 and the refusal is
            // in the body, which is why the category comes from the text.
            errorCategory: categoriseIntegrationError(new Error(result.errorMessage ?? result.errorCode ?? 'failed')),
            detail:
              [result.errorCode, result.errorMessage].filter(Boolean).join(': ') || 'the provider reported failed',
          }
        : {}),
    });
    return result;
  } catch (err) {
    await recordIntegrationEvent({
      ...common,
      outcome: 'FAILED',
      errorCategory: categoriseIntegrationError(err),
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

export function loggedWhatsApp(provider: WhatsAppProvider, tenantId: string): WhatsAppProvider {
  return {
    name: provider.name,
    sendTemplate: (message: WhatsAppMessage) =>
      send(tenantId, provider, 'sendTemplate', () => provider.sendTemplate(message)),
    sendText: (to: string, body: string) => send(tenantId, provider, 'sendText', () => provider.sendText(to, body)),
    // Reads and signature checks are left alone. A status poll produces no
    // traffic worth a row, and the two verifiers never leave the process.
    getMessageStatus: provider.getMessageStatus.bind(provider),
    verifyWebhookSignature: provider.verifyWebhookSignature.bind(provider),
    verifySubscription: provider.verifySubscription.bind(provider),
  };
}
