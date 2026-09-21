/**
 * Every AI feature that can spend money, by the exact string it meters under.
 *
 * The portal needs a list to offer when an administrator sets a budget or a
 * model chain, and a typo there is silent: a budget for `call_audit` would look
 * configured and govern nothing. So the strings live once, here, beside the
 * name a person would recognise.
 *
 * A feature appears the moment it calls `generateJson`; the four `gemini-*`
 * entries default their metering label from the request label, which is why
 * they read like internal names — renaming them would orphan the usage rows
 * already written under them.
 */
export interface AiFeature {
  key: string;
  label: string;
  /** Roughly what it costs to serve, for the "where is the money going" view. */
  weight: 'light' | 'heavy';
}

export const AI_FEATURES: AiFeature[] = [
  { key: 'call-analysis', label: 'Call analysis', weight: 'heavy' },
  { key: 'call-audit', label: 'Call audit scoring', weight: 'heavy' },
  { key: 'live-coach', label: 'Live coaching', weight: 'heavy' },
  { key: 'live-coach-action', label: 'Live coaching actions', weight: 'light' },
  { key: 'assistant', label: 'Workspace assistant', weight: 'light' },
  { key: 'social-draft', label: 'Social post drafting', weight: 'light' },
  { key: 'gemini-followup-email', label: 'Follow-up email drafting', weight: 'light' },
  { key: 'gemini-followup-whatsapp', label: 'Follow-up WhatsApp drafting', weight: 'light' },
  { key: 'gemini-practice-reply', label: 'Practice conversation', weight: 'light' },
  { key: 'gemini-practice-score', label: 'Practice scoring', weight: 'light' },
];

export const AI_FEATURE_KEYS = AI_FEATURES.map((f) => f.key);

export function featureLabel(key: string): string {
  return AI_FEATURES.find((f) => f.key === key)?.label ?? key;
}

/** The providers a key may speak, mirroring `AiProviderKey`. */
export const AI_PROVIDERS = ['google', 'openrouter'] as const;
