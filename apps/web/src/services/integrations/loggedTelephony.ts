/**
 * A telephony provider that writes down what it did.
 *
 * A decorator rather than instrumentation inside the four vendor adapters, for
 * two reasons. The adapters are built by `telephonyProvider()`, which is
 * documented as pure — no database, no environment beyond the pepper — and is
 * also called with fake credentials by `vendorCapabilities` to read capability
 * flags; a logging call inside them would break the first and write nonsense
 * rows from the second. And the adapters have no tenant: they are constructed
 * from credentials alone, so recording from within would mean threading a
 * tenantId through the provider interface and all four implementations.
 *
 * `resolveTelephony` is the seam where a tenant and a provider meet, so the
 * wrapping happens there and the adapters stay unaware.
 *
 * Only the four methods that cross the network are wrapped. `validateWebhook`,
 * `parseWebhook`, `mediaHeaders` and `mediaHosts` are local computation and
 * logging them would bury the calls that can actually fail.
 */
import { withIntegrationEvent } from './eventLog';
import type { CallEvent, CallRequest, CallResult, TelephonyProvider } from '@/lib/integrations/telephony/types';

export function loggedTelephony(provider: TelephonyProvider, tenantId: string): TelephonyProvider {
  const scope = (operation: string, describe?: (result: unknown) => { externalId?: string | null }) => ({
    tenantId,
    provider: provider.name,
    direction: 'OUTBOUND' as const,
    operation,
    describe,
  });

  return {
    // Not spread from `provider`: `name` and `capabilities` are getters on the
    // adapters, and spreading would freeze them into plain values here.
    get name() {
      return provider.name;
    },
    get capabilities() {
      return provider.capabilities;
    },

    initiateCall: (request: CallRequest): Promise<CallResult> =>
      withIntegrationEvent(
        scope('initiateCall', (result) => ({ externalId: (result as CallResult)?.externalCallId })),
        () => provider.initiateCall(request),
      ),

    endCall: (externalCallId: string): Promise<void> =>
      withIntegrationEvent(
        scope('endCall', () => ({ externalId: externalCallId })),
        () => provider.endCall(externalCallId),
      ),

    getCallStatus: (externalCallId: string): Promise<CallEvent | null> =>
      withIntegrationEvent(
        scope('getCallStatus', () => ({ externalId: externalCallId })),
        () => provider.getCallStatus(externalCallId),
      ),

    getRecordingUrl: (externalCallId: string): Promise<string | null> =>
      withIntegrationEvent(
        scope('getRecordingUrl', () => ({ externalId: externalCallId })),
        () => provider.getRecordingUrl(externalCallId),
      ),

    // Local, no network: pass straight through. Bound so `this` inside the
    // adapter is still the adapter.
    mediaHeaders: provider.mediaHeaders?.bind(provider),
    mediaHosts: provider.mediaHosts?.bind(provider),
    validateWebhook: provider.validateWebhook.bind(provider),
    parseWebhook: provider.parseWebhook.bind(provider),
  };
}
