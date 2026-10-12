import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PropertyType } from '@prisma/client';

/**
 * Lead sources that post enquiries to `/api/v1/webhooks/leads/{webhookKey}`:
 * the property portals and Google Ads lead forms. Ported from the standalone
 * Lead Eagle's intake adapters.
 *
 * The portals deliver to approved partners only, so their exact payloads arrive
 * with the partner agreement. Until then the parser reads the field names those
 * portals and Lead Eagle's adapters use, at any depth and in either case style,
 * and keeps whatever else was sent on the stored event for a replay.
 */
export const LEAD_SOURCES = {
  property_finder: { label: 'Property Finder', source: 'MARKETPLACE' },
  bayut: { label: 'Bayut', source: 'MARKETPLACE' },
  dubizzle: { label: 'Dubizzle', source: 'MARKETPLACE' },
  google_ads: { label: 'Google Ads lead forms', source: 'AD_LEAD_FORM' },
} as const;

export type LeadSourceKey = keyof typeof LEAD_SOURCES;

export const isLeadSource = (provider: string): provider is LeadSourceKey => Object.hasOwn(LEAD_SOURCES, provider);

/**
 * The portals sign the exact bytes with HMAC-SHA256 and the shared secret, in
 * hex, optionally prefixed `sha256=`. Google cannot sign: it puts the key the
 * advertiser typed into Google Ads in the body as `google_key`.
 */
export function verifyDelivery(
  provider: LeadSourceKey,
  secret: string | undefined,
  raw: string,
  payload: Record<string, unknown>,
  signature: string | null,
): boolean {
  if (!secret) return false;
  if (provider === 'google_ads') return same(Buffer.from(String(payload.google_key ?? '')), Buffer.from(secret));
  const given = Buffer.from((signature ?? '').trim().replace(/^sha256=/i, ''), 'hex');
  return same(given, createHmac('sha256', secret).update(raw, 'utf8').digest());
}

/** Length first: timingSafeEqual throws on a mismatch, and the throw is itself a timing signal. */
const same = (a: Buffer, b: Buffer) => a.length > 0 && a.length === b.length && timingSafeEqual(a, b);

/** What an enquiry says, whichever source sent it. */
export interface Enquiry {
  /** The sender's own id for the lead, when it names one. */
  externalId: string | null;
  fullName: string | null;
  email: string | null;
  phones: string[];
  message: string | null;
  /** The listing or ad it came from, for `sourceDetail`. */
  reference: string | null;
  /** What the form asked — purpose, type, area, budget — as the sender worded it. */
  details: string[];
  /** The same, as a requirement on the lead (M6-29); null when it states nothing it wants. */
  requirement: RequirementDraft | null;
  /** Google's "Send test data" button. Accepted, never a lead. */
  isTest: boolean;
}

/** `lead_id`, `leadId` and `Lead-ID` are one key here. */
const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Sub-objects about somebody or something other than the enquirer. Their
 * contact fields are read only under their prefix (`agentname`, `agentphone`),
 * never as the bare `name` or `phone`: an agent's number taken for the client's
 * would attach every enquiry that agent handles to one lead.
 */
const CONTACT = /name|phone|mobile|email|whatsapp|contactnumber/;
const NOT_THE_CLIENT = new Set([
  'agent',
  'agents',
  'broker',
  'user',
  'assignee',
  'assignedto',
  'owner',
  'listing',
  'property',
  'project',
  'company',
  'advertiser',
  'account',
]);

/**
 * Every scalar in the payload by its key, outer values first, so an envelope's
 * `{ data: { client: { name } } }` and a flat `{ name }` read the same. A
 * nested value is also kept under its parent's prefix (`clientname`). Google's
 * `user_column_data` rows become keys named by their `column_id`.
 */
function flatten(value: unknown, into = new Map<string, string>(), depth = 0, parent = '', generic = true) {
  if (depth > 4 || !value || typeof value !== 'object') return into;
  const put = (k: string, v: unknown) => {
    const text = v == null ? '' : String(v).trim();
    const bare = key(k);
    for (const name of [(generic || !CONTACT.test(bare)) && bare, parent && parent + bare]) {
      if (text && name && !into.has(name)) into.set(name, text);
    }
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = item as { column_id?: unknown; string_value?: unknown };
      if (typeof row?.column_id === 'string') put(row.column_id, row.string_value);
      else flatten(item, into, depth + 1, parent, generic);
    }
    return into;
  }
  const nested: [string, unknown][] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === 'object') nested.push([key(k), v]);
    else put(k, v);
  }
  for (const [k, v] of nested) flatten(v, into, depth + 1, k, generic && !NOT_THE_CLIENT.has(k));
  return into;
}

const DETAILS: [label: string, field: keyof Wants, keys: string[]][] = [
  ['Purpose', 'purpose', ['purpose', 'offeringtype', 'listingtype', 'transactiontype', 'realtorhelpgoal']],
  ['Type', 'type', ['propertytype', 'category', 'subcategory']],
  [
    'Area',
    'area',
    ['location', 'locationname', 'community', 'propertycommunity', 'neighbourhood', 'preferredlocation', 'city'],
  ],
  ['Bedrooms', 'bedrooms', ['bedrooms', 'numberofbedrooms']],
  ['Budget', 'budget', ['budget', 'pricerange', 'price', 'budgetmax', 'pricemax']],
];

/** What an enquiry said it wants, as the sender worded it. */
export type Wants = Partial<Record<'purpose' | 'type' | 'area' | 'bedrooms' | 'budget', string | null>>;

/** A ClientRequirement's searchable half, from an enquiry. */
export interface RequirementDraft {
  purpose: 'BUY' | 'RENT';
  propertyTypes: PropertyType[];
  subType: string | null;
  locations: string[];
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

const TYPES: [RegExp, PropertyType][] = [
  [/apartment|flat/, 'APARTMENT'],
  [/villa/, 'VILLA'],
  [/town ?house/, 'TOWNHOUSE'],
  [/penthouse/, 'PENTHOUSE'],
  [/plot|land/, 'PLOT'],
  [/office/, 'OFFICE'],
  [/retail|shop/, 'RETAIL'],
  [/warehouse/, 'WAREHOUSE'],
];
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6 };

/** "AED 3,500,000", "60k - 80k", "1.5M": every amount in it, in order. */
const amounts = (text: string) =>
  [...text.toLowerCase().matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|mn|k|m)?\b/g)].map(([, n, unit]) =>
    Math.round(Number(n!.replace(/,/g, '')) * (unit ? SCALE[unit]! : 1)),
  );

/**
 * An enquiry's wants as a requirement (M6-29), or null when it states none or
 * is an owner wanting to sell. Purpose "Rent", "Lease" or Property Finder's
 * RR/CR is renting; anything else, or none, is buying. A type the catalogue has
 * no word for (Duplex, Hotel Apartment) is kept as the sub-type. One amount is
 * the ceiling; two are the band. "Studio" is no bedrooms, "3+" three or more.
 */
export function requirementFrom(wants: Wants): RequirementDraft | null {
  const purposeText = wants.purpose?.trim().toLowerCase() ?? '';
  if (/\bsell/.test(purposeText)) return null;
  const purpose = /^(r|c)r$|rent|lease/.test(purposeText) ? 'RENT' : 'BUY';

  const typeText = wants.type?.trim() ?? '';
  const propertyTypes = TYPES.filter(([word]) => word.test(typeText.toLowerCase())).map(([, type]) => type);
  const plain =
    propertyTypes.length === 1 && typeText.toLowerCase().replace(/[^a-z]/g, '') === propertyTypes[0]!.toLowerCase();
  const subType = typeText && !plain && !/^(residential|commercial)$/i.test(typeText) ? typeText.slice(0, 80) : null;

  const locations = (wants.area ?? '')
    .split(/[,;|]/)
    .map((place) => place.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);

  const bedText = wants.bedrooms?.trim().toLowerCase() ?? '';
  const beds = (bedText.match(/\d+/g) ?? []).map(Number).filter((n) => n <= 50);
  const [bedroomsMin, bedroomsMax] = /studio/.test(bedText)
    ? [0, 0]
    : beds.length >= 2
      ? [Math.min(beds[0]!, beds[1]!), Math.max(beds[0]!, beds[1]!)]
      : beds.length === 1
        ? [beds[0]!, /\+|more|min/.test(bedText) ? null : beds[0]!]
        : [null, null];

  const money = amounts(wants.budget ?? '');
  const [budgetMin, budgetMax] =
    money.length >= 2 ? [Math.min(money[0]!, money[1]!), Math.max(money[0]!, money[1]!)] : [null, money[0] ?? null];

  const wanted = propertyTypes.length || subType || locations.length || bedroomsMin != null || budgetMax != null;
  return wanted ? { purpose, propertyTypes, subType, locations, bedroomsMin, bedroomsMax, budgetMin, budgetMax } : null;
}

export function parseEnquiry(payload: Record<string, unknown>): Enquiry {
  const flat = flatten(payload);
  const get = (...keys: string[]) => keys.map((k) => flat.get(k)).find(Boolean) ?? null;
  const wants: Wants = Object.fromEntries(DETAILS.map(([, field, keys]) => [field, get(...keys)]));

  const first = get('firstname');
  const last = get('lastname');
  const phones = [
    'clientphone',
    'clientmobile',
    'contactphone',
    'contactmobile',
    'customerphone',
    'customermobile',
    'phone',
    'mobile',
    'phonenumber',
    'contactnumber',
    'whatsapp',
    'workphone',
  ]
    .map((k) => flat.get(k))
    .filter((p): p is string => !!p);

  return {
    // Only keys that name the lead itself. A bare `id` or `reference` may be the
    // listing's once the envelope is flattened, and two enquiries about one
    // listing sharing an id would drop the second as a retry.
    externalId: get('leadid', 'leaduuid'),
    fullName:
      get('clientname', 'contactname', 'customername', 'fullname', 'name') ??
      ([first, last].filter(Boolean).join(' ') || null),
    email:
      get('clientemail', 'contactemail', 'customeremail', 'email', 'emailaddress', 'workemail')?.toLowerCase() ?? null,
    phones: [...new Set(phones)],
    message: get('message', 'comments', 'comment', 'enquiry', 'inquiry', 'notes'),
    reference: get('listingreference', 'propertyreference', 'referencenumber', 'listingid', 'formid'),
    details: DETAILS.flatMap(([label, field]) => (wants[field] ? [`${label}: ${wants[field]}`] : [])),
    requirement: requirementFrom(wants),
    isTest: flat.get('istest') === 'true',
  };
}
