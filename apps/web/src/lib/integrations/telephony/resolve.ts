/**
 * Which vendor does this organisation call with?
 *
 * One answer, in one place. The previous code asked the database for "the most
 * recently updated connected integration whose provider is not `meta`" — which
 * on a tenant that had connected Google Calendar and a speech-to-text vendor
 * would happily select one of those as the phone line, take its `callerNumber`
 * (absent), and fail with a message about telephony. Worse, on a tenant with two
 * telephony vendors configured it would silently switch between them as rows
 * were touched.
 *
 * The default is now an explicit setting a human chose, and a tenant with no
 * choice recorded and more than one connected vendor is an error rather than a
 * guess.
 */
import { prisma } from '@/lib/db';
import { connectionCredentials } from '../connection';
import { loggedTelephony } from '@/services/integrations/loggedTelephony';
import { telephonyProvider } from './index';
import { TELEPHONY_VENDORS, TelephonyConfigError } from './types';
import type { TelephonyProvider, TelephonyVendor } from './types';

export interface ResolvedTelephony {
  provider: TelephonyProvider;
  vendor: string;
  connectionId: string;
  webhookKey: string;
  /** The virtual number the client sees. */
  callerNumber: string;
  /** Whether the vendor should be told to record at all. */
  recordingEnabled: boolean;
  /** Whether a consent row is required before recording is requested. */
  consentRequired: boolean;
}

export interface TelephonySettings {
  callerNumber?: string;
  recordingEnabled?: boolean;
  consentRequired?: boolean;
  country?: string;
}

export function telephonySettings(metadata: unknown): TelephonySettings {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return {
    callerNumber: typeof m.callerNumber === 'string' ? m.callerNumber : undefined,
    // Recording defaults on; consent defaults required. Both are the safe
    // direction to be wrong in, and both are overridable per connection.
    recordingEnabled: m.recordingEnabled !== false,
    consentRequired: m.consentRequired !== false,
    country: typeof m.country === 'string' ? m.country : undefined,
  };
}

/** Connected telephony vendors for a tenant, newest first. Never returns secrets. */
export async function telephonyConnections(tenantId: string) {
  return prisma.integrationConnection.findMany({
    where: { tenantId, provider: { in: [...TELEPHONY_VENDORS] } },
    select: {
      id: true,
      provider: true,
      status: true,
      webhookKey: true,
      metadata: true,
      lastSyncAt: true,
      errorMessage: true,
      updatedAt: true,
    },
    orderBy: { provider: 'asc' },
  });
}

export async function defaultVendor(tenantId: string): Promise<string | null> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { telephonyProvider: true },
  });
  if (setting?.telephonyProvider) return setting.telephonyProvider;

  // No explicit choice: one connected vendor is unambiguous, several is not.
  const connected = (await telephonyConnections(tenantId)).filter((c) => c.status === 'CONNECTED');
  return connected.length === 1 ? connected[0].provider : null;
}

export async function resolveTelephony(tenantId: string): Promise<ResolvedTelephony> {
  const vendor = await defaultVendor(tenantId);
  if (!vendor) {
    throw new TelephonyConfigError(
      'No default calling provider is set for this workspace. Choose one in Settings → Integrations → Telephony.',
    );
  }

  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: vendor } },
    select: { id: true, provider: true, status: true, webhookKey: true, metadata: true },
  });
  if (!connection || connection.status !== 'CONNECTED') {
    throw new TelephonyConfigError(`${vendor} is selected as the calling provider but is not connected.`);
  }

  const settings = telephonySettings(connection.metadata);
  if (!settings.callerNumber) {
    throw new TelephonyConfigError(`${vendor} has no caller number configured, so there is nothing to dial from.`);
  }

  const credentials = await connectionCredentials(tenantId, vendor);
  if (!credentials) throw new TelephonyConfigError(`${vendor} credentials are missing.`);

  return {
    // Wrapped here rather than in the factory: this is the one place a tenant
    // and a provider are both in scope, and the factory is deliberately pure.
    provider: loggedTelephony(telephonyProvider(vendor, credentials, connection.webhookKey), tenantId),
    vendor,
    connectionId: connection.id,
    webhookKey: connection.webhookKey,
    callerNumber: settings.callerNumber,
    recordingEnabled: settings.recordingEnabled !== false,
    consentRequired: settings.consentRequired !== false,
  };
}

export const isTelephonyVendorName = (value: string): value is TelephonyVendor =>
  (TELEPHONY_VENDORS as readonly string[]).includes(value);
