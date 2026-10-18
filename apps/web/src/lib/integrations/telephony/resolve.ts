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
import { normalizePhone } from '@/services/leads/normalizePhone';
import { connectionCredentials } from '../connection';
import { providerSpec } from '../registry';
import { sendsSms, telephonyProvider } from './index';
import { TELEPHONY_VENDORS, TelephonyConfigError } from './types';
import type { SmsResult, TelephonyProvider } from './types';

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

/**
 * The connection's tracking numbers (M9-06), normalised, each to its tag: the
 * source a call to that line came from, typed on the connection as
 * `+97144000001 = Google Ads; +97144000002 = Marina launch` (`;` or a new line
 * between entries). An entry without a number or a tag is skipped.
 */
// ponytail: one 500-character setting holds about a dozen lines; a table of its own when a workspace runs more.
export function trackingNumbers(metadata: unknown): Map<string, string> {
  const raw = (metadata as Record<string, unknown> | null)?.trackingNumbers;
  const map = new Map<string, string>();
  for (const entry of typeof raw === 'string' ? raw.split(/[;\n]/) : []) {
    const at = entry.indexOf('=');
    const number = at > 0 ? normalizePhone(entry.slice(0, at)) : null;
    const tag = entry.slice(at + 1).trim();
    if (number && tag) map.set(number, tag);
  }
  return map;
}

/** Connected telephony vendors for a tenant, newest first. Never returns secrets. */
export async function telephonyConnections(tenantId: string) {
  return prisma.integrationConnection.findMany({
    // The development mock counts as a vendor only in development; the provider
    // factory refuses it everywhere else, so it can never resolve in production.
    where: {
      tenantId,
      provider: { in: [...TELEPHONY_VENDORS, ...(process.env.NODE_ENV === 'development' ? ['mock'] : [])] },
    },
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
    provider: telephonyProvider(vendor, credentials, connection.webhookKey),
    vendor,
    connectionId: connection.id,
    webhookKey: connection.webhookKey,
    callerNumber: settings.callerNumber,
    recordingEnabled: settings.recordingEnabled !== false,
    consentRequired: settings.consentRequired !== false,
  };
}

/**
 * A sender as the carriers take one: an E.164 number, or an alphanumeric sender
 * ID (letters, digits and spaces, at most 11, at least one letter), such as one
 * registered for the UAE.
 */
const SMS_SENDER = /^(?:\+[1-9]\d{6,14}|(?=[A-Za-z0-9 ]*[A-Za-z])[A-Za-z0-9 ]{1,11})$/;

export type SmsSetup =
  { ready: true; vendor: string; from: string; webhookKey: string } | { ready: false; reason: string };

/**
 * Whether this workspace can send a text from the lead (M4-29), and if not why:
 * through its calling provider's own connection, when that vendor sends SMS,
 * from the SMS sender set on its card (Administration → Integrations). No
 * credentials are read: the lead page asks this on every render.
 */
export async function smsSetup(tenantId: string): Promise<SmsSetup> {
  const vendor = await defaultVendor(tenantId);
  if (!vendor || !sendsSms(vendor)) {
    return {
      ready: false,
      reason:
        'SMS is not set up: connect Twilio under Administration → Integrations as the calling provider and give it an SMS sender.',
    };
  }
  const label = providerSpec(vendor)?.label ?? vendor;
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: vendor } },
    select: { status: true, webhookKey: true, metadata: true },
  });
  if (connection?.status !== 'CONNECTED') {
    return { ready: false, reason: `SMS is not set up: ${label} is not connected.` };
  }
  const raw = (connection.metadata as Record<string, unknown> | null)?.smsSender;
  const from = typeof raw === 'string' ? raw.trim() : '';
  if (!from) {
    return {
      ready: false,
      reason: `SMS is not set up: set the SMS sender on the ${label} card under Administration → Integrations.`,
    };
  }
  if (!SMS_SENDER.test(from)) {
    return {
      ready: false,
      reason: `The SMS sender on the ${label} card is neither a number such as +971500000000 nor a name of up to 11 letters and digits.`,
    };
  }
  return { ready: true, vendor, from, webhookKey: connection.webhookKey };
}

/** The workspace's text sender, or a `TelephonyConfigError` saying what is not set up. */
export async function resolveSms(tenantId: string) {
  const setup = await smsSetup(tenantId);
  if (!setup.ready) throw new TelephonyConfigError(setup.reason);
  const credentials = await connectionCredentials(tenantId, setup.vendor);
  if (!credentials) throw new TelephonyConfigError(`${setup.vendor} credentials are missing.`);
  const provider = telephonyProvider(setup.vendor, credentials, setup.webhookKey);
  const send = provider.sendSms?.bind(provider);
  if (!send) throw new TelephonyConfigError(`${setup.vendor} does not send SMS.`);
  return {
    vendor: setup.vendor,
    from: setup.from,
    send: (to: string, body: string): Promise<SmsResult> => send({ from: setup.from, to, body }),
  };
}
