/**
 * Each lead source's name, as its Integrations card, its page's heading and
 * the phone's top bar read it. Apart from `leadSources.ts`, which reads
 * node:crypto, so the top bar (a client component) can import it.
 */
export const LEAD_SOURCE_LABELS = {
  property_finder: 'Property Finder',
  bayut: 'Bayut',
  dubizzle: 'Dubizzle',
  google_ads: 'Google Ads lead forms',
  custom_webhook: 'Custom webhook',
  inbound_email: 'Portal emails',
} as const;
