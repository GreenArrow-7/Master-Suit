/**
 * Every provider a workspace can connect, in one list.
 *
 * The admin form, the API validation, the health board and the capability
 * matrix all read this. Adding a vendor is an adapter plus an entry here — never
 * a new form component and never a second list to keep in step with this one.
 */
import { VENDOR_FIELDS, TELEPHONY_VENDORS, type VendorField } from './telephony/types';
import { vendorCapabilities } from './telephony';

export type IntegrationCategory = 'TELEPHONY' | 'MESSAGING' | 'MEETINGS' | 'TRANSCRIPTION' | 'AI';

export interface SettingField extends VendorField {
  /** Settings live in `metadata` and are readable without the encryption key. */
  setting?: true;
}

export interface ProviderSpec {
  key: string;
  label: string;
  category: IntegrationCategory;
  description: string;
  /** Encrypted at rest, never returned by any API. */
  credentials: VendorField[];
  /** Operational configuration; safe to read back. */
  settings: SettingField[];
  capabilities: readonly string[];
  /** True when the vendor delivers callbacks to us and needs the URL. */
  webhook: boolean;
  /**
   * Vendors that cannot sign their callbacks, so the secret in the URL is the
   * only credential. Surfaced in the UI rather than buried in a doc.
   */
  unsignedCallbacks?: boolean;
}

const TELEPHONY_SETTINGS: SettingField[] = [
  {
    key: 'callerNumber',
    label: 'Caller ID / virtual number',
    secret: false,
    setting: true,
    hint: 'E.164, e.g. +971500000000. The number the client sees.',
  },
  { key: 'country', label: 'Country', secret: false, setting: true, hint: 'ISO code, e.g. AE or IN' },
];

const TELEPHONY_LABELS: Record<string, { label: string; description: string; unsigned?: boolean }> = {
  twilio: {
    label: 'Twilio',
    description: 'Global voice. Signs its callbacks over the URL and parameters.',
  },
  exotel: {
    label: 'Exotel',
    description: 'India and South-East Asia click-to-call. Does not sign callbacks — the URL secret authenticates.',
    unsigned: true,
  },
  knowlarity: {
    label: 'Knowlarity',
    description: 'India click-to-call. Does not sign callbacks — the URL secret authenticates.',
    unsigned: true,
  },
  plivo: {
    label: 'Plivo',
    description: 'Global voice. Signs its callbacks with a nonce over the URL.',
  },
};

export const PROVIDERS: ProviderSpec[] = [
  ...TELEPHONY_VENDORS.map<ProviderSpec>((vendor) => ({
    key: vendor,
    label: TELEPHONY_LABELS[vendor].label,
    category: 'TELEPHONY',
    description: TELEPHONY_LABELS[vendor].description,
    credentials: VENDOR_FIELDS[vendor],
    settings: TELEPHONY_SETTINGS,
    capabilities: vendorCapabilities(vendor),
    webhook: true,
    unsignedCallbacks: TELEPHONY_LABELS[vendor].unsigned,
  })),
  {
    key: 'meta',
    label: 'WhatsApp Business',
    category: 'MESSAGING',
    description: 'Meta Cloud API (Graph v26.0). Event invitations, campaign sends and reminders.',
    credentials: [
      { key: 'accessToken', label: 'System user access token', secret: true },
      { key: 'phoneNumberId', label: 'Phone number ID', secret: false },
      {
        key: 'appSecret',
        label: 'App secret',
        secret: true,
        hint: 'Meta app dashboard → App settings → Basic. Signs X-Hub-Signature-256 on inbound events.',
      },
      {
        key: 'webhookVerifyToken',
        label: 'Webhook verify token',
        secret: true,
        hint: 'A string you choose, echoed back on the subscription handshake. Not the app secret.',
      },
    ],
    settings: [],
    capabilities: ['TEMPLATE_MESSAGE', 'DELIVERY_STATUS'],
    webhook: true,
  },
  {
    key: 'google',
    label: 'Google Workspace',
    category: 'MEETINGS',
    description: 'Calendar events and Google Meet links against the organiser calendar.',
    credentials: [
      { key: 'accessToken', label: 'OAuth access token', secret: true },
      { key: 'refreshToken', label: 'OAuth refresh token', secret: true },
    ],
    settings: [{ key: 'calendarId', label: 'Calendar', secret: false, setting: true, hint: 'Defaults to primary' }],
    capabilities: ['CREATE_MEETING', 'UPDATE_MEETING', 'CANCEL_MEETING', 'MEET_LINK'],
    webhook: false,
  },
  {
    key: 'transcription',
    label: 'Speech to text',
    category: 'TRANSCRIPTION',
    description: 'Turns call recordings into transcripts before analysis.',
    credentials: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'endpoint', label: 'Endpoint', secret: false, hint: 'Self-hosted Whisper only' },
    ],
    settings: [
      {
        key: 'provider',
        label: 'Engine',
        secret: false,
        setting: true,
        hint: 'gemini, google, deepgram or whisper',
      },
      { key: 'model', label: 'Model', secret: false, setting: true },
    ],
    capabilities: ['TRANSCRIBE'],
    webhook: false,
  },
  {
    key: 'gemini',
    label: 'Gemini',
    category: 'AI',
    description:
      'Call analysis, audit scoring, live coaching and the in-app assistant. Without it those features fall back to a labelled simulation.',
    credentials: [{ key: 'apiKey', label: 'API key', secret: true, hint: 'From Google AI Studio' }],
    settings: [
      {
        key: 'model',
        label: 'Model',
        secret: false,
        setting: true,
        hint: 'Optional — the newest available flash model is discovered automatically',
      },
    ],
    capabilities: ['ANALYSE', 'AUDIT', 'ASSIST', 'TRANSCRIBE'],
    webhook: false,
  },
];

export const providerSpec = (key: string) => PROVIDERS.find((p) => p.key === key);

/**
 * `provider` is stored in `credentials` for transcription because
 * getTranscriptionProvider reads it from there. Kept as a one-line exception
 * rather than reshaping that factory: the settings/credentials split is a
 * storage detail, and this is the only provider whose engine choice is not a
 * secret but travels with the key that selects it.
 */
export const CREDENTIAL_ALSO_SETTINGS: Record<string, string[]> = { transcription: ['provider', 'model'] };
